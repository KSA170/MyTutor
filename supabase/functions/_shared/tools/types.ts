import type { SupabaseClient } from "../db.ts";
import type { SseEvent } from "../../../../packages/shared/src/protocol.ts";

export interface ToolContext {
  supabase: SupabaseClient;
  userId: string;
  sessionId: string;
  courseId: string | null;
  mode: string;
  /** Relay an SSE event to the client mid-turn (note cards, hint counters…). */
  emit: (event: SseEvent) => void;
}

export interface ToolDefinition {
  name: string;
  description: string;
  // deno-lint-ignore no-explicit-any
  input_schema: Record<string, any>;
}

export interface Tool {
  definition: ToolDefinition;
  /** Returns the tool_result content (JSON-serializable). Throwing marks is_error. */
  // deno-lint-ignore no-explicit-any
  handler: (input: any, ctx: ToolContext) => Promise<unknown>;
  /** Short human label for the client's tool-activity chip. */
  // deno-lint-ignore no-explicit-any
  label: (input: any) => string;
}
