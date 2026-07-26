import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import { requireAuth } from "../auth.js";
import { HttpError, one, q } from "../db.js";
import { deleteUserFiles, readStoredFile, saveFile } from "../storage.js";
import { renderNoteFile } from "../lib/vault.js";
import { ingestMaterial } from "../services/ingest.js";
import { completeJson } from "../ai/client.js";

type Env = { Variables: { userId: string } };

// deno-lint-ignore no-explicit-any
type Json = any;

export const resourceRoutes = new Hono<Env>();
resourceRoutes.use("*", requireAuth);

// ---- files (generic upload used by materials / chat / grade scans) -------

resourceRoutes.post("/files", async (c) => {
  const userId = c.get("userId");
  const form = await c.req.parseBody();
  const file = form.file;
  const prefix = typeof form.prefix === "string" ? form.prefix : "misc";
  if (!(file instanceof File)) throw new HttpError(400, "file is required");
  if (prefix.includes("..")) throw new HttpError(400, "bad prefix");
  const safeName = file.name.replace(/[^\w.\-() ]/g, "_") || "upload";
  const key = `${userId}/${prefix}/${randomUUID()}/${safeName}`;
  await saveFile(key, Buffer.from(await file.arrayBuffer()));
  return c.json({
    storagePath: key,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    name: file.name,
  });
});

// ---- profile + learning style --------------------------------------------

resourceRoutes.get("/profile", async (c) => {
  const profile = await one("select * from profiles where id = $1", [
    c.get("userId"),
  ]);
  return c.json(profile);
});

resourceRoutes.patch("/profile", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const allowed = [
    "display_name",
    "handle",
    "grade_level",
    "program",
    "timezone",
    "onboarding_completed",
  ];
  const sets: string[] = [];
  const params: unknown[] = [userId];
  for (const key of allowed) {
    if (body[key] !== undefined) {
      params.push(key === "handle" && body[key] ? String(body[key]).toLowerCase() : body[key]);
      sets.push(`${key} = $${params.length}`);
    }
  }
  if (!sets.length) throw new HttpError(400, "Nothing to update");
  try {
    const row = await one(
      `update profiles set ${sets.join(", ")} where id = $1 returning *`,
      params,
    );
    return c.json(row);
  } catch (err: Json) {
    if (err?.code === "23505") throw new HttpError(409, "That handle is taken");
    if (err?.code === "23514") {
      throw new HttpError(400, "Handles are 3-20 lowercase letters, numbers, or _");
    }
    throw err;
  }
});

resourceRoutes.get("/style", async (c) => {
  const row = await one(
    "select * from learning_style_profiles where user_id = $1",
    [c.get("userId")],
  );
  return c.json(row);
});

resourceRoutes.patch("/style", async (c) => {
  const body = await c.req.json();
  const row = await one(
    "update learning_style_profiles set preferences = coalesce($1, preferences) where user_id = $2 returning *",
    [body.preferences ?? null, c.get("userId")],
  );
  return c.json(row);
});

// ---- courses --------------------------------------------------------------

resourceRoutes.get("/courses", async (c) => {
  return c.json(
    await q("select * from courses where user_id = $1 order by name", [
      c.get("userId"),
    ]),
  );
});

resourceRoutes.post("/courses", async (c) => {
  const body = await c.req.json();
  if (!body.name?.trim()) throw new HttpError(400, "Course name is required");
  const row = await one(
    `insert into courses (user_id, name, subject, grade_level, instructor, term, curriculum)
     values ($1, $2, $3, $4, $5, $6, $7) returning *`,
    [
      c.get("userId"),
      body.name.trim(),
      body.subject ?? null,
      body.grade_level ?? null,
      body.instructor ?? null,
      body.term ?? null,
      body.curriculum ?? null,
    ],
  );
  return c.json(row);
});

// ---- materials ------------------------------------------------------------

resourceRoutes.get("/courses/:courseId/materials", async (c) => {
  return c.json(
    await q(
      "select * from materials where user_id = $1 and course_id = $2 order by created_at desc",
      [c.get("userId"), c.req.param("courseId")],
    ),
  );
});

resourceRoutes.post("/materials", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  if (!body.courseId || !body.storagePath || !body.title) {
    throw new HttpError(400, "courseId, storagePath, title are required");
  }
  if (!String(body.storagePath).startsWith(`${userId}/`)) {
    throw new HttpError(403, "Not your file");
  }
  const row = await one(
    `insert into materials (user_id, course_id, title, kind, storage_path, mime_type, size_bytes)
     values ($1, $2, $3, $4, $5, $6, $7) returning *`,
    [
      userId,
      body.courseId,
      body.title,
      body.kind ?? "other",
      body.storagePath,
      body.mimeType ?? null,
      body.sizeBytes ?? null,
    ],
  );
  void ingestMaterial(row!.id); // fire-and-forget; app polls status
  return c.json(row);
});

// ---- sessions + messages --------------------------------------------------

resourceRoutes.get("/sessions", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 10), 50);
  return c.json(
    await q(
      "select * from sessions where user_id = $1 order by started_at desc limit $2",
      [c.get("userId"), limit],
    ),
  );
});

resourceRoutes.post("/sessions", async (c) => {
  const body = await c.req.json();
  const row = await one(
    `insert into sessions (user_id, course_id, subject, mode, planned_minutes)
     values ($1, $2, $3, $4, $5) returning *`,
    [
      c.get("userId"),
      body.courseId ?? null,
      body.subject ?? null,
      body.mode ?? "teaching",
      body.plannedMinutes ?? null,
    ],
  );
  return c.json(row);
});

resourceRoutes.get("/sessions/:id", async (c) => {
  const row = await one(
    "select * from sessions where id = $1 and user_id = $2",
    [c.req.param("id"), c.get("userId")],
  );
  if (!row) throw new HttpError(404, "Session not found");
  return c.json(row);
});

resourceRoutes.get("/sessions/:id/messages", async (c) => {
  const rows = await q(
    "select id, role, display_text from messages where session_id = $1 and user_id = $2 and display_text is not null and role in ('user','assistant') order by seq asc",
    [c.req.param("id"), c.get("userId")],
  );
  return c.json(rows);
});

// ---- notes + vault export -------------------------------------------------

resourceRoutes.get("/notes", async (c) => {
  return c.json(
    await q("select * from notes where user_id = $1 order by path", [
      c.get("userId"),
    ]),
  );
});

resourceRoutes.get("/vault.zip", async (c) => {
  const notes = await q(
    "select path, title, frontmatter, content from notes where user_id = $1 order by path",
    [c.get("userId")],
  );
  const files: Record<string, Uint8Array> = {};
  for (const note of notes) {
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
  return c.body(new Uint8Array(zipped).buffer as ArrayBuffer, 200, {
    "Content-Type": "application/zip",
    "Content-Disposition": 'attachment; filename="mytutor-vault.zip"',
  });
});

// ---- assignments ----------------------------------------------------------

resourceRoutes.get("/assignments", async (c) => {
  return c.json(
    await q(
      "select * from assignments where user_id = $1 order by due_at asc nulls last",
      [c.get("userId")],
    ),
  );
});

resourceRoutes.post("/assignments", async (c) => {
  const body = await c.req.json();
  if (!body.courseId || !body.title) {
    throw new HttpError(400, "courseId and title are required");
  }
  const row = await one(
    `insert into assignments (user_id, course_id, title, description, due_at, estimated_minutes, complexity)
     values ($1, $2, $3, $4, $5, $6, $7) returning *`,
    [
      c.get("userId"),
      body.courseId,
      body.title,
      body.description ?? null,
      body.dueAt ?? null,
      body.estimatedMinutes ?? null,
      body.complexity ?? null,
    ],
  );
  return c.json(row);
});

resourceRoutes.patch("/assignments/:id", async (c) => {
  const body = await c.req.json();
  const map: Record<string, string> = {
    title: "title",
    description: "description",
    dueAt: "due_at",
    estimatedMinutes: "estimated_minutes",
    complexity: "complexity",
    status: "status",
  };
  const sets: string[] = [];
  const params: unknown[] = [c.req.param("id"), c.get("userId")];
  for (const [key, col] of Object.entries(map)) {
    if (body[key] !== undefined) {
      params.push(body[key]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (body.status === "done") sets.push("completed_at = now()");
  else if (body.status) sets.push("completed_at = null");
  if (!sets.length) throw new HttpError(400, "Nothing to update");
  const row = await one(
    `update assignments set ${sets.join(", ")} where id = $1 and user_id = $2 returning *`,
    params,
  );
  if (!row) throw new HttpError(404, "Assignment not found");
  return c.json(row);
});

resourceRoutes.delete("/assignments/:id", async (c) => {
  await q("delete from assignments where id = $1 and user_id = $2", [
    c.req.param("id"),
    c.get("userId"),
  ]);
  return c.json({ deleted: true });
});

// ---- grades ---------------------------------------------------------------

resourceRoutes.get("/grades", async (c) => {
  return c.json(
    await q(
      "select * from grades where user_id = $1 order by graded_at desc",
      [c.get("userId")],
    ),
  );
});

resourceRoutes.post("/grades", async (c) => {
  const body = await c.req.json();
  if (!body.courseId || !body.title || body.score == null || !body.maxScore) {
    throw new HttpError(400, "courseId, title, score, maxScore are required");
  }
  const row = await one(
    `insert into grades (user_id, course_id, assignment_id, title, score, max_score, weight, feedback, topics, graded_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::date, current_date)) returning *`,
    [
      c.get("userId"),
      body.courseId,
      body.assignmentId ?? null,
      body.title,
      body.score,
      body.maxScore,
      body.weight ?? null,
      body.feedback ?? null,
      body.topics ?? [],
      body.gradedAt ?? null,
    ],
  );
  return c.json(row);
});

resourceRoutes.post("/extract-grade", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  if (!body.storagePath || !String(body.mimeType).startsWith("image/")) {
    throw new HttpError(400, "storagePath and an image mimeType are required");
  }
  if (!String(body.storagePath).startsWith(`${userId}/`)) {
    throw new HttpError(403, "Not your file");
  }
  const bytes = await readStoredFile(body.storagePath);
  const parsed = await completeJson<Json>({
    schemaName: "grade_extraction",
    imageDataUrl: `data:${body.mimeType};base64,${bytes.toString("base64")}`,
    prompt:
      "This is a photo of a graded test or assignment. Extract the mark (score and max score), the assessment title, any teacher feedback, and the topics covered (especially where marks were lost).",
    schema: {
      type: "object",
      properties: {
        title: { anyOf: [{ type: "string" }, { type: "null" }] },
        score: { anyOf: [{ type: "number" }, { type: "null" }] },
        max_score: { anyOf: [{ type: "number" }, { type: "null" }] },
        feedback: { anyOf: [{ type: "string" }, { type: "null" }] },
        topics: { type: "array", items: { type: "string" } },
      },
      required: ["title", "score", "max_score", "feedback", "topics"],
      additionalProperties: false,
    },
  });
  if (!parsed) {
    throw new HttpError(502, "Could not read the photo — enter the grade manually");
  }
  return c.json(parsed);
});

// ---- account deletion -----------------------------------------------------

resourceRoutes.delete("/account", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => ({}));
  if (body.confirm !== "DELETE") {
    throw new HttpError(400, 'Pass { "confirm": "DELETE" } to delete the account');
  }
  await deleteUserFiles(userId);
  await q("delete from users where id = $1", [userId]); // cascades everything
  return c.json({ deleted: true });
});
