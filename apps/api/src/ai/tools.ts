/**
 * The tutor's 15 tools — OpenAI function-calling format, handlers on pg.
 * Same names, gating, and SSE side-channel events as the original build.
 */
import type { SseEvent } from "@mytutor/shared";
import { HINTS_BEFORE_REVEAL, VAULT_TYPE_FOLDERS } from "@mytutor/shared";
import { one, q } from "../db.js";
import { parseTags, parseWikilinks, validateVaultPath } from "../lib/vault.js";

// deno-lint-ignore no-explicit-any
type Json = any;

export interface ToolContext {
  userId: string;
  sessionId: string;
  courseId: string | null;
  mode: string;
  emit: (event: SseEvent) => void;
}

interface Tool {
  name: string;
  description: string;
  parameters: Json;
  label: (input: Json) => string;
  handler: (input: Json, ctx: ToolContext) => Promise<unknown>;
}

const obj = (properties: Json, required: string[] = []): Json => ({
  type: "object",
  properties,
  required,
});

async function logEvent(
  ctx: ToolContext,
  type: string,
  payload: Json,
): Promise<void> {
  await q(
    "insert into session_events (session_id, user_id, type, payload) values ($1, $2, $3, $4)",
    [ctx.sessionId, ctx.userId, type, payload],
  );
}

async function hintsForProblem(
  ctx: ToolContext,
  problemLabel: string,
): Promise<number> {
  const row = await one(
    "select count(*)::int as n from session_events where session_id = $1 and type = 'hint_given' and payload->>'problem_label' = $2",
    [ctx.sessionId, problemLabel],
  );
  return row?.n ?? 0;
}

async function saveNote(
  ctx: ToolContext,
  input: Json,
  mode: "create" | "append" | "replace",
): Promise<unknown> {
  const pathError = validateVaultPath(input.path);
  if (pathError) return { error: pathError };

  const existing = await one(
    "select id, content, frontmatter from notes where user_id = $1 and path = $2",
    [ctx.userId, input.path],
  );

  let content: string = input.content;
  if (mode === "append" && existing) {
    content = existing.content.trimEnd() + "\n\n" + input.content;
  }

  const links = parseWikilinks(content);
  const tags = [
    ...new Set([...(input.tags ?? []), ...parseTags(content)]),
  ].sort();
  const frontmatter: Json = {
    ...(existing?.frontmatter ?? {}),
    tags,
    source: "mytutor",
    ...(input.subject ? { subject: input.subject } : {}),
  };
  if (!existing) frontmatter.created = new Date().toISOString().slice(0, 10);

  const saved = await one(
    `insert into notes (user_id, course_id, subject, path, title, frontmatter, content, tags, links, source_session_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (user_id, path) do update set
       title = excluded.title, frontmatter = excluded.frontmatter,
       content = excluded.content, tags = excluded.tags,
       links = excluded.links, subject = excluded.subject
     returning id, path, title`,
    [
      ctx.userId,
      ctx.courseId,
      input.subject ?? null,
      input.path,
      input.title,
      frontmatter,
      content,
      tags,
      links,
      ctx.sessionId,
    ],
  );

  await logEvent(ctx, "note_created", {
    note_id: saved!.id,
    path: saved!.path,
    updated: !!existing,
  });
  ctx.emit({
    type: "note",
    noteId: saved!.id,
    path: saved!.path,
    title: saved!.title,
  });
  return { saved: true, note_id: saved!.id, path: saved!.path, linked_concepts: links };
}

const TOOL_LIST: Tool[] = [
  {
    name: "search_materials",
    description:
      "Full-text search across the student's uploaded course materials for this course. Call this when a question likely relates to course content. Returns the most relevant passages with their source material and pages.",
    parameters: obj(
      {
        query: {
          type: "string",
          description: "Search terms — key concepts, not full sentences.",
        },
        max_results: { type: "integer", description: "Default 6, max 20." },
      },
      ["query"],
    ),
    label: (i) => `Searching materials: ${i.query}`,
    handler: async (input, ctx) => {
      if (!ctx.courseId) return { error: "No course attached to this session." };
      const rows = await q(
        "select * from search_material_chunks($1, $2, $3, $4)",
        [ctx.userId, ctx.courseId, input.query, input.max_results ?? 6],
      );
      if (rows.length === 0) {
        return {
          results: [],
          note: "No passages matched. Try different terms, or read a material with get_material using its id from the materials index.",
        };
      }
      return {
        results: rows.map((r) => ({
          material_id: r.material_id,
          material_title: r.material_title,
          pages: r.page_start != null ? `${r.page_start}-${r.page_end}` : null,
          content: r.content,
        })),
      };
    },
  },
  {
    name: "get_material",
    description:
      "Read the extracted content of one uploaded material by id (ids are in the materials index). Content is returned in sequential chunks.",
    parameters: obj(
      {
        material_id: { type: "string" },
        from_chunk: { type: "integer", description: "Default 0." },
        max_chunks: { type: "integer", description: "Default 4, max 10." },
      },
      ["material_id"],
    ),
    label: () => "Reading course material",
    handler: async (input, ctx) => {
      const material = await one(
        "select title, kind, page_count from materials where id = $1 and user_id = $2",
        [input.material_id, ctx.userId],
      );
      if (!material) return { error: "Material not found." };
      const from = input.from_chunk ?? 0;
      const count = Math.min(input.max_chunks ?? 4, 10);
      const chunks = await q(
        "select seq, page_start, page_end, content from material_chunks where material_id = $1 and seq >= $2 order by seq asc limit $3",
        [input.material_id, from, count],
      );
      const total = await one(
        "select count(*)::int as n from material_chunks where material_id = $1",
        [input.material_id],
      );
      return {
        title: material.title,
        kind: material.kind,
        total_chunks: total?.n ?? 0,
        chunks: chunks.map((c) => ({
          seq: c.seq,
          pages: c.page_start != null ? `${c.page_start}-${c.page_end}` : null,
          content: c.content,
        })),
      };
    },
  },
  {
    name: "create_note",
    description:
      'Create a note in the student\'s Obsidian-compatible vault. Path convention: "{Course}/{Subject}/{Type}/Title.md" where Type is "Lessons", "Created Materials", or "Question Summaries". Write clean markdown with [[wikilinks]] and #tags. One concept per note.',
    parameters: obj(
      {
        path: { type: "string" },
        title: { type: "string" },
        content: { type: "string", description: "Markdown body (no frontmatter)." },
        subject: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      ["path", "title", "content"],
    ),
    label: (i) => `Writing note: ${i.title ?? i.path}`,
    handler: (input, ctx) => saveNote(ctx, input, "create"),
  },
  {
    name: "update_note",
    description:
      "Extend or rewrite an existing vault note. Mode 'append' adds to the end, 'replace' rewrites the body.",
    parameters: obj(
      {
        path: { type: "string" },
        title: { type: "string" },
        content: { type: "string" },
        mode: { type: "string", enum: ["append", "replace"] },
        subject: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      ["path", "title", "content", "mode"],
    ),
    label: (i) => `Updating note: ${i.title ?? i.path}`,
    handler: (input, ctx) =>
      saveNote(ctx, input, input.mode === "append" ? "append" : "replace"),
  },
  {
    name: "list_notes",
    description:
      "List the student's existing vault notes (paths, titles, tags) so you can [[link]] instead of duplicating, or find a note to update.",
    parameters: obj({
      folder: { type: "string", description: "Path prefix filter." },
      query: { type: "string", description: "Match against title and path." },
    }),
    label: () => "Checking existing notes",
    handler: async (input, ctx) => {
      const params: unknown[] = [ctx.userId];
      let sql =
        "select path, title, subject, tags from notes where user_id = $1";
      if (input.folder) {
        params.push(input.folder + "%");
        sql += ` and path like $${params.length}`;
      }
      if (input.query) {
        params.push(`%${input.query}%`);
        sql += ` and (title ilike $${params.length} or path ilike $${params.length})`;
      }
      sql += " order by path asc limit 200";
      return { notes: await q(sql, params) };
    },
  },
  {
    name: "give_hint",
    description:
      "REQUIRED in teaching mode before presenting any hint. Registers the hint so progress is tracked server-side. Reuse the same problem_label for every hint on the same problem.",
    parameters: obj(
      {
        problem_label: { type: "string", description: 'e.g. "quadratic-q3".' },
        hint_text: { type: "string" },
      },
      ["problem_label", "hint_text"],
    ),
    label: () => "Preparing a hint",
    handler: async (input, ctx) => {
      await logEvent(ctx, "hint_given", {
        problem_label: input.problem_label,
        hint_text: input.hint_text,
      });
      const given = await hintsForProblem(ctx, input.problem_label);
      const revealAllowed = given >= HINTS_BEFORE_REVEAL;
      ctx.emit({
        type: "hint",
        problemLabel: input.problem_label,
        hintsGiven: given,
        revealAllowed,
      });
      return {
        hints_given_for_problem: given,
        reveal_allowed: revealAllowed,
        hints_before_reveal: HINTS_BEFORE_REVEAL,
      };
    },
  },
  {
    name: "reveal_answer",
    description:
      "REQUIRED in teaching mode before presenting a full solution. The server decides whether revealing is allowed (enough hints, or the student explicitly gave up). If allowed=false, keep coaching — do NOT reveal.",
    parameters: obj(
      {
        problem_label: { type: "string" },
        student_gave_up: {
          type: "boolean",
          description:
            "true ONLY if the student explicitly gave up after genuinely trying.",
        },
      },
      ["problem_label"],
    ),
    label: () => "Checking whether to reveal the answer",
    handler: async (input, ctx) => {
      const given = await hintsForProblem(ctx, input.problem_label);
      const allowed = given >= HINTS_BEFORE_REVEAL ||
        input.student_gave_up === true;
      if (!allowed) {
        return {
          allowed: false,
          hints_given_for_problem: given,
          hints_remaining: HINTS_BEFORE_REVEAL - given,
          instruction:
            "Not yet — give the next progressive hint instead and encourage the student to try.",
        };
      }
      await logEvent(ctx, "answer_revealed", {
        problem_label: input.problem_label,
        after_hints: given,
        student_gave_up: input.student_gave_up === true,
      });
      return { allowed: true, hints_given_for_problem: given };
    },
  },
  {
    name: "record_answer_outcome",
    description:
      "Log that the student answered a problem and whether they got it right. Call once per attempt that reaches an answer, in any mode.",
    parameters: obj(
      {
        problem_label: { type: "string" },
        correct: { type: "boolean" },
        topic: { type: "string" },
      },
      ["problem_label", "correct"],
    ),
    label: () => "Recording progress",
    handler: async (input, ctx) => {
      await logEvent(ctx, "question_answered", {
        problem_label: input.problem_label,
        correct: input.correct,
        topic: input.topic ?? null,
      });
      return { recorded: true };
    },
  },
  {
    name: "record_break_suggestion",
    description:
      "Log that you suggested a break (call when you weave one into your reply after a session-status message).",
    parameters: obj({ reason: { type: "string" } }),
    label: () => "Suggesting a break",
    handler: async (input, ctx) => {
      await logEvent(ctx, "break_suggested", { reason: input.reason ?? null });
      return { recorded: true };
    },
  },
  {
    name: "update_learning_style",
    description:
      "Persist a durable observation about how this student learns best. Use sparingly — recurring patterns, not one-off events.",
    parameters: obj({
      preferences_patch: {
        type: "object",
        description:
          "Partial update: analogies, step_by_step, real_world_examples, visual, socratic (booleans), pace ('slow'|'moderate'|'fast').",
        properties: {
          analogies: { type: "boolean" },
          step_by_step: { type: "boolean" },
          real_world_examples: { type: "boolean" },
          visual: { type: "boolean" },
          socratic: { type: "boolean" },
          pace: { type: "string", enum: ["slow", "moderate", "fast"] },
        },
      },
      style_notes_append: { type: "string" },
    }),
    label: () => "Updating learning style profile",
    handler: async (input, ctx) => {
      const current = await one(
        "select preferences, style_notes from learning_style_profiles where user_id = $1",
        [ctx.userId],
      );
      if (!current) return { error: "Style profile not found." };
      const preferences = {
        ...current.preferences,
        ...(input.preferences_patch ?? {}),
      };
      let styleNotes: string = current.style_notes ?? "";
      if (input.style_notes_append) {
        styleNotes = (styleNotes.trimEnd() + "\n- " + input.style_notes_append)
          .trim().slice(-8000);
      }
      await q(
        "update learning_style_profiles set preferences = $1, style_notes = $2 where user_id = $3",
        [preferences, styleNotes || null, ctx.userId],
      );
      return { saved: true };
    },
  },
  {
    name: "create_study_material",
    description:
      "Save a study artifact: flashcards, a practice test, a study guide, or a summary. Structured so the app can render it; a markdown copy lands in the vault under {Course}/{Subject}/Created Materials/.",
    parameters: obj(
      {
        kind: {
          type: "string",
          enum: ["practice_test", "flashcards", "study_guide", "summary", "other"],
        },
        title: { type: "string" },
        description: { type: "string" },
        subject: { type: "string" },
        flashcards: {
          type: "array",
          description: "Required when kind=flashcards.",
          items: obj(
            { front: { type: "string" }, back: { type: "string" } },
            ["front", "back"],
          ),
        },
        questions: {
          type: "array",
          description: "Required when kind=practice_test.",
          items: obj(
            {
              prompt: { type: "string" },
              choices: { type: "array", items: { type: "string" } },
              answer: { type: "string" },
              explanation: { type: "string" },
            },
            ["prompt", "answer"],
          ),
        },
        markdown: {
          type: "string",
          description: "Required for study_guide / summary / other.",
        },
      },
      ["kind", "title", "subject"],
    ),
    label: (i) =>
      `Creating ${String(i.kind ?? "material").replace("_", " ")}: ${i.title}`,
    handler: async (input, ctx) => {
      if (!ctx.courseId) return { error: "No course attached to this session." };

      let content: Json;
      let markdown: string;
      if (input.kind === "flashcards") {
        const cards = input.flashcards ?? [];
        if (!cards.length) return { error: "flashcards array is required." };
        content = { kind: "flashcards", cards };
        markdown = cards
          .map(
            (c: Json, i: number) =>
              `## Card ${i + 1}\n**Q:** ${c.front}\n\n**A:** ${c.back}`,
          )
          .join("\n\n");
      } else if (input.kind === "practice_test") {
        const questions = input.questions ?? [];
        if (!questions.length) return { error: "questions array is required." };
        content = { kind: "practice_test", questions };
        markdown = questions
          .map(
            (qn: Json, i: number) =>
              `## Question ${i + 1}\n${qn.prompt}\n` +
              (qn.choices?.length
                ? qn.choices
                  .map((c: string, j: number) =>
                    `- ${String.fromCharCode(65 + j)}. ${c}`
                  )
                  .join("\n") + "\n"
                : "") +
              `\n**Answer:** ${qn.answer}` +
              (qn.explanation ? `\n\n*${qn.explanation}*` : ""),
          )
          .join("\n\n");
      } else {
        if (!input.markdown) return { error: "markdown is required for this kind." };
        content = { kind: input.kind, markdown: input.markdown };
        markdown = input.markdown;
      }

      const course = await one(
        "select name from courses where id = $1 and user_id = $2",
        [ctx.courseId, ctx.userId],
      );
      const safeTitle = String(input.title).replace(/[/\\:*?"<>|]/g, "-").trim();
      const notePath = `${course?.name ?? "Course"}/${input.subject}/${VAULT_TYPE_FOLDERS.created}/${safeTitle}.md`;
      const pathOk = validateVaultPath(notePath) === null;

      const saved = await one(
        `insert into creations (user_id, course_id, session_id, subject, kind, title, description, content, note_path)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id, kind, title`,
        [
          ctx.userId,
          ctx.courseId,
          ctx.sessionId,
          input.subject,
          input.kind,
          input.title,
          input.description ?? null,
          content,
          pathOk ? notePath : null,
        ],
      );

      if (pathOk) {
        await saveNote(
          ctx,
          {
            path: notePath,
            title: input.title,
            content: markdown,
            subject: input.subject,
            tags: [String(input.subject).toLowerCase().replace(/\s+/g, "-")],
          },
          "replace",
        );
      }
      await logEvent(ctx, "creation_saved", {
        creation_id: saved!.id,
        kind: saved!.kind,
        title: saved!.title,
      });
      ctx.emit({
        type: "creation",
        creationId: saved!.id,
        kind: saved!.kind,
        title: saved!.title,
      });
      return { saved: true, creation_id: saved!.id, vault_path: pathOk ? notePath : null };
    },
  },
  {
    name: "create_assignment",
    description:
      "Log a new assignment, homework, or upcoming test the student mentions. Estimate complexity and time yourself; confirm ambiguous due dates with the student.",
    parameters: obj(
      {
        title: { type: "string" },
        description: { type: "string" },
        due_at: { type: "string", description: "ISO 8601." },
        estimated_minutes: { type: "integer" },
        complexity: { type: "string", enum: ["low", "medium", "high"] },
      },
      ["title"],
    ),
    label: (i) => `Logging assignment: ${i.title}`,
    handler: async (input, ctx) => {
      if (!ctx.courseId) return { error: "No course attached to this session." };
      const row = await one(
        `insert into assignments (user_id, course_id, title, description, due_at, estimated_minutes, complexity)
         values ($1, $2, $3, $4, $5, $6, $7) returning id, title, due_at`,
        [
          ctx.userId,
          ctx.courseId,
          input.title,
          input.description ?? null,
          input.due_at ?? null,
          input.estimated_minutes ?? null,
          input.complexity ?? null,
        ],
      );
      return { saved: true, assignment: row };
    },
  },
  {
    name: "update_assignment",
    description:
      "Update a tracked assignment — status, due date, or estimates. Use get_upcoming_assignments to find the id.",
    parameters: obj(
      {
        assignment_id: { type: "string" },
        status: { type: "string", enum: ["todo", "in_progress", "done"] },
        due_at: { type: "string" },
        estimated_minutes: { type: "integer" },
        complexity: { type: "string", enum: ["low", "medium", "high"] },
        description: { type: "string" },
      },
      ["assignment_id"],
    ),
    label: () => "Updating assignment",
    handler: async (input, ctx) => {
      const sets: string[] = [];
      const params: unknown[] = [input.assignment_id, ctx.userId];
      for (
        const key of ["status", "due_at", "estimated_minutes", "complexity", "description"]
      ) {
        if (input[key] !== undefined) {
          params.push(input[key]);
          sets.push(`${key} = $${params.length}`);
        }
      }
      if (input.status === "done") sets.push("completed_at = now()");
      if (!sets.length) return { error: "Nothing to update." };
      const row = await one(
        `update assignments set ${sets.join(", ")} where id = $1 and user_id = $2 returning id, title, status, due_at`,
        params,
      );
      return row ? { saved: true, assignment: row } : { error: "Not found." };
    },
  },
  {
    name: "get_upcoming_assignments",
    description:
      "List tracked assignments and tests (all courses), soonest due first.",
    parameters: obj({
      include_done: { type: "boolean", description: "Default false." },
    }),
    label: () => "Checking upcoming assignments",
    handler: async (input, ctx) => {
      const rows = await q(
        `select id, course_id, title, description, due_at, estimated_minutes, complexity, status
         from assignments where user_id = $1 ${input.include_done ? "" : "and status <> 'done'"}
         order by due_at asc nulls last limit 25`,
        [ctx.userId],
      );
      return { assignments: rows };
    },
  },
  {
    name: "log_grade",
    description:
      "Record a grade the student received. Tag topics — low-scoring topics drive future review planning.",
    parameters: obj(
      {
        title: { type: "string" },
        score: { type: "number" },
        max_score: { type: "number" },
        weight: { type: "number" },
        feedback: { type: "string" },
        topics: { type: "array", items: { type: "string" } },
        assignment_id: { type: "string" },
        graded_at: { type: "string", description: "YYYY-MM-DD." },
      },
      ["title", "score", "max_score"],
    ),
    label: (i) => `Recording grade: ${i.title}`,
    handler: async (input, ctx) => {
      if (!ctx.courseId) return { error: "No course attached to this session." };
      const row = await one(
        `insert into grades (user_id, course_id, assignment_id, title, score, max_score, weight, feedback, topics, graded_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::date, current_date))
         returning id, title, score, max_score`,
        [
          ctx.userId,
          ctx.courseId,
          input.assignment_id ?? null,
          input.title,
          input.score,
          input.max_score,
          input.weight ?? null,
          input.feedback ?? null,
          input.topics ?? [],
          input.graded_at ?? null,
        ],
      );
      const pct = Math.round((input.score / input.max_score) * 100);
      return {
        saved: true,
        grade: row,
        percent: pct,
        note: pct < 70
          ? "Below 70% — consider suggesting a review plan for the weak topics."
          : undefined,
      };
    },
  },
];

const TOOLS = TOOL_LIST.sort((a, b) => a.name.localeCompare(b.name));

/** OpenAI-format tool definitions (deterministic order). */
export const toolDefinitions = TOOLS.map((t) => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  },
}));

const registry = new Map(TOOLS.map((t) => [t.name, t]));

export function toolLabel(name: string, input: Json): string {
  const tool = registry.get(name);
  if (!tool) return name;
  try {
    return tool.label(input);
  } catch {
    return name;
  }
}

export async function runTool(
  name: string,
  input: Json,
  ctx: ToolContext,
): Promise<string> {
  const tool = registry.get(name);
  if (!tool) return JSON.stringify({ error: `Unknown tool: ${name}` });
  try {
    const result = await tool.handler(input, ctx);
    return JSON.stringify(result ?? { ok: true });
  } catch (err) {
    console.error(`Tool ${name} failed:`, err);
    return JSON.stringify({
      error: `Tool execution failed: ${(err as Error).message}`,
    });
  }
}
