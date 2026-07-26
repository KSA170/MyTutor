/**
 * extract-grade — read a photo of a marked test/assignment and prefill the
 * grade entry form.
 *
 * POST { storagePath, mimeType } → ExtractGradeResponse (Haiku vision +
 * structured output).
 */

import { getAnthropic, UTILITY_MODEL } from "../_shared/anthropic.ts";
import {
  corsHeaders,
  errorResponse,
  HttpError,
  jsonResponse,
  requireUser,
  userClient,
} from "../_shared/db.ts";
import {
  MATERIALS_BUCKET,
  type ExtractGradeRequest,
  type ExtractGradeResponse,
} from "../../../packages/shared/src/protocol.ts";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

// deno-lint-ignore no-explicit-any
type Json = any;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const supabase = userClient(req);
    const user = await requireUser(supabase);
    const body = (await req.json()) as ExtractGradeRequest;
    if (!body.storagePath || !body.mimeType?.startsWith("image/")) {
      throw new HttpError(400, "storagePath and an image mimeType are required");
    }
    if (!body.storagePath.startsWith(`${user.id}/`)) {
      throw new HttpError(403, "Not your file");
    }

    const { data: blob, error } = await supabase.storage
      .from(MATERIALS_BUCKET)
      .download(body.storagePath);
    if (error || !blob) throw new HttpError(404, "File not found");

    const anthropic = getAnthropic();
    const response = await anthropic.messages.create({
      model: UTILITY_MODEL,
      max_tokens: 800,
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              title: {
                type: ["string", "null"],
                description: "Name of the test/assignment if visible.",
              },
              score: { type: ["number", "null"] },
              max_score: { type: ["number", "null"] },
              feedback: {
                type: ["string", "null"],
                description: "Teacher comments, transcribed.",
              },
              topics: {
                type: "array",
                items: { type: "string" },
                description:
                  "Topics covered, especially where marks were lost.",
              },
            },
            required: ["title", "score", "max_score", "feedback", "topics"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: body.mimeType,
                data: encodeBase64(await blob.arrayBuffer()),
              },
            },
            {
              type: "text",
              text:
                "This is a photo of a graded test or assignment. Extract the mark (score and max score), the assessment title, any teacher feedback, and the topics covered (especially where marks were lost).",
            },
          ],
        },
      ],
    });

    const text = response.content
      .filter((b: Json) => b.type === "text")
      .map((b: Json) => b.text)
      .join("");
    const parsed = JSON.parse(text) as ExtractGradeResponse;
    return jsonResponse(parsed);
  } catch (err) {
    return errorResponse(err);
  }
});
