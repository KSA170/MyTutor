/**
 * export-vault — download the user's second brain as an Obsidian vault.
 *
 * POST {} → application/zip. Each note row becomes a real .md file at its
 * vault path with YAML frontmatter, ready to drop into (or open as) an
 * Obsidian vault.
 */

import {
  corsHeaders,
  errorResponse,
  requireUser,
  userClient,
} from "../_shared/db.ts";
import { renderNoteFile } from "../_shared/vault.ts";
import { zipSync, strToU8 } from "npm:fflate@0.8.2";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const supabase = userClient(req);
    await requireUser(supabase);

    const { data: notes, error } = await supabase
      .from("notes")
      .select("path, title, frontmatter, content")
      .order("path", { ascending: true });
    if (error) throw new Error(error.message);

    const files: Record<string, Uint8Array> = {};
    for (const note of notes ?? []) {
      files[note.path] = strToU8(
        renderNoteFile({
          title: note.title,
          frontmatter: note.frontmatter ?? {},
          content: note.content ?? "",
        }),
      );
    }
    if (Object.keys(files).length === 0) {
      files["README.md"] = strToU8(
        "# MyTutor Vault\n\nNo notes yet — start a tutoring session and your second brain will grow here.\n",
      );
    }

    const zipped = zipSync(files, { level: 6 });
    return new Response(new Uint8Array(zipped), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="mytutor-vault.zip"',
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
});
