import type { Tool } from "./types.ts";

const STYLE_NOTES_MAX_CHARS = 8000; // ~2K tokens

export const updateLearningStyle: Tool = {
  definition: {
    name: "update_learning_style",
    description:
      "Persist a durable observation about how this student learns best, so future sessions adapt automatically. Use sparingly — recurring patterns, not one-off events. You can patch the structured preference toggles and/or append to freeform style notes.",
    input_schema: {
      type: "object",
      properties: {
        preferences_patch: {
          type: "object",
          description:
            "Partial update to structured preferences: analogies, step_by_step, real_world_examples, visual, socratic (booleans), pace ('slow'|'moderate'|'fast').",
          properties: {
            analogies: { type: "boolean" },
            step_by_step: { type: "boolean" },
            real_world_examples: { type: "boolean" },
            visual: { type: "boolean" },
            socratic: { type: "boolean" },
            pace: { type: "string", enum: ["slow", "moderate", "fast"] },
          },
        },
        style_notes_append: {
          type: "string",
          description:
            'One or two sentences to append to the style notes, e.g. "Gets lost when more than 2 new terms are introduced per explanation."',
        },
      },
    },
  },
  label: () => "Updating learning style profile",
  handler: async (input, ctx) => {
    const { data: current } = await ctx.supabase
      .from("learning_style_profiles")
      .select("preferences, style_notes")
      .eq("user_id", ctx.userId)
      .single();
    if (!current) return { error: "Style profile not found." };

    const preferences = {
      ...current.preferences,
      ...(input.preferences_patch ?? {}),
    };

    let styleNotes = current.style_notes ?? "";
    if (input.style_notes_append) {
      styleNotes = (styleNotes.trimEnd() + "\n- " + input.style_notes_append)
        .trim();
      if (styleNotes.length > STYLE_NOTES_MAX_CHARS) {
        styleNotes = styleNotes.slice(-STYLE_NOTES_MAX_CHARS);
      }
    }

    const { error } = await ctx.supabase
      .from("learning_style_profiles")
      .update({ preferences, style_notes: styleNotes || null })
      .eq("user_id", ctx.userId);
    if (error) return { error: error.message };

    return {
      saved: true,
      note: styleNotes.length > STYLE_NOTES_MAX_CHARS * 0.9
        ? "Style notes are getting long — consider consolidating them into fewer, sharper observations next time."
        : undefined,
    };
  },
};
