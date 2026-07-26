/**
 * finish-session — close a session, write the summary, roll up metrics.
 *
 * POST { sessionId, outcome? } → FinishSessionResponse.
 *
 * On 'completed': a Haiku summary of the conversation is stored on the
 * session and a Question Summaries note is written into the vault
 * ({Course}/{Subject}/Question Summaries/...). 'abandoned' just closes.
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
  VAULT_TYPE_FOLDERS,
  type FinishSessionRequest,
  type FinishSessionResponse,
} from "../../packages/shared/src/protocol.ts";
import { parseWikilinks, validateVaultPath } from "../_shared/vault.ts";

// deno-lint-ignore no-explicit-any
type Json = any;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const supabase = userClient(req);
    const user = await requireUser(supabase);
    const body = (await req.json()) as FinishSessionRequest;
    if (!body.sessionId) throw new HttpError(400, "sessionId is required");
    const outcome = body.outcome ?? "completed";

    const { data: session } = await supabase
      .from("sessions")
      .select("*")
      .eq("id", body.sessionId)
      .single();
    if (!session) throw new HttpError(404, "Session not found");
    if (session.status !== "active") {
      throw new HttpError(409, "Session already finished");
    }

    const endedAt = new Date();
    let summary: string | null = null;

    if (outcome === "completed") {
      summary = await summarizeSession(supabase, user.id, session);
    }

    await supabase
      .from("sessions")
      .update({ status: outcome, ended_at: endedAt.toISOString(), summary })
      .eq("id", session.id);

    // Re-read rollup counters (maintained by the session_events trigger).
    const { data: fresh } = await supabase
      .from("sessions")
      .select(
        "questions_answered, hints_given, answers_revealed, creations_made",
      )
      .eq("id", session.id)
      .single();

    const { count: notesCreated } = await supabase
      .from("session_events")
      .select("id", { count: "exact", head: true })
      .eq("session_id", session.id)
      .eq("type", "note_created");

    const durationMinutes = Math.max(
      0,
      Math.round(
        (endedAt.getTime() - new Date(session.started_at).getTime()) / 60000,
      ),
    );

    const response: FinishSessionResponse = {
      sessionId: session.id,
      summary,
      durationMinutes,
      questionsAnswered: fresh?.questions_answered ?? 0,
      hintsGiven: fresh?.hints_given ?? 0,
      answersRevealed: fresh?.answers_revealed ?? 0,
      notesCreated: notesCreated ?? 0,
    };
    return jsonResponse(response);
  } catch (err) {
    return errorResponse(err);
  }
});

async function summarizeSession(
  supabase: Json,
  userId: string,
  session: Json,
): Promise<string | null> {
  const { data: messages } = await supabase
    .from("messages")
    .select("role, display_text")
    .eq("session_id", session.id)
    .not("display_text", "is", null)
    .neq("role", "system")
    .order("seq", { ascending: true })
    .limit(80);
  if (!messages || messages.length === 0) return null;

  const transcript = messages
    .map((m: Json) => `${m.role === "user" ? "Student" : "Tutor"}: ${m.display_text}`)
    .join("\n")
    .slice(0, 40000);

  const anthropic = getAnthropic();
  const response = await anthropic.messages.create({
    model: UTILITY_MODEL,
    max_tokens: 1200,
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            summary: {
              type: "string",
              description:
                "3-5 sentence summary of what was studied and how it went.",
            },
            subject: {
              type: "string",
              description:
                "Main subject/topic of the session, e.g. 'Geology'. Short.",
            },
            questions_covered: {
              type: "array",
              items: { type: "string" },
              description:
                "Markdown bullets: each question/problem worked on and the outcome.",
            },
            concepts: {
              type: "array",
              items: { type: "string" },
              description: "Concept names covered (for wikilinks).",
            },
          },
          required: ["summary", "subject", "questions_covered", "concepts"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: "user",
        content:
          `Summarize this tutoring session transcript.\n\n${transcript}`,
      },
    ],
  });
  const text = response.content
    .filter((b: Json) => b.type === "text")
    .map((b: Json) => b.text)
    .join("");

  let parsed: Json;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text.slice(0, 2000) || null;
  }

  await writeQuestionSummaryNote(supabase, userId, session, parsed);
  return parsed.summary ?? null;
}

/** Vault note at {Course}/{Subject}/Question Summaries/Session YYYY-MM-DD.md */
async function writeQuestionSummaryNote(
  supabase: Json,
  userId: string,
  session: Json,
  parsed: Json,
): Promise<void> {
  if (!session.course_id) return;
  const { data: course } = await supabase
    .from("courses")
    .select("name")
    .eq("id", session.course_id)
    .single();
  if (!course) return;

  const subject = (session.subject || parsed.subject || "General")
    .replace(/[/\\:*?"<>|]/g, "-")
    .trim();
  const dateStr = new Date(session.started_at).toISOString().slice(0, 10);
  const shortId = String(session.id).slice(0, 8);
  const path =
    `${course.name}/${subject}/${VAULT_TYPE_FOLDERS.questions}/Session ${dateStr} (${shortId}).md`;
  if (validateVaultPath(path) !== null) return;

  const conceptLinks = (parsed.concepts ?? [])
    .map((c: string) => `[[${c}]]`)
    .join(", ");
  const content = [
    `# Session summary — ${dateStr}`,
    "",
    parsed.summary ?? "",
    "",
    "## Questions covered",
    ...(parsed.questions_covered ?? []).map((q: string) =>
      q.startsWith("-") ? q : `- ${q}`
    ),
    "",
    conceptLinks ? `**Concepts:** ${conceptLinks}` : "",
  ]
    .join("\n")
    .trim() + "\n";

  await supabase.from("notes").upsert(
    {
      user_id: userId,
      course_id: session.course_id,
      subject,
      path,
      title: `Session ${dateStr}`,
      frontmatter: {
        source: "mytutor",
        type: "question_summary",
        created: dateStr,
        tags: ["session-summary"],
      },
      content,
      tags: ["session-summary"],
      links: parseWikilinks(content),
      source_session_id: session.id,
    },
    { onConflict: "user_id,path" },
  );
}
