import type { Tool } from "./types.ts";

export const createAssignment: Tool = {
  definition: {
    name: "create_assignment",
    description:
      "Log a new assignment, homework, or upcoming test the student mentions, so MyTutor can track the due date and help plan. Estimate complexity and time from what you know of the student and course. Confirm the due date with the student if it's ambiguous.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        due_at: {
          type: "string",
          description: "Due date/time, ISO 8601 (e.g. 2026-08-14 or 2026-08-14T15:00:00Z).",
        },
        estimated_minutes: {
          type: "integer",
          description: "Your estimate of the total work time.",
        },
        complexity: { type: "string", enum: ["low", "medium", "high"] },
      },
      required: ["title"],
    },
  },
  label: (input) => `Logging assignment: ${input.title}`,
  handler: async (input, ctx) => {
    if (!ctx.courseId) return { error: "No course attached to this session." };
    const { data, error } = await ctx.supabase
      .from("assignments")
      .insert({
        user_id: ctx.userId,
        course_id: ctx.courseId,
        title: input.title,
        description: input.description ?? null,
        due_at: input.due_at ?? null,
        estimated_minutes: input.estimated_minutes ?? null,
        complexity: input.complexity ?? null,
      })
      .select("id, title, due_at")
      .single();
    if (error) return { error: error.message };
    return { saved: true, assignment: data };
  },
};

export const updateAssignment: Tool = {
  definition: {
    name: "update_assignment",
    description:
      "Update a tracked assignment — mark it done or in progress, or fix the due date/estimate. Use get_upcoming_assignments first to find the id.",
    input_schema: {
      type: "object",
      properties: {
        assignment_id: { type: "string" },
        status: { type: "string", enum: ["todo", "in_progress", "done"] },
        due_at: { type: "string" },
        estimated_minutes: { type: "integer" },
        complexity: { type: "string", enum: ["low", "medium", "high"] },
        description: { type: "string" },
      },
      required: ["assignment_id"],
    },
  },
  label: () => "Updating assignment",
  handler: async (input, ctx) => {
    const patch: Record<string, unknown> = {};
    for (const key of ["status", "due_at", "estimated_minutes", "complexity", "description"]) {
      if (input[key] !== undefined) patch[key] = input[key];
    }
    if (input.status === "done") patch.completed_at = new Date().toISOString();
    if (Object.keys(patch).length === 0) return { error: "Nothing to update." };
    const { data, error } = await ctx.supabase
      .from("assignments")
      .update(patch)
      .eq("id", input.assignment_id)
      .eq("user_id", ctx.userId)
      .select("id, title, status, due_at")
      .single();
    if (error) return { error: error.message };
    return { saved: true, assignment: data };
  },
};

export const getUpcomingAssignments: Tool = {
  definition: {
    name: "get_upcoming_assignments",
    description:
      "List the student's tracked assignments and tests (all courses), soonest due first. Use to answer 'what's due', plan study time, or find an assignment id to update.",
    input_schema: {
      type: "object",
      properties: {
        include_done: {
          type: "boolean",
          description: "Include completed assignments (default false).",
        },
      },
    },
  },
  label: () => "Checking upcoming assignments",
  handler: async (input, ctx) => {
    let q = ctx.supabase
      .from("assignments")
      .select("id, course_id, title, description, due_at, estimated_minutes, complexity, status")
      .eq("user_id", ctx.userId)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(25);
    if (!input.include_done) q = q.neq("status", "done");
    const { data, error } = await q;
    if (error) return { error: error.message };
    return { assignments: data ?? [] };
  },
};

export const logGrade: Tool = {
  definition: {
    name: "log_grade",
    description:
      "Record a grade/mark the student received (test, quiz, assignment). Tag the topics it covered — low-scoring topics drive future review planning. If it matches a tracked assignment, pass its id and mark that assignment done separately.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: 'e.g. "Unit 1 Geology Test"' },
        score: { type: "number" },
        max_score: { type: "number" },
        weight: {
          type: "number",
          description: "Weight in the course grade, as a percentage, if known.",
        },
        feedback: { type: "string", description: "Teacher feedback, if any." },
        topics: {
          type: "array",
          items: { type: "string" },
          description: "Topics covered, especially ones the student lost marks on.",
        },
        assignment_id: { type: "string" },
        graded_at: { type: "string", description: "Date received, YYYY-MM-DD." },
      },
      required: ["title", "score", "max_score"],
    },
  },
  label: (input) => `Recording grade: ${input.title}`,
  handler: async (input, ctx) => {
    if (!ctx.courseId) return { error: "No course attached to this session." };
    const { data, error } = await ctx.supabase
      .from("grades")
      .insert({
        user_id: ctx.userId,
        course_id: ctx.courseId,
        assignment_id: input.assignment_id ?? null,
        title: input.title,
        score: input.score,
        max_score: input.max_score,
        weight: input.weight ?? null,
        feedback: input.feedback ?? null,
        topics: input.topics ?? [],
        ...(input.graded_at ? { graded_at: input.graded_at } : {}),
      })
      .select("id, title, score, max_score")
      .single();
    if (error) return { error: error.message };
    const pct = Math.round((input.score / input.max_score) * 100);
    return {
      saved: true,
      grade: data,
      percent: pct,
      note: pct < 70
        ? "Below 70% — consider suggesting a review plan for the weak topics."
        : undefined,
    };
  },
};
