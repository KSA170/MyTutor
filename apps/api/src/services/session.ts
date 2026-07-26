/** Session close-out: summary, question-summary vault note, points award. */
import { VAULT_TYPE_FOLDERS, type FinishSessionResponse } from "@mytutor/shared";
import { completeJson } from "../ai/client.js";
import { HttpError, one, q } from "../db.js";
import { parseWikilinks, validateVaultPath } from "../lib/vault.js";

// deno-lint-ignore no-explicit-any
type Json = any;

export async function finishSession(
  userId: string,
  sessionId: string,
  outcome: "completed" | "abandoned",
): Promise<FinishSessionResponse> {
  const session = await one(
    "select * from sessions where id = $1 and user_id = $2",
    [sessionId, userId],
  );
  if (!session) throw new HttpError(404, "Session not found");
  if (session.status !== "active") {
    throw new HttpError(409, "Session already finished");
  }

  const endedAt = new Date();
  let summary: string | null = null;
  if (outcome === "completed") {
    summary = await summarizeSession(userId, session);
  }

  await q(
    "update sessions set status = $1, ended_at = $2, summary = $3 where id = $4",
    [outcome, endedAt.toISOString(), summary, session.id],
  );

  let pointsAwarded = 0;
  if (outcome === "completed") {
    const row = await one("select award_session_points($1, $2) as pts", [
      userId,
      session.id,
    ]);
    pointsAwarded = row?.pts ?? 0;
  }

  const fresh = await one(
    "select questions_answered, hints_given, answers_revealed from sessions where id = $1",
    [session.id],
  );
  const notes = await one(
    "select count(*)::int as n from session_events where session_id = $1 and type = 'note_created'",
    [session.id],
  );

  return {
    sessionId: session.id,
    summary,
    durationMinutes: Math.max(
      0,
      Math.round(
        (endedAt.getTime() - new Date(session.started_at).getTime()) / 60000,
      ),
    ),
    questionsAnswered: fresh?.questions_answered ?? 0,
    hintsGiven: fresh?.hints_given ?? 0,
    answersRevealed: fresh?.answers_revealed ?? 0,
    notesCreated: notes?.n ?? 0,
    pointsAwarded,
  };
}

async function summarizeSession(
  userId: string,
  session: Json,
): Promise<string | null> {
  const messages = await q(
    "select role, display_text from messages where session_id = $1 and display_text is not null and role in ('user','assistant') order by seq asc limit 80",
    [session.id],
  );
  if (messages.length === 0) return null;

  const transcript = messages
    .map((m) => `${m.role === "user" ? "Student" : "Tutor"}: ${m.display_text}`)
    .join("\n")
    .slice(0, 40000);

  const parsed = await completeJson<{
    summary: string;
    subject: string;
    questions_covered: string[];
    concepts: string[];
  }>({
    schemaName: "session_summary",
    prompt: `Summarize this tutoring session transcript.\n\n${transcript}`,
    schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        subject: { type: "string" },
        questions_covered: { type: "array", items: { type: "string" } },
        concepts: { type: "array", items: { type: "string" } },
      },
      required: ["summary", "subject", "questions_covered", "concepts"],
      additionalProperties: false,
    },
  });
  if (!parsed) return null;

  await writeQuestionSummaryNote(userId, session, parsed);
  return parsed.summary ?? null;
}

async function writeQuestionSummaryNote(
  userId: string,
  session: Json,
  parsed: Json,
): Promise<void> {
  if (!session.course_id) return;
  const course = await one("select name from courses where id = $1", [
    session.course_id,
  ]);
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
    ...(parsed.questions_covered ?? []).map((qc: string) =>
      qc.startsWith("-") ? qc : `- ${qc}`
    ),
    "",
    conceptLinks ? `**Concepts:** ${conceptLinks}` : "",
  ].join("\n").trim() + "\n";

  await q(
    `insert into notes (user_id, course_id, subject, path, title, frontmatter, content, tags, links, source_session_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (user_id, path) do update set content = excluded.content, links = excluded.links`,
    [
      userId,
      session.course_id,
      subject,
      path,
      `Session ${dateStr}`,
      {
        source: "mytutor",
        type: "question_summary",
        created: dateStr,
        tags: ["session-summary"],
      },
      content,
      ["session-summary"],
      parseWikilinks(content),
      session.id,
    ],
  );
}
