/**
 * Disk-backed file storage (Render persistent disk, mounted via render.yaml).
 * Keys look like "{userId}/{...}/filename" — same convention as before.
 */
import { mkdirSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { HttpError } from "./db.js";

const ROOT = process.env.UPLOAD_DIR ?? "./data/uploads";
mkdirSync(ROOT, { recursive: true });

function resolveKey(key: string): string {
  const full = path.resolve(ROOT, key);
  if (!full.startsWith(path.resolve(ROOT) + path.sep)) {
    throw new HttpError(400, "Invalid storage key");
  }
  return full;
}

export async function saveFile(key: string, bytes: Buffer): Promise<void> {
  const full = resolveKey(key);
  mkdirSync(path.dirname(full), { recursive: true });
  await writeFile(full, bytes);
}

export async function readStoredFile(key: string): Promise<Buffer> {
  try {
    return await readFile(resolveKey(key));
  } catch {
    throw new HttpError(404, "File not found");
  }
}

export async function deleteUserFiles(userId: string): Promise<void> {
  if (!userId || userId.includes("/") || userId.includes("..")) return;
  await rm(path.resolve(ROOT, userId), { recursive: true, force: true });
}
