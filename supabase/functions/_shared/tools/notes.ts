import type { Tool, ToolContext } from "./types.ts";
import { parseTags, parseWikilinks, validateVaultPath } from "../vault.ts";

async function saveNote(
  ctx: ToolContext,
  input: {
    path: string;
    title: string;
    content: string;
    subject?: string;
    tags?: string[];
  },
  mode: "create" | "append" | "replace",
): Promise<unknown> {
  const pathError = validateVaultPath(input.path);
  if (pathError) return { error: pathError };

  const { data: existing } = await ctx.supabase
    .from("notes")
    .select("id, content, frontmatter, tags")
    .eq("user_id", ctx.userId)
    .eq("path", input.path)
    .maybeSingle();

  let content = input.content;
  if (mode === "append" && existing) {
    content = existing.content.trimEnd() + "\n\n" + input.content;
  }

  const links = parseWikilinks(content);
  const bodyTags = parseTags(content);
  const tags = [...new Set([...(input.tags ?? []), ...bodyTags])].sort();

  const frontmatter: Record<string, unknown> = {
    ...(existing?.frontmatter ?? {}),
    tags,
    source: "mytutor",
    ...(input.subject ? { subject: input.subject } : {}),
  };
  if (!existing) {
    frontmatter.created = new Date().toISOString().slice(0, 10);
  }

  const row = {
    user_id: ctx.userId,
    course_id: ctx.courseId,
    subject: input.subject ?? null,
    path: input.path,
    title: input.title,
    frontmatter,
    content,
    tags,
    links,
    source_session_id: ctx.sessionId,
  };

  const { data: saved, error } = await ctx.supabase
    .from("notes")
    .upsert(row, { onConflict: "user_id,path" })
    .select("id, path, title")
    .single();
  if (error) return { error: error.message };

  await ctx.supabase.from("session_events").insert({
    session_id: ctx.sessionId,
    user_id: ctx.userId,
    type: "note_created",
    payload: { note_id: saved.id, path: saved.path, updated: !!existing },
  });

  ctx.emit({
    type: "note",
    noteId: saved.id,
    path: saved.path,
    title: saved.title,
  });

  return {
    saved: true,
    note_id: saved.id,
    path: saved.path,
    linked_concepts: links,
  };
}

export const createNote: Tool = {
  definition: {
    name: "create_note",
    description:
      'Create a note in the student\'s Obsidian-compatible vault (or overwrite one you just created). Path convention: "{Course}/{Subject}/{Type}/Title.md" where Type is "Lessons", "Created Materials", or "Question Summaries". Write clean markdown with [[wikilinks]] to related concepts and #tags. One concept per note. Frontmatter is added automatically.',
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            'Vault-relative path, e.g. "Science 10/Geology/Lessons/Rock Formations.md".',
        },
        title: { type: "string" },
        content: {
          type: "string",
          description: "Markdown body (no frontmatter).",
        },
        subject: {
          type: "string",
          description:
            'Subject within the course this note belongs to, e.g. "Geology".',
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Topic tags (in addition to #tags in the body).",
        },
      },
      required: ["path", "title", "content"],
    },
  },
  label: (input) => `Writing note: ${input.title ?? input.path}`,
  handler: (input, ctx) => saveNote(ctx, input, "create"),
};

export const updateNote: Tool = {
  definition: {
    name: "update_note",
    description:
      "Extend or rewrite an existing vault note. Use mode 'append' to add to the end, 'replace' to rewrite the whole body.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        title: { type: "string" },
        content: { type: "string", description: "Markdown to add or the new body." },
        mode: { type: "string", enum: ["append", "replace"] },
        subject: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["path", "title", "content", "mode"],
    },
  },
  label: (input) => `Updating note: ${input.title ?? input.path}`,
  handler: (input, ctx) =>
    saveNote(ctx, input, input.mode === "append" ? "append" : "replace"),
};

export const listNotes: Tool = {
  definition: {
    name: "list_notes",
    description:
      "List the student's existing vault notes (paths, titles, tags) so you can link to them with [[wikilinks]] instead of duplicating, or find a note to update. Optionally filter by folder prefix or search term.",
    input_schema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description: 'Path prefix filter, e.g. "Science 10/Geology".',
        },
        query: {
          type: "string",
          description: "Case-insensitive match against title and path.",
        },
      },
    },
  },
  label: () => "Checking existing notes",
  handler: async (input, ctx) => {
    let q = ctx.supabase
      .from("notes")
      .select("path, title, subject, tags")
      .eq("user_id", ctx.userId)
      .order("path", { ascending: true })
      .limit(200);
    if (input.folder) q = q.like("path", `${input.folder}%`);
    if (input.query) {
      q = q.or(`title.ilike.%${input.query}%,path.ilike.%${input.query}%`);
    }
    const { data, error } = await q;
    if (error) return { error: error.message };
    return { notes: data ?? [] };
  },
};
