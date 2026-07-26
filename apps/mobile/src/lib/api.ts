import { fetch as expoFetch } from "expo/fetch";
import { Platform } from "react-native";
import type {
  ChatAttachment,
  FinishSessionRequest,
  FinishSessionResponse,
  MaterialKind,
  SseEvent,
  TutorChatRequest,
} from "@mytutor/shared";
import { MATERIALS_BUCKET } from "@mytutor/shared";
import { authHeaders, functionUrl, supabase } from "./supabase";
import { SseParser } from "./sse";

/** Stream one tutor-chat turn; onEvent fires for every SSE event. */
export async function streamTutorChat(
  request: TutorChatRequest,
  onEvent: (event: SseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const headers = await authHeaders();
  const res = await expoFetch(functionUrl("tutor-chat"), {
    method: "POST",
    headers,
    body: JSON.stringify(request),
    signal,
  });
  if (!res.ok || !res.body) {
    let message = `Chat request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // keep default message
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const event of parser.push(decoder.decode(value, { stream: true }))) {
      onEvent(event);
    }
  }
}

export async function finishSession(
  request: FinishSessionRequest,
): Promise<FinishSessionResponse> {
  const headers = await authHeaders();
  const res = await expoFetch(functionUrl("finish-session"), {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(`finish-session failed (${res.status})`);
  return (await res.json()) as FinishSessionResponse;
}

export async function triggerIngestion(materialId: string): Promise<void> {
  const headers = await authHeaders();
  await expoFetch(functionUrl("ingest-material"), {
    method: "POST",
    headers,
    body: JSON.stringify({ materialId }),
  });
}

/** Download the vault zip. Returns bytes; caller decides how to save/share. */
export async function downloadVaultZip(): Promise<ArrayBuffer> {
  const headers = await authHeaders();
  const res = await expoFetch(functionUrl("export-vault"), {
    method: "POST",
    headers,
    body: "{}",
  });
  if (!res.ok) throw new Error(`export failed (${res.status})`);
  return await res.arrayBuffer();
}

export function kindForMime(mime: string, name: string): MaterialKind {
  if (mime === "application/pdf" || name.toLowerCase().endsWith(".pdf")) {
    return "pdf";
  }
  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.toLowerCase().endsWith(".docx")
  ) {
    return "docx";
  }
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "other";
}

export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
}

/**
 * Upload a picked file to the materials bucket under the caller's uid.
 * Returns the storage path.
 */
export async function uploadToMaterials(
  file: PickedFile,
  prefix: string,
): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Not signed in");

  const safeName = file.name.replace(/[^\w.\-() ]/g, "_");
  const path = `${userId}/${prefix}/${crypto.randomUUID()}/${safeName}`;

  let body: Blob | ArrayBuffer;
  if (Platform.OS === "web") {
    body = await (await fetch(file.uri)).blob();
  } else {
    body = await (await expoFetch(file.uri)).arrayBuffer();
  }

  const { error } = await supabase.storage
    .from(MATERIALS_BUCKET)
    .upload(path, body, { contentType: file.mimeType, upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return path;
}

/** Register an uploaded file as course material and kick off ingestion. */
export async function registerMaterial(args: {
  courseId: string;
  title: string;
  storagePath: string;
  mimeType: string;
  sizeBytes?: number;
}): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Not signed in");

  const { data, error } = await supabase
    .from("materials")
    .insert({
      user_id: userId,
      course_id: args.courseId,
      title: args.title,
      kind: kindForMime(args.mimeType, args.title),
      storage_path: args.storagePath,
      mime_type: args.mimeType,
      size_bytes: args.sizeBytes ?? null,
      status: "uploaded",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await triggerIngestion(data.id);
  return data.id;
}

export type { ChatAttachment };
