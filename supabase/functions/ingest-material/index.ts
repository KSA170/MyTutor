/**
 * ingest-material — turn an uploaded file into searchable course context.
 *
 * POST { materialId } → 202 immediately; processing continues under
 * EdgeRuntime.waitUntil. The app watches materials.status over Realtime.
 *
 * Pipeline: download from storage → extract text (unpdf / mammoth / Haiku
 * vision) → chunk (~CHUNK_TOKEN_TARGET tokens, page-aligned) → Haiku
 * structured summary {summary, topics, suggested_title} → rebuild the
 * course's context_summary rollup.
 */

import { getAnthropic, UTILITY_MODEL } from "../_shared/anthropic.ts";
import {
  corsHeaders,
  errorResponse,
  HttpError,
  jsonResponse,
  serviceClient,
  userClient,
} from "../_shared/db.ts";
import {
  CHUNK_TOKEN_TARGET,
  MATERIALS_BUCKET,
  type IngestMaterialRequest,
} from "../../packages/shared/src/protocol.ts";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

// deno-lint-ignore no-explicit-any
type Json = any;

const CHUNK_CHAR_TARGET = CHUNK_TOKEN_TARGET * 4;
const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_VISION_PAGES = 100;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const body = (await req.json()) as IngestMaterialRequest;
    if (!body.materialId) throw new HttpError(400, "materialId is required");

    const service = serviceClient();
    const { data: material } = await service
      .from("materials")
      .select("*")
      .eq("id", body.materialId)
      .single();
    if (!material) throw new HttpError(404, "Material not found");

    // If called with a user JWT (vs service role from tutor-chat), enforce
    // ownership.
    const { data: userData } = await userClient(req).auth.getUser();
    if (userData?.user && userData.user.id !== material.user_id) {
      throw new HttpError(403, "Not your material");
    }

    await service
      .from("materials")
      .update({ status: "processing", error: null })
      .eq("id", material.id);

    EdgeRuntime.waitUntil(
      process(service, material).catch(async (err) => {
        console.error(`ingest failed for ${material.id}:`, err);
        await service
          .from("materials")
          .update({ status: "failed", error: String(err?.message ?? err) })
          .eq("id", material.id);
      }),
    );

    return jsonResponse({ accepted: true, materialId: material.id }, 202);
  } catch (err) {
    return errorResponse(err);
  }
});

interface PageText {
  page: number | null;
  text: string;
}

async function process(service: Json, material: Json): Promise<void> {
  let pages: PageText[] = [];
  let pageCount: number | null = null;

  if (material.kind === "video" || material.kind === "other") {
    // v1: no transcript extraction — the material is indexed by title so the
    // tutor knows it exists and can discuss it.
    await finalize(service, material, [], null, {
      summary:
        `Uploaded ${material.kind} file "${material.title}" (content not transcribed in v1 — ask the student what it covers).`,
      topics: [],
      suggested_title: material.title,
    });
    return;
  }

  const { data: blob, error: dlError } = await service.storage
    .from(MATERIALS_BUCKET)
    .download(material.storage_path);
  if (dlError || !blob) {
    throw new Error(`download failed: ${dlError?.message ?? "no data"}`);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());

  if (material.kind === "pdf") {
    const extracted = await extractPdf(bytes);
    pageCount = extracted.pageCount;
    pages = extracted.pages;
    const totalChars = pages.reduce((n, p) => n + p.text.length, 0);
    if (totalChars < 200) {
      // Scanned / no text layer → Haiku vision transcription.
      pages = await transcribePdfWithVision(bytes, pageCount);
    }
  } else if (material.kind === "docx") {
    pages = [{ page: null, text: await extractDocx(bytes) }];
  } else if (material.kind === "image") {
    pages = [{
      page: null,
      text: await transcribeImage(bytes, material.mime_type ?? "image/jpeg"),
    }];
  }

  const fullText = pages.map((p) => p.text).join("\n\n").trim();
  if (fullText.length === 0) {
    throw new Error("No text could be extracted from this file");
  }

  const chunks = chunkPages(pages);
  const summary = await summarize(material.title, fullText);
  await finalize(service, material, chunks, pageCount, summary);
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

async function extractPdf(
  bytes: Uint8Array,
): Promise<{ pages: PageText[]; pageCount: number }> {
  const { extractText, getDocumentProxy } = await import("npm:unpdf@0.12.1");
  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pageTexts = Array.isArray(text) ? text : [text];
  return {
    pageCount: totalPages,
    pages: pageTexts.map((t: string, i: number) => ({
      page: i + 1,
      text: (t ?? "").trim(),
    })),
  };
}

async function extractDocx(bytes: Uint8Array): Promise<string> {
  const mammoth = await import("npm:mammoth@1.8.0");
  const result = await mammoth.extractRawText({
    arrayBuffer: bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ),
  });
  return result.value ?? "";
}

async function transcribePdfWithVision(
  bytes: Uint8Array,
  pageCount: number,
): Promise<PageText[]> {
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new Error("Scanned PDF too large for vision transcription (>30MB)");
  }
  if (pageCount > MAX_VISION_PAGES) {
    throw new Error(
      `Scanned PDF has ${pageCount} pages (max ${MAX_VISION_PAGES} for vision transcription)`,
    );
  }
  const anthropic = getAnthropic();
  const response = await anthropic.messages.create({
    model: UTILITY_MODEL,
    max_tokens: 16000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: encodeBase64(bytes),
            },
          },
          {
            type: "text",
            text:
              "Transcribe the full text content of this document, preserving structure with markdown headings. Output only the transcription.",
          },
        ],
      },
    ],
  });
  const text = response.content
    .filter((b: Json) => b.type === "text")
    .map((b: Json) => b.text)
    .join("\n");
  return [{ page: null, text }];
}

async function transcribeImage(
  bytes: Uint8Array,
  mimeType: string,
): Promise<string> {
  const anthropic = getAnthropic();
  const response = await anthropic.messages.create({
    model: UTILITY_MODEL,
    max_tokens: 8000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType,
              data: encodeBase64(bytes),
            },
          },
          {
            type: "text",
            text:
              "Transcribe all text in this image (notes, slides, problems, diagrams). Describe any figures briefly in [brackets]. Output only the transcription.",
          },
        ],
      },
    ],
  });
  return response.content
    .filter((b: Json) => b.type === "text")
    .map((b: Json) => b.text)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Chunking — ~CHUNK_TOKEN_TARGET tokens per chunk, aligned to page boundaries
// ---------------------------------------------------------------------------

export interface Chunk {
  seq: number;
  page_start: number | null;
  page_end: number | null;
  content: string;
  token_estimate: number;
}

export function chunkPages(pages: PageText[]): Chunk[] {
  const chunks: Chunk[] = [];
  let buf = "";
  let start: number | null = null;
  let end: number | null = null;

  const flush = () => {
    const content = buf.trim();
    if (content) {
      chunks.push({
        seq: chunks.length,
        page_start: start,
        page_end: end,
        content,
        token_estimate: Math.ceil(content.length / 4),
      });
    }
    buf = "";
    start = null;
    end = null;
  };

  for (const p of pages) {
    if (!p.text) continue;
    // A single giant page (or unpaged doc) is split on paragraph boundaries.
    const pieces = p.text.length > CHUNK_CHAR_TARGET * 1.5
      ? splitLongText(p.text)
      : [p.text];
    for (const piece of pieces) {
      if (buf.length > 0 && buf.length + piece.length > CHUNK_CHAR_TARGET) {
        flush();
      }
      if (start === null) start = p.page;
      end = p.page;
      buf += (buf ? "\n\n" : "") + piece;
    }
  }
  flush();
  return chunks;
}

function splitLongText(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  const pieces: string[] = [];
  let buf = "";
  for (const para of paragraphs) {
    if (buf.length > 0 && buf.length + para.length > CHUNK_CHAR_TARGET) {
      pieces.push(buf);
      buf = "";
    }
    buf += (buf ? "\n\n" : "") + para;
  }
  if (buf) pieces.push(buf);
  return pieces;
}

// ---------------------------------------------------------------------------
// Summarization (Haiku, structured output)
// ---------------------------------------------------------------------------

interface MaterialSummary {
  summary: string;
  topics: string[];
  suggested_title: string;
}

async function summarize(
  title: string,
  fullText: string,
): Promise<MaterialSummary> {
  const anthropic = getAnthropic();
  const excerpt = fullText.slice(0, 24000);
  const response = await anthropic.messages.create({
    model: UTILITY_MODEL,
    max_tokens: 1024,
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            summary: {
              type: "string",
              description:
                "3-6 sentence summary of what this material covers.",
            },
            topics: {
              type: "array",
              items: { type: "string" },
              description: "5-10 topic keywords.",
            },
            suggested_title: { type: "string" },
          },
          required: ["summary", "topics", "suggested_title"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: "user",
        content:
          `Summarize this course material for a tutoring context. Uploaded filename: "${title}".\n\n${excerpt}`,
      },
    ],
  });
  const text = response.content
    .filter((b: Json) => b.type === "text")
    .map((b: Json) => b.text)
    .join("");
  return JSON.parse(text) as MaterialSummary;
}

// ---------------------------------------------------------------------------
// Finalize: write chunks + summary, rebuild course rollup
// ---------------------------------------------------------------------------

async function finalize(
  service: Json,
  material: Json,
  chunks: Chunk[],
  pageCount: number | null,
  summary: MaterialSummary,
): Promise<void> {
  await service.from("material_chunks").delete().eq("material_id", material.id);
  if (chunks.length > 0) {
    const rows = chunks.map((c) => ({
      material_id: material.id,
      user_id: material.user_id,
      ...c,
    }));
    // Insert in batches to stay under payload limits.
    for (let i = 0; i < rows.length; i += 50) {
      const { error } = await service
        .from("material_chunks")
        .insert(rows.slice(i, i + 50));
      if (error) throw new Error(`chunk insert failed: ${error.message}`);
    }
  }

  await service
    .from("materials")
    .update({
      status: "ready",
      summary: summary.summary,
      topics: summary.topics,
      page_count: pageCount,
      processed_at: new Date().toISOString(),
      title: material.title || summary.suggested_title,
    })
    .eq("id", material.id);

  await rebuildCourseSummary(service, material.course_id);
}

async function rebuildCourseSummary(
  service: Json,
  courseId: string,
): Promise<void> {
  const { data: materials } = await service
    .from("materials")
    .select("title, kind, summary")
    .eq("course_id", courseId)
    .eq("status", "ready")
    .order("title", { ascending: true });
  if (!materials || materials.length === 0) return;

  const list = materials
    .map((m: Json) => `- [${m.kind}] ${m.title}: ${m.summary ?? ""}`)
    .join("\n");

  const anthropic = getAnthropic();
  const response = await anthropic.messages.create({
    model: UTILITY_MODEL,
    max_tokens: 800,
    messages: [
      {
        role: "user",
        content:
          `These are the materials uploaded for one school course. Write a cohesive 4-8 sentence overview of what this course covers based on them, suitable as standing context for a tutor. Output only the overview.\n\n${list}`,
      },
    ],
  });
  const rollup = response.content
    .filter((b: Json) => b.type === "text")
    .map((b: Json) => b.text)
    .join("");

  await service
    .from("courses")
    .update({ context_summary: rollup })
    .eq("id", courseId);
}
