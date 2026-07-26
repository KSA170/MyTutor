import { fetch as expoFetch } from "expo/fetch";
import type {
  ChatAttachment,
  ExtractGradeResponse,
  FinishSessionRequest,
  FinishSessionResponse,
  MaterialKind,
  SseEvent,
  TutorChatRequest,
  WeeklyRecapResponse,
} from "@mytutor/shared";
import {
  API_URL,
  ApiError,
  downloadBinary,
  getToken,
  http,
  uploadFile,
} from "./http";
import { SseParser } from "./sse";
import { DEMO, demoFinishSession, demoStreamTutorChat } from "./demo";

/** Stream one tutor-chat turn; onEvent fires for every SSE event. */
export async function streamTutorChat(
  request: TutorChatRequest,
  onEvent: (event: SseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (DEMO) return demoStreamTutorChat(onEvent);
  const token = await getToken();
  const res = await expoFetch(`${API_URL}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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
    throw new ApiError(res.status, message);
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
  if (DEMO) return { ...demoFinishSession, sessionId: request.sessionId };
  return await http.post<FinishSessionResponse>(
    `/sessions/${request.sessionId}/finish`,
    { outcome: request.outcome ?? "completed" },
  );
}

/** Generate (and vault-save) this week's study recap + recommendations. */
export async function requestWeeklyRecap(): Promise<WeeklyRecapResponse> {
  return await http.post<WeeklyRecapResponse>("/recap");
}

/** Prefill a grade form from a photo of a marked test. */
export async function extractGradeFromPhoto(
  storagePath: string,
  mimeType: string,
): Promise<ExtractGradeResponse> {
  return await http.post<ExtractGradeResponse>("/extract-grade", {
    storagePath,
    mimeType,
  });
}

/** Permanently delete the account and all data (App Store requirement). */
export async function deleteAccount(): Promise<void> {
  await http.del("/account", { confirm: "DELETE" });
}

/** Download the vault zip. Returns bytes; caller decides how to save/share. */
export async function downloadVaultZip(): Promise<ArrayBuffer> {
  return await downloadBinary("/vault.zip");
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

/** Upload a picked file; returns the storage path. */
export async function uploadToMaterials(
  file: PickedFile,
  prefix: string,
): Promise<string> {
  const uploaded = await uploadFile(file, prefix);
  return uploaded.storagePath;
}

/** Register an uploaded file as course material (ingestion starts server-side). */
export async function registerMaterial(args: {
  courseId: string;
  title: string;
  storagePath: string;
  mimeType: string;
  sizeBytes?: number;
}): Promise<string> {
  const row = await http.post<{ id: string }>("/materials", {
    courseId: args.courseId,
    title: args.title,
    storagePath: args.storagePath,
    mimeType: args.mimeType,
    sizeBytes: args.sizeBytes,
    kind: kindForMime(args.mimeType, args.title),
  });
  return row.id;
}

export type { ChatAttachment };
