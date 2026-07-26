/**
 * weekly-recap — study-habit recommendations from the last 7 days.
 *
 * POST {} with a user JWT   → generates the caller's recap, writes it to the
 *                             vault (Recommendations/...), returns it.
 * POST {"all_users": true}  → service-role only (pg_cron); recaps every user
 *   with recent activity.
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
import type { WeeklyRecapResponse } from "../../../packages/shared/src/protocol.ts";

// deno-lint-ignore no-explicit-any
type Json = any;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const service = serviceClient();

    if (body.all_users === true) {
      // Cron path: require the service role key itself as the bearer.
      const auth = req.headers.get("Authorization") ?? "";
      if (auth !== `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`) {
        throw new HttpError(403, "all_users requires the service role");
      }
      const { data: users } = await service
        .from("sessions")
        .select("user_id")
        .gte("started_at", new Date(Date.now() - 7 * 86400_000).toISOString());
      const ids = [...new Set((users ?? []).map((u: Json) => u.user_id))];
      for (const id of ids) {
        try {
          await recapForUser(service, id as string);
        } catch (err) {
          console.error(`recap failed for ${id}:`, err);
        }
      }
      return jsonResponse({ users: ids.length });
    }

    const supabase = userClient(req);
    const { data: userData, error } = await supabase.auth.getUser();
    if (error || !userData.user) throw new HttpError(401, "Not authenticated");
    const result = await recapForUser(service, userData.user.id);
    return jsonResponse(result);
  } catch (err) {
    return errorResponse(err);
  }
});

async function recapForUser(
  service: Json,
  userId: string,
): Promise<WeeklyRecapResponse> {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();

  const [sessionsRes, eventsRes, gradesRes, assignmentsRes] = await Promise
    .all([
      service
        .from("sessions")
        .select("mode, started_at, ended_at, questions_answered, hints_given, answers_revealed, summary")
        .eq("user_id", userId)
        .eq("status", "completed")
        .gte("started_at", since)
        .order("started_at", { ascending: true }),
      service
        .from("session_events")
        .select("type, payload")
        .eq("user_id", userId)
        .eq("type", "question_answered")
        .gte("created_at", since),
      service
        .from("grades")
        .select("title, score, max_score, topics, graded_at")
        .eq("user_id", userId)
        .gte("created_at", since),
      service
        .from("assignments")
        .select("title, due_at, status, complexity, estimated_minutes")
        .eq("user_id", userId)
        .neq("status", "done")
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(10),
    ]);

  const sessions = sessionsRes.data ?? [];
  if (sessions.length === 0 && (gradesRes.data ?? []).length === 0) {
    return { recap: "No study activity this week — start a session and I'll have something to say!", notePath: null };
  }

  const minutes = sessions.reduce((sum: number, s: Json) => {
    if (!s.ended_at) return sum;
    return sum +
      Math.round(
        (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) /
          60000,
      );
  }, 0);
  const questions = (eventsRes.data ?? []).length;
  const correct = (eventsRes.data ?? []).filter(
    (e: Json) => e.payload?.correct === true,
  ).length;

  const facts = [
    `Sessions this week: ${sessions.length} (${minutes} minutes total)`,
    `Questions answered: ${questions} (${correct} correct)`,
    `Hints used: ${
      sessions.reduce((n: number, s: Json) => n + (s.hints_given ?? 0), 0)
    }, answers revealed: ${
      sessions.reduce((n: number, s: Json) => n + (s.answers_revealed ?? 0), 0)
    }`,
    "Session summaries:",
    ...sessions.map((s: Json) => `- [${s.mode}] ${s.summary ?? "(no summary)"}`),
    "Grades received:",
    ...(gradesRes.data ?? []).map(
      (g: Json) =>
        `- ${g.title}: ${g.score}/${g.max_score} [topics: ${(g.topics ?? []).join(", ")}]`,
    ),
    "Open assignments:",
    ...(assignmentsRes.data ?? []).map(
      (a: Json) => `- ${a.title} due ${a.due_at ?? "unknown"} (${a.status})`,
    ),
  ].join("\n");

  const anthropic = getAnthropic();
  const response = await anthropic.messages.create({
    model: UTILITY_MODEL,
    max_tokens: 1200,
    messages: [
      {
        role: "user",
        content:
          `You are MyTutor's weekly study coach. Based on this week's data, write a short encouraging recap in markdown: what went well, one or two habit observations (session length, hint reliance, correctness trends), weak topics to review, and a concrete plan for next week tied to open assignments. Address the student directly. Keep it under 250 words.\n\n${facts}`,
      },
    ],
  });
  const recap = response.content
    .filter((b: Json) => b.type === "text")
    .map((b: Json) => b.text)
    .join("");

  const weekOf = new Date().toISOString().slice(0, 10);
  const notePath = `Recommendations/Week of ${weekOf}.md`;
  await service.from("notes").upsert(
    {
      user_id: userId,
      course_id: null,
      subject: null,
      path: notePath,
      title: `Week of ${weekOf}`,
      frontmatter: {
        source: "mytutor",
        type: "weekly_recap",
        created: weekOf,
        tags: ["weekly-recap"],
      },
      content: recap,
      tags: ["weekly-recap"],
      links: [],
      source_session_id: null,
    },
    { onConflict: "user_id,path" },
  );

  return { recap, notePath };
}
