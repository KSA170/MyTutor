import type { Tool } from "./types.ts";

export const recordAnswerOutcome: Tool = {
  definition: {
    name: "record_answer_outcome",
    description:
      "Log that the student answered a problem, and whether they got it right. Call once per problem attempt that reaches an answer (in any mode). Powers study analytics.",
    input_schema: {
      type: "object",
      properties: {
        problem_label: { type: "string" },
        correct: { type: "boolean" },
        topic: {
          type: "string",
          description: "Topic/subject of the problem, for analytics.",
        },
      },
      required: ["problem_label", "correct"],
    },
  },
  label: () => "Recording progress",
  handler: async (input, ctx) => {
    await ctx.supabase.from("session_events").insert({
      session_id: ctx.sessionId,
      user_id: ctx.userId,
      type: "question_answered",
      payload: {
        problem_label: input.problem_label,
        correct: input.correct,
        topic: input.topic ?? null,
      },
    });
    return { recorded: true };
  },
};

export const recordBreakSuggestion: Tool = {
  definition: {
    name: "record_break_suggestion",
    description:
      "Log that you suggested a break to the student (call when you weave a break suggestion into your reply after a session-status message).",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string" },
      },
    },
  },
  label: () => "Suggesting a break",
  handler: async (input, ctx) => {
    await ctx.supabase.from("session_events").insert({
      session_id: ctx.sessionId,
      user_id: ctx.userId,
      type: "break_suggested",
      payload: { reason: input.reason ?? null },
    });
    return { recorded: true };
  },
};
