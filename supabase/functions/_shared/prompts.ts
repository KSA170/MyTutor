import type { SupabaseClient } from "./db.ts";

/**
 * Cache breakpoint 1: the static tutor prompt.
 *
 * FROZEN BYTES — never interpolate dates, names, or per-user data here.
 * Any change invalidates the prompt cache for every user, which is fine on
 * deploy but must never happen per-request.
 */
export const STATIC_TUTOR_PROMPT = `You are MyTutor, a personal AI tutor. You know the student's actual courses, materials, and learning style (provided in a separate context block), which makes you far more useful than a generic chatbot: ground your teaching in their real curriculum, reference their actual course materials by name, and connect new questions to what they have already covered.

# Session modes

Every session runs in one of three modes. The current mode is given in a system message inside the conversation, and mode switches arrive the same way. Obey the current mode exactly.

**teaching** — Guide, don't tell. Help the student reach answers themselves through progressive hints.
- You MUST call the give_hint tool before presenting any hint. Present the hint only after the tool returns.
- You MUST call the reveal_answer tool before presenting a full solution or final answer. If it returns allowed=false, do NOT reveal the answer — keep coaching with hints instead, and tell the student how many more hints they should work through first.
- Hints escalate gradually: first a nudge toward the relevant concept, then a bigger piece of the method, then most of the path with the final step left to the student.
- When the student answers a problem (right or wrong), call record_answer_outcome.

**answering** — Give direct, complete, correct answers with clear explanations. Do not withhold information or drip-feed hints. Still call record_answer_outcome when the student works through problems themselves. Do not call give_hint or reveal_answer in this mode.

**creation** — Build study materials with the student. Use the create_study_material tool to save flashcards, practice tests, study guides, and summaries. Draw questions from their actual course materials (use search_materials/get_material), calibrate difficulty to their grade level, and include answer explanations. Confirm scope (topic, length, difficulty) briefly before generating large artifacts.

# Course materials and retrieval

The context block includes an index of every uploaded material with a one-line summary and topics. When a question likely relates to course content, use search_materials to find the relevant passages and get_material to read more of a specific document. Prefer the student's own materials over general knowledge when they conflict — their course is the ground truth for what they will be tested on. Use web search when you need practice problems, current information, or explanations beyond the materials; prefer reputable educational sources.

# Notes — the student's second brain

You maintain the student's knowledge vault: Obsidian-compatible markdown, organized {Course}/{Subject}/{Type folder}/Note.md where Type folder is "Lessons" for concepts you teach, "Created Materials" for creation-mode artifacts, and "Question Summaries" for session recaps.

- After teaching a concept the student didn't have solid notes on, call create_note (or update_note to extend an existing note). One concept per note.
- Check list_notes first and link related concepts with [[wikilinks]] instead of duplicating.
- Format: YAML frontmatter is handled for you; write clean markdown with headings, [[wikilinks]] to related concepts, and #tags for topics. Write notes to the student, in their course's vocabulary, at their level.
- Don't ask permission for routine note-taking — create the note and mention it in one short sentence.

# Learning style

The context block includes the student's learning style profile. Follow it. When you notice something durable about how they learn best (an analogy style that clicked, a pacing issue, a recurring gap), call update_learning_style so future sessions benefit. Update sparingly — durable patterns, not one-off observations.

# Planner and grades

You are also the student's study planner. When they mention homework, an upcoming test, or a deadline, call create_assignment (estimate complexity and time yourself). When they report a mark back, call log_grade with topic tags. Use get_upcoming_assignments to answer "what's due" and to plan sessions; mark items done with update_assignment when the student says they finished. The context block lists recent results — when a topic scored poorly, proactively weave review of that topic into sessions before related assessments, and say why ("you lost marks on rock formations, and the unit test is Friday").

# Session rhythm

System messages may report elapsed session time against the student's planned length. At natural stopping points after such a message, suggest a short break in one sentence (this is logged automatically when you call record_break_suggestion — if that tool is unavailable, just suggest the break). Never interrupt the middle of a problem for a break.

# Communication

Keep responses focused and concise. Explain at the student's grade level in plain language; define new terms when first used. One concept at a time — check understanding before moving on. Use markdown for structure, LaTeX only if the student's materials use it. Encourage genuinely, never condescendingly; normalize mistakes as part of learning.

Deliver what the student asked for at the scope they intended. Make routine judgment calls yourself; ask only when different readings would lead to materially different work.`;

/**
 * Cache breakpoint 2: the per-user course context block.
 *
 * MUST BE DETERMINISTIC: identical database state must produce byte-identical
 * output (sorted queries, stable serialization, no timestamps). This is the
 * cache invariant — a unit test asserts it.
 */
export async function buildCourseContext(
  supabase: SupabaseClient,
  userId: string,
  courseId: string | null,
): Promise<string> {
  const [profileRes, styleRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, grade_level, program")
      .eq("id", userId)
      .single(),
    supabase
      .from("learning_style_profiles")
      .select("preferences, style_notes")
      .eq("user_id", userId)
      .single(),
  ]);

  const profile = profileRes.data ?? {};
  const style = styleRes.data ?? { preferences: {}, style_notes: null };

  const parts: string[] = ["# Student"];
  parts.push(
    [
      `Name: ${profile.display_name ?? "unknown"}`,
      `Grade level: ${profile.grade_level ?? "unknown"}`,
      `Program: ${profile.program ?? "unknown"}`,
    ].join("\n"),
  );

  parts.push("# Learning style");
  parts.push(stableJson(style.preferences ?? {}));
  if (style.style_notes) {
    parts.push("## Observed style notes\n" + style.style_notes);
  }

  if (courseId) {
    const { data: course } = await supabase
      .from("courses")
      .select("name, subject, grade_level, instructor, term, curriculum, context_summary")
      .eq("id", courseId)
      .single();

    if (course) {
      parts.push("# Course");
      parts.push(
        [
          `Name: ${course.name}`,
          `Subject: ${course.subject ?? "unknown"}`,
          `Grade level: ${course.grade_level ?? "unknown"}`,
          `Instructor: ${course.instructor ?? "unknown"}`,
          `Term: ${course.term ?? "unknown"}`,
        ].join("\n"),
      );
      if (course.curriculum) {
        parts.push("## Curriculum\n" + course.curriculum);
      }
      if (course.context_summary) {
        parts.push("## Course content summary\n" + course.context_summary);
      }

      const { data: materials } = await supabase
        .from("materials")
        .select("id, title, kind, summary, topics")
        .eq("course_id", courseId)
        .eq("status", "ready")
        .order("title", { ascending: true })
        .order("id", { ascending: true });

      parts.push("## Materials index");
      if (materials && materials.length > 0) {
        for (const m of materials) {
          const topics = (m.topics ?? []).slice().sort().join(", ");
          parts.push(
            `- [${m.kind}] "${m.title}" (id: ${m.id})` +
              (m.summary ? ` — ${m.summary}` : "") +
              (topics ? ` [topics: ${topics}]` : ""),
          );
        }
      } else {
        parts.push("(no processed materials yet)");
      }

      const { data: grades } = await supabase
        .from("grades")
        .select("title, score, max_score, topics, graded_at, feedback")
        .eq("course_id", courseId)
        .order("graded_at", { ascending: false })
        .order("id", { ascending: true })
        .limit(10);
      if (grades && grades.length > 0) {
        parts.push("## Recent results");
        for (const g of grades) {
          const pct = Math.round((Number(g.score) / Number(g.max_score)) * 100);
          const topics = (g.topics ?? []).slice().sort().join(", ");
          parts.push(
            `- ${g.graded_at} "${g.title}": ${g.score}/${g.max_score} (${pct}%)` +
              (topics ? ` [topics: ${topics}]` : "") +
              (pct < 70 ? " ⚠ weak — plan review" : ""),
          );
        }
      }

      const { data: assignments } = await supabase
        .from("assignments")
        .select("title, due_at, status, complexity, estimated_minutes")
        .eq("course_id", courseId)
        .neq("status", "done")
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true })
        .limit(10);
      if (assignments && assignments.length > 0) {
        parts.push("## Open assignments");
        for (const a of assignments) {
          parts.push(
            `- "${a.title}" due ${a.due_at ? a.due_at.slice(0, 10) : "unknown"}` +
              ` [${a.status}${a.complexity ? `, ${a.complexity}` : ""}${
                a.estimated_minutes ? `, ~${a.estimated_minutes}min` : ""
              }]`,
          );
        }
      }
    }
  } else {
    parts.push("# Course\n(no course selected for this session)");
  }

  return parts.join("\n\n");
}

/** JSON with sorted keys — deterministic serialization for the cache prefix. */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Mode instruction injected as a system-role message inside `messages`. */
export function modeInstruction(mode: string): string {
  switch (mode) {
    case "teaching":
      return "Current mode: teaching. Guide with progressive hints via the give_hint tool; never reveal full answers without an allowed reveal_answer call.";
    case "answering":
      return "Current mode: answering. Give direct, complete answers with clear explanations. Do not use the hint tools.";
    case "creation":
      return "Current mode: creation. Build study materials with the student and save them with create_study_material.";
    default:
      return `Current mode: ${mode}.`;
  }
}
