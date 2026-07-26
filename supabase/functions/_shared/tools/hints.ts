import type { Tool, ToolContext } from "./types.ts";
import { HINTS_BEFORE_REVEAL } from "../../../../packages/shared/src/protocol.ts";

async function hintsForProblem(
  ctx: ToolContext,
  problemLabel: string,
): Promise<number> {
  const { count } = await ctx.supabase
    .from("session_events")
    .select("id", { count: "exact", head: true })
    .eq("session_id", ctx.sessionId)
    .eq("type", "hint_given")
    .eq("payload->>problem_label", problemLabel);
  return count ?? 0;
}

export const giveHint: Tool = {
  definition: {
    name: "give_hint",
    description:
      "REQUIRED in teaching mode before presenting any hint. Registers the hint so progress is tracked server-side. Call with a short stable label for the problem (reuse the same label for every hint on the same problem) and the hint you are about to give. Present the hint to the student only after this returns.",
    input_schema: {
      type: "object",
      properties: {
        problem_label: {
          type: "string",
          description:
            'Short stable identifier for the problem, e.g. "quadratic-q3". Reuse across hints for the same problem.',
        },
        hint_text: {
          type: "string",
          description: "The hint you are about to present.",
        },
      },
      required: ["problem_label", "hint_text"],
    },
  },
  label: () => "Preparing a hint",
  handler: async (input, ctx) => {
    await ctx.supabase.from("session_events").insert({
      session_id: ctx.sessionId,
      user_id: ctx.userId,
      type: "hint_given",
      payload: { problem_label: input.problem_label, hint_text: input.hint_text },
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
};

export const revealAnswer: Tool = {
  definition: {
    name: "reveal_answer",
    description:
      "REQUIRED in teaching mode before presenting a full solution or final answer. The server decides whether revealing is allowed (enough hints given, or the student explicitly gave up). If allowed=false, keep coaching with hints — do NOT reveal the answer.",
    input_schema: {
      type: "object",
      properties: {
        problem_label: {
          type: "string",
          description: "Same label used with give_hint for this problem.",
        },
        student_gave_up: {
          type: "boolean",
          description:
            "true ONLY if the student explicitly said they give up or asked to see the answer after genuinely trying.",
        },
      },
      required: ["problem_label"],
    },
  },
  label: () => "Checking whether to reveal the answer",
  handler: async (input, ctx) => {
    const given = await hintsForProblem(ctx, input.problem_label);
    const allowed = given >= HINTS_BEFORE_REVEAL || input.student_gave_up === true;
    if (!allowed) {
      return {
        allowed: false,
        hints_given_for_problem: given,
        hints_remaining: HINTS_BEFORE_REVEAL - given,
        instruction:
          "Not yet — give the next progressive hint instead and encourage the student to try.",
      };
    }
    await ctx.supabase.from("session_events").insert({
      session_id: ctx.sessionId,
      user_id: ctx.userId,
      type: "answer_revealed",
      payload: {
        problem_label: input.problem_label,
        after_hints: given,
        student_gave_up: input.student_gave_up === true,
      },
    });
    return { allowed: true, hints_given_for_problem: given };
  },
};
