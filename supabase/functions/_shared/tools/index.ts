import type { Tool, ToolContext, ToolDefinition } from "./types.ts";
import { getMaterial, searchMaterials } from "./materials.ts";
import { createNote, listNotes, updateNote } from "./notes.ts";
import { giveHint, revealAnswer } from "./hints.ts";
import { recordAnswerOutcome, recordBreakSuggestion } from "./metrics.ts";
import { updateLearningStyle } from "./style.ts";
import { createStudyMaterial } from "./creations.ts";
import {
  createAssignment,
  getUpcomingAssignments,
  logGrade,
  updateAssignment,
} from "./planner.ts";

export type { Tool, ToolContext, ToolDefinition };

/**
 * Registry, sorted by tool name for a deterministic prompt prefix.
 * The tool list must be byte-stable across requests — never build it
 * conditionally per user or per mode (mode behavior is prompt-driven).
 */
const ALL_TOOLS: Tool[] = [
  createAssignment,
  createNote,
  createStudyMaterial,
  getMaterial,
  getUpcomingAssignments,
  giveHint,
  listNotes,
  logGrade,
  recordAnswerOutcome,
  recordBreakSuggestion,
  revealAnswer,
  searchMaterials,
  updateAssignment,
  updateLearningStyle,
  updateNote,
].sort((a, b) => a.definition.name.localeCompare(b.definition.name));

export const toolRegistry: Map<string, Tool> = new Map(
  ALL_TOOLS.map((t) => [t.definition.name, t]),
);

export const customToolDefinitions: ToolDefinition[] = ALL_TOOLS.map(
  (t) => t.definition,
);

export async function runTool(
  name: string,
  // deno-lint-ignore no-explicit-any
  input: any,
  ctx: ToolContext,
): Promise<{ content: string; isError: boolean }> {
  const tool = toolRegistry.get(name);
  if (!tool) {
    return { content: `Unknown tool: ${name}`, isError: true };
  }
  try {
    const result = await tool.handler(input, ctx);
    return { content: JSON.stringify(result ?? { ok: true }), isError: false };
  } catch (err) {
    console.error(`Tool ${name} failed:`, err);
    return {
      content: `Tool execution failed: ${(err as Error).message}`,
      isError: true,
    };
  }
}

export function toolLabel(name: string, input: unknown): string {
  const tool = toolRegistry.get(name);
  if (!tool) return name;
  try {
    return tool.label(input);
  } catch {
    return name;
  }
}
