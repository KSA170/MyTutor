import Anthropic from "npm:@anthropic-ai/sdk@0.65.0";

export { Anthropic };

let client: Anthropic | null = null;

/** Singleton Anthropic client. API key lives only in edge function secrets. */
export function getAnthropic(): Anthropic {
  if (!client) {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    client = new Anthropic({ apiKey });
  }
  return client;
}

export const TUTOR_MODEL = "claude-opus-5";
export const UTILITY_MODEL = "claude-haiku-4-5";
