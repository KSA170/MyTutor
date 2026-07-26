/**
 * Material ingestion: extract text (unpdf / mammoth / vision), chunk,
 * summarize (structured), rebuild the course rollup. Runs in-process —
 * callers fire it without awaiting; status lands on the materials row.
 */
import { completeJson, completeText } from "../ai/client.js";
import { chunkPages, type PageText } from "../lib/chunking.js";
import { one, q } from "../db.js";
import { readStoredFile } from "../storage.js";

// deno-lint-ignore no-explicit-any
type Json = any;

const MAX_VISION_BYTES = 15 * 1024 * 1024;

export async function ingestMaterial(materialId: string): Promise<void> {
  const material = await one("select * from materials where id = $1", [
    materialId,
  ]);
  if (!material) return;
  await q(
    "update materials set status = 'processing', error = null where id = $1",
    [materialId],
  );
  try {
    await process_(material);
  } catch (err) {
    console.error(`ingest failed for ${materialId}:`, err);
    await q("update materials set status = 'failed', error = $1 where id = $2", [
      String((err as Error).message ?? err),
      materialId,
    ]);
  }
}

async function process_(material: Json): Promise<void> {
  let pages: PageText[] = [];
  let pageCount: number | null = null;

  if (material.kind === "video" || material.kind === "other") {
    await finalize(material, [], null, {
      summary:
        `Uploaded ${material.kind} file "${material.title}" (content not transcribed in v1 — ask the student what it covers).`,
      topics: [],
      suggested_title: material.title,
    });
    return;
  }

  const bytes = await readStoredFile(material.storage_path);

  if (material.kind === "pdf") {
    const extracted = await extractPdf(bytes);
    pageCount = extracted.pageCount;
    pages = extracted.pages;
    const totalChars = pages.reduce((n, p) => n + p.text.length, 0);
    if (totalChars < 200) {
      throw new Error(
        "This PDF has no text layer (scanned). Take photos of the pages and upload those instead — image uploads are transcribed automatically.",
      );
    }
  } else if (material.kind === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.default.extractRawText({
      buffer: bytes,
    });
    pages = [{ page: null, text: result.value ?? "" }];
  } else if (material.kind === "image") {
    if (bytes.byteLength > MAX_VISION_BYTES) {
      throw new Error("Image too large (>15MB)");
    }
    const text = await completeText({
      prompt:
        "Transcribe all text in this image (notes, slides, problems, diagrams). Describe any figures briefly in [brackets]. Output only the transcription.",
      imageDataUrl: `data:${
        material.mime_type ?? "image/jpeg"
      };base64,${bytes.toString("base64")}`,
      maxTokens: 4000,
    });
    pages = [{ page: null, text }];
  }

  const fullText = pages.map((p) => p.text).join("\n\n").trim();
  if (fullText.length === 0) {
    throw new Error("No text could be extracted from this file");
  }

  const chunks = chunkPages(pages);
  const summary =
    (await completeJson<{
      summary: string;
      topics: string[];
      suggested_title: string;
    }>({
      schemaName: "material_summary",
      prompt:
        `Summarize this course material for a tutoring context. Uploaded filename: "${material.title}".\n\n${fullText.slice(0, 24000)}`,
      schema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          topics: { type: "array", items: { type: "string" } },
          suggested_title: { type: "string" },
        },
        required: ["summary", "topics", "suggested_title"],
        additionalProperties: false,
      },
    })) ?? {
      summary: fullText.slice(0, 400),
      topics: [],
      suggested_title: material.title,
    };

  await finalize(material, chunks, pageCount, summary);
}

async function extractPdf(
  bytes: Buffer,
): Promise<{ pages: PageText[]; pageCount: number }> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
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

async function finalize(
  material: Json,
  chunks: ReturnType<typeof chunkPages>,
  pageCount: number | null,
  summary: { summary: string; topics: string[]; suggested_title: string },
): Promise<void> {
  await q("delete from material_chunks where material_id = $1", [material.id]);
  for (const c of chunks) {
    await q(
      "insert into material_chunks (material_id, user_id, seq, page_start, page_end, content, token_estimate) values ($1, $2, $3, $4, $5, $6, $7)",
      [
        material.id,
        material.user_id,
        c.seq,
        c.page_start,
        c.page_end,
        c.content,
        c.token_estimate,
      ],
    );
  }
  await q(
    "update materials set status = 'ready', summary = $1, topics = $2, page_count = $3, processed_at = now() where id = $4",
    [summary.summary, summary.topics, pageCount, material.id],
  );
  await rebuildCourseSummary(material.course_id);
}

async function rebuildCourseSummary(courseId: string): Promise<void> {
  const materials = await q(
    "select title, kind, summary from materials where course_id = $1 and status = 'ready' order by title asc",
    [courseId],
  );
  if (materials.length === 0) return;
  const list = materials
    .map((m) => `- [${m.kind}] ${m.title}: ${m.summary ?? ""}`)
    .join("\n");
  const rollup = await completeText({
    prompt:
      `These are the materials uploaded for one school course. Write a cohesive 4-8 sentence overview of what this course covers based on them, suitable as standing context for a tutor. Output only the overview.\n\n${list}`,
    maxTokens: 600,
  });
  await q("update courses set context_summary = $1 where id = $2", [
    rollup,
    courseId,
  ]);
}
