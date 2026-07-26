import type { Tool } from "./types.ts";
import { VAULT_TYPE_FOLDERS } from "../../../../packages/shared/src/protocol.ts";
import { validateVaultPath } from "../vault.ts";

export const createStudyMaterial: Tool = {
  definition: {
    name: "create_study_material",
    description:
      "Save a study artifact the student can use in the app: flashcards, a practice test, a study guide, or a summary. Content is structured so the app can render it interactively (flip cards, take the test). A markdown copy is also saved into the vault under {Course}/{Subject}/Created Materials/. Draw questions from the student's actual course materials.",
    input_schema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["practice_test", "flashcards", "study_guide", "summary", "other"],
        },
        title: { type: "string" },
        description: {
          type: "string",
          description: "One sentence on what this covers.",
        },
        subject: {
          type: "string",
          description: 'Subject within the course, e.g. "Geology".',
        },
        flashcards: {
          type: "array",
          description: "Required when kind=flashcards.",
          items: {
            type: "object",
            properties: {
              front: { type: "string" },
              back: { type: "string" },
            },
            required: ["front", "back"],
          },
        },
        questions: {
          type: "array",
          description: "Required when kind=practice_test.",
          items: {
            type: "object",
            properties: {
              prompt: { type: "string" },
              choices: {
                type: "array",
                items: { type: "string" },
                description: "For multiple choice; omit for free response.",
              },
              answer: { type: "string" },
              explanation: { type: "string" },
            },
            required: ["prompt", "answer"],
          },
        },
        markdown: {
          type: "string",
          description:
            "Required when kind is study_guide, summary, or other: the full markdown body.",
        },
      },
      required: ["kind", "title", "subject"],
    },
  },
  label: (input) => `Creating ${String(input.kind ?? "material").replace("_", " ")}: ${input.title}`,
  handler: async (input, ctx) => {
    if (!ctx.courseId) {
      return { error: "No course is attached to this session." };
    }

    let content: Record<string, unknown>;
    let markdown: string;
    switch (input.kind) {
      case "flashcards": {
        const cards = input.flashcards ?? [];
        if (cards.length === 0) return { error: "flashcards array is required and must not be empty." };
        content = { kind: "flashcards", cards };
        markdown = cards
          .map(
            (c: { front: string; back: string }, i: number) =>
              `## Card ${i + 1}\n**Q:** ${c.front}\n\n**A:** ${c.back}`,
          )
          .join("\n\n");
        break;
      }
      case "practice_test": {
        const questions = input.questions ?? [];
        if (questions.length === 0) return { error: "questions array is required and must not be empty." };
        content = { kind: "practice_test", questions };
        markdown = questions
          .map(
            (
              q: {
                prompt: string;
                choices?: string[];
                answer: string;
                explanation?: string;
              },
              i: number,
            ) =>
              `## Question ${i + 1}\n${q.prompt}\n` +
              (q.choices?.length
                ? q.choices.map((c, j) => `- ${String.fromCharCode(65 + j)}. ${c}`).join("\n") + "\n"
                : "") +
              `\n**Answer:** ${q.answer}` +
              (q.explanation ? `\n\n*${q.explanation}*` : ""),
          )
          .join("\n\n");
        break;
      }
      default: {
        if (!input.markdown) return { error: "markdown is required for this kind." };
        content = { kind: input.kind, markdown: input.markdown };
        markdown = input.markdown;
      }
    }

    const { data: course } = await ctx.supabase
      .from("courses")
      .select("name")
      .eq("id", ctx.courseId)
      .single();
    const courseName = course?.name ?? "Course";
    const safeTitle = input.title.replace(/[/\\:*?"<>|]/g, "-").trim();
    const notePath =
      `${courseName}/${input.subject}/${VAULT_TYPE_FOLDERS.created}/${safeTitle}.md`;
    const pathOk = validateVaultPath(notePath) === null;

    const { data: saved, error } = await ctx.supabase
      .from("creations")
      .insert({
        user_id: ctx.userId,
        course_id: ctx.courseId,
        session_id: ctx.sessionId,
        subject: input.subject,
        kind: input.kind,
        title: input.title,
        description: input.description ?? null,
        content,
        note_path: pathOk ? notePath : null,
      })
      .select("id, kind, title")
      .single();
    if (error) return { error: error.message };

    if (pathOk) {
      await ctx.supabase.from("notes").upsert(
        {
          user_id: ctx.userId,
          course_id: ctx.courseId,
          subject: input.subject,
          path: notePath,
          title: input.title,
          frontmatter: {
            source: "mytutor",
            type: input.kind,
            tags: [input.subject.toLowerCase().replace(/\s+/g, "-")],
            created: new Date().toISOString().slice(0, 10),
          },
          content: markdown,
          tags: [input.subject.toLowerCase().replace(/\s+/g, "-")],
          links: [],
          source_session_id: ctx.sessionId,
        },
        { onConflict: "user_id,path" },
      );
    }

    await ctx.supabase.from("session_events").insert({
      session_id: ctx.sessionId,
      user_id: ctx.userId,
      type: "creation_saved",
      payload: { creation_id: saved.id, kind: saved.kind, title: saved.title },
    });

    ctx.emit({
      type: "creation",
      creationId: saved.id,
      kind: saved.kind,
      title: saved.title,
    });

    return {
      saved: true,
      creation_id: saved.id,
      vault_path: pathOk ? notePath : null,
    };
  },
};
