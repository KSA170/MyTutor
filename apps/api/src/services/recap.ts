/** Weekly study recap → markdown + vault note (Recommendations/...). */
import type { WeeklyRecapResponse } from "@mytutor/shared";
import { completeText } from "../ai/client.js";
import { q } from "../db.js";

// deno-lint-ignore no-explicit-any
type Json = any;

export async function recapForUser(
  userId: string,
): Promise<WeeklyRecapResponse> {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();

  const sessions = await q(
    "select mode, started_at, ended_at, hints_given, answers_revealed, summary from sessions where user_id = $1 and status = 'completed' and started_at >= $2 order by started_at asc",
    [userId, since],
  );
  const events = await q(
    "select payload from session_events where user_id = $1 and type = 'question_answered' and created_at >= $2",
    [userId, since],
  );
  const grades = await q(
    "select title, score, max_score, topics from grades where user_id = $1 and created_at >= $2",
    [userId, since],
  );
  const assignments = await q(
    "select title, due_at, status from assignments where user_id = $1 and status <> 'done' order by due_at asc nulls last limit 10",
    [userId],
  );

  if (sessions.length === 0 && grades.length === 0) {
    return {
      recap:
        "No study activity this week — start a session and I'll have something to say!",
      notePath: null,
    };
  }

  const minutes = sessions.reduce((sum, s: Json) => {
    if (!s.ended_at) return sum;
    return sum +
      Math.round(
        (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) /
          60000,
      );
  }, 0);
  const correct = events.filter((e: Json) => e.payload?.correct === true).length;

  const facts = [
    `Sessions this week: ${sessions.length} (${minutes} minutes total)`,
    `Questions answered: ${events.length} (${correct} correct)`,
    `Hints used: ${sessions.reduce((n, s: Json) => n + (s.hints_given ?? 0), 0)}, answers revealed: ${
      sessions.reduce((n, s: Json) => n + (s.answers_revealed ?? 0), 0)
    }`,
    "Session summaries:",
    ...sessions.map((s: Json) => `- [${s.mode}] ${s.summary ?? "(no summary)"}`),
    "Grades received:",
    ...grades.map(
      (g: Json) =>
        `- ${g.title}: ${g.score}/${g.max_score} [topics: ${(g.topics ?? []).join(", ")}]`,
    ),
    "Open assignments:",
    ...assignments.map(
      (a: Json) => `- ${a.title} due ${a.due_at ?? "unknown"} (${a.status})`,
    ),
  ].join("\n");

  const recap = await completeText({
    prompt:
      `You are MyTutor's weekly study coach. Based on this week's data, write a short encouraging recap in markdown: what went well, one or two habit observations (session length, hint reliance, correctness trends), weak topics to review, and a concrete plan for next week tied to open assignments. Address the student directly. Keep it under 250 words.\n\n${facts}`,
    maxTokens: 800,
  });

  const weekOf = new Date().toISOString().slice(0, 10);
  const notePath = `Recommendations/Week of ${weekOf}.md`;
  await q(
    `insert into notes (user_id, course_id, subject, path, title, frontmatter, content, tags, links, source_session_id)
     values ($1, null, null, $2, $3, $4, $5, $6, '{}', null)
     on conflict (user_id, path) do update set content = excluded.content`,
    [
      userId,
      notePath,
      `Week of ${weekOf}`,
      {
        source: "mytutor",
        type: "weekly_recap",
        created: weekOf,
        tags: ["weekly-recap"],
      },
      recap,
      ["weekly-recap"],
    ],
  );

  return { recap, notePath };
}
