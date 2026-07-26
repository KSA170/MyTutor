import OpenAI from "openai";

/**
 * OpenRouter speaks the OpenAI API. One client, any model — pick with env:
 *   TUTOR_MODEL   (default google/gemini-2.5-flash — strong tool use, cheap;
 *                  ~$10 of credits lasts months. Swap for e.g.
 *                  "anthropic/claude-sonnet-4.5" or "openai/gpt-4.1" any time.)
 *   UTILITY_MODEL (default google/gemini-2.5-flash-lite — summaries/vision)
 *   WEB_SEARCH=0  disables the ":online" web-search variant on tutor turns
 *                 (web results bill ~$4 per 1000 results on OpenRouter).
 */
let client: OpenAI | null = null;

export function getOpenRouter(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
    client = new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/KSA170/MyTutor",
        "X-Title": "MyTutor",
      },
    });
  }
  return client;
}

export const TUTOR_MODEL = process.env.TUTOR_MODEL ?? "google/gemini-2.5-flash";
export const UTILITY_MODEL = process.env.UTILITY_MODEL ??
  "google/gemini-2.5-flash-lite";

/** Tutor model with OpenRouter's web-search variant unless disabled. */
export function tutorModelWithSearch(): string {
  if (process.env.WEB_SEARCH === "0") return TUTOR_MODEL;
  return TUTOR_MODEL.endsWith(":online") ? TUTOR_MODEL : `${TUTOR_MODEL}:online`;
}

// deno-lint-ignore no-explicit-any
type Json = any;

/**
 * One-shot structured completion (summaries, extraction). Uses
 * response_format json_schema where the provider supports it, and always
 * guards the parse — callers get null on failure and degrade gracefully.
 */
export async function completeJson<T>(args: {
  prompt: string;
  schema: Json;
  schemaName: string;
  imageDataUrl?: string;
  maxTokens?: number;
}): Promise<T | null> {
  const openrouter = getOpenRouter();
  const content: Json = args.imageDataUrl
    ? [
      { type: "image_url", image_url: { url: args.imageDataUrl } },
      { type: "text", text: args.prompt },
    ]
    : args.prompt;
  try {
    const response = await openrouter.chat.completions.create({
      model: UTILITY_MODEL,
      max_tokens: args.maxTokens ?? 1200,
      messages: [{ role: "user", content }],
      response_format: {
        type: "json_schema",
        json_schema: { name: args.schemaName, strict: true, schema: args.schema },
      },
    });
    const text = response.choices[0]?.message?.content ?? "";
    return JSON.parse(text) as T;
  } catch (err) {
    console.error(`completeJson(${args.schemaName}) failed:`, err);
    return null;
  }
}

/** One-shot plain-text completion on the utility model. */
export async function completeText(args: {
  prompt: string;
  imageDataUrl?: string;
  maxTokens?: number;
}): Promise<string> {
  const openrouter = getOpenRouter();
  const content: Json = args.imageDataUrl
    ? [
      { type: "image_url", image_url: { url: args.imageDataUrl } },
      { type: "text", text: args.prompt },
    ]
    : args.prompt;
  const response = await openrouter.chat.completions.create({
    model: UTILITY_MODEL,
    max_tokens: args.maxTokens ?? 2000,
    messages: [{ role: "user", content }],
  });
  return response.choices[0]?.message?.content ?? "";
}
