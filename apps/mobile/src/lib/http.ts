/**
 * REST client for the MyTutor API (apps/api). All app data flows through
 * here — demo mode intercepts at this single layer.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetch as expoFetch } from "expo/fetch";
import { DEMO, demoRequest } from "./demo";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000")
  .replace(/\/$/, "");

if (!DEMO && !process.env.EXPO_PUBLIC_API_URL) {
  console.warn(
    "EXPO_PUBLIC_API_URL not set — defaulting to http://localhost:3000",
  );
}

const TOKEN_KEY = "mytutor.token";
let cachedToken: string | null | undefined;

export async function getToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  cachedToken = await AsyncStorage.getItem(TOKEN_KEY);
  return cachedToken;
}

export async function setToken(token: string | null): Promise<void> {
  cachedToken = token;
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  if (DEMO) return demoRequest(method, path, body) as T;
  const token = await getToken();
  const res = await expoFetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // keep default
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export const http = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
};

export interface UploadedFile {
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  name: string;
}

/** Multipart upload to POST /files. */
export async function uploadFile(
  file: { uri: string; name: string; mimeType: string },
  prefix: string,
): Promise<UploadedFile> {
  if (DEMO) {
    return {
      storagePath: `demo/${prefix}/${file.name}`,
      mimeType: file.mimeType,
      sizeBytes: 0,
      name: file.name,
    };
  }
  const token = await getToken();
  const blob = await (await fetch(file.uri)).blob();
  const form = new FormData();
  form.append("file", new File([blob], file.name, { type: file.mimeType }));
  form.append("prefix", prefix);
  const res = await expoFetch(`${API_URL}/files`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) throw new ApiError(res.status, `Upload failed (${res.status})`);
  return (await res.json()) as UploadedFile;
}

/** Binary download (vault zip). */
export async function downloadBinary(path: string): Promise<ArrayBuffer> {
  if (DEMO) return new TextEncoder().encode("demo vault").buffer as ArrayBuffer;
  const token = await getToken();
  const res = await expoFetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, `Download failed (${res.status})`);
  return await res.arrayBuffer();
}
