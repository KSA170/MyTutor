/**
 * The tutor agent loop on OpenRouter (OpenAI wire format), streaming our
 * existing SSE protocol to the app. Feature-parity port of the original:
 * replayed history, merged mode/break system injections, server-enforced
 * hint gating via tools, sanitized persistence of truncated turns.
 */
import {
  BREAK_THRESHOLDS,
  HISTORY_MESSAGE_CAP,
  MAX_TOOL_ROUNDS,
  TUTOR_MAX_TOKENS,
  type ChatAttachment,
  type SseEvent,
  type TurnUsage,
  type TutorChatRequest,
} from "@mytutor/shared";
import { getOpenRouter, tutorModelWithSearch } from "./client.js";
import { runTool, toolDefinitions, toolLabel, type ToolContext } from "./tools.js";
import { buildCourseContext, modeInstruction, STATIC_TUTOR_PROMPT } from "../lib/prompts.js";
import { one, q } from "../db.js";
import { readStoredFile } from "../storage.js";

// deno-lint-ignore no-explicit-any
type Json = any;

export async function runTutorTurn(
  userId: string,
  session: Json,
  body: TutorChatRequest,
  emit: (event: SseEvent) => void,
): Promise<void> {
  const openrouter = getOpenRouter();

  // ---- 1. Mode switch --------------------------------------------------
  let mode: string = session.mode;
  let modeSwitched = false;
  if (body.mode && body.mode !== session.mode) {
    mode = body.mode;
    modeSwitched = true;
    await q("update sessions set mode = $1 where id = $2", [mode, session.id]);
    await q(
      "insert into session_events (session_id, user_id, type, payload) values ($1, $2, 'mode_switched', $3)",
      [session.id, userId, { from: session.mode, to: mode }],
    );
  }

  // ---- 2. Context ------------------------------------------------------
  const courseContext = await buildCourseContext(userId, session.course_id);

  // ---- 3. Replay history ----------------------------------------------
  const historyRows = await q(
    "select seq, content from (select seq, content from messages where session_id = $1 order by seq desc limit $2) h order by seq asc",
    [session.id, HISTORY_MESSAGE_CAP],
  );
  // The cap can slice mid tool-exchange: replay must start on a plain user
  // message (an orphaned tool result would 400).
  while (
    historyRows.length > 0 &&
    (historyRows[0].content?.role !== "user" ||
      historyRows[0].content?.tool_call_id)
  ) {
    historyRows.shift();
  }
  let nextSeq = historyRows.length > 0
    ? historyRows[historyRows.length - 1].seq + 1
    : (await one(
      "select coalesce(max(seq), 0)::int as m from messages where session_id = $1",
      [session.id],
    ))!.m + 1;
  const isFirstTurn = nextSeq === 1;
  const messages: Json[] = historyRows.map((r) => r.content);

  const persist = async (content: Json, displayText: string | null) => {
    const row = await one(
      "insert into messages (session_id, user_id, seq, role, content, display_text) values ($1, $2, $3, $4, $5, $6) returning id",
      [session.id, userId, nextSeq++, content.role, content, displayText],
    );
    return row!.id as string;
  };

  // ---- 4. New user turn (text + image attachments) ---------------------
  const parts: Json[] = [];
  for (const att of body.attachments ?? []) {
    const block = await attachmentPart(userId, att);
    if (block) parts.push(block);
  }
  const userMessage: Json = parts.length > 0
    ? { role: "user", content: [...parts, { type: "text", text: body.message }] }
    : { role: "user", content: body.message };
  await persist(userMessage, body.message);
  messages.push(userMessage);

  // ---- 5. Merged system injection (persisted for stable replay) --------
  const injections: string[] = [];
  if (isFirstTurn || modeSwitched) {
    injections.push(
      (modeSwitched ? "Mode switched. " : "") + modeInstruction(mode),
    );
  }
  const statusLine = await breakStatusLine(session);
  if (statusLine) injections.push(statusLine);
  if (injections.length > 0) {
    const sys: Json = { role: "system", content: injections.join("\n\n") };
    await persist(sys, statusLine ? "status" : "mode");
    messages.push(sys);
  }

  const toolCtx: ToolContext = {
    userId,
    sessionId: session.id,
    courseId: session.course_id,
    mode,
    emit,
  };

  // ---- 6. Agent loop ---------------------------------------------------
  const usage: TurnUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
  let lastAssistantId = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = await openrouter.chat.completions.create({
      model: tutorModelWithSearch(),
      max_tokens: TUTOR_MAX_TOKENS,
      stream: true,
      stream_options: { include_usage: true },
      tools: toolDefinitions,
      messages: [
        { role: "system", content: STATIC_TUTOR_PROMPT },
        { role: "system", content: courseContext },
        ...messages,
      ],
    });

    let text = "";
    let finishReason: string | null = null;
    const toolCalls: Json[] = [];
    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (chunk.usage) {
        usage.inputTokens += chunk.usage.prompt_tokens ?? 0;
        usage.outputTokens += chunk.usage.completion_tokens ?? 0;
        usage.cacheReadInputTokens +=
          (chunk.usage as Json).prompt_tokens_details?.cached_tokens ?? 0;
      }
      if (!choice) continue;
      if (choice.delta?.content) {
        text += choice.delta.content;
        emit({ type: "delta", text: choice.delta.content });
      }
      for (const tc of choice.delta?.tool_calls ?? []) {
        const slot = (toolCalls[tc.index] ??= {
          id: tc.id ?? `call_${tc.index}`,
          type: "function",
          function: { name: "", arguments: "" },
        });
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.function.name += tc.function.name;
        if (tc.function?.arguments) {
          slot.function.arguments += tc.function.arguments;
        }
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    const calls = toolCalls.filter(Boolean);
    // A length-truncated turn may carry tool calls that will never get
    // results — drop them so replay stays valid.
    const keepCalls = finishReason === "tool_calls" ? calls : [];
    const assistantMessage: Json = {
      role: "assistant",
      content: text || (keepCalls.length ? null : "[response interrupted]"),
      ...(keepCalls.length ? { tool_calls: keepCalls } : {}),
    };
    lastAssistantId = await persist(assistantMessage, text || null);
    messages.push(assistantMessage);

    if (finishReason === "tool_calls" && keepCalls.length > 0) {
      for (const call of keepCalls) {
        let input: Json = {};
        try {
          input = JSON.parse(call.function.arguments || "{}");
        } catch {
          input = {};
        }
        emit({
          type: "tool",
          name: call.function.name,
          label: toolLabel(call.function.name, input),
        });
        const result = await runTool(call.function.name, input, toolCtx);
        const toolMessage: Json = {
          role: "tool",
          tool_call_id: call.id,
          content: result,
        };
        await persist(toolMessage, null);
        messages.push(toolMessage);
      }
      continue;
    }
    break; // stop / length / anything terminal
  }

  emit({ type: "done", messageId: lastAssistantId, usage });
}

/** Image attachments become data-URL image parts; PDFs go through ingestion. */
async function attachmentPart(
  userId: string,
  att: ChatAttachment,
): Promise<Json | null> {
  if (!att.storagePath.startsWith(`${userId}/`)) return null;
  if (!att.mimeType.startsWith("image/")) return null;
  try {
    const bytes = await readStoredFile(att.storagePath);
    return {
      type: "image_url",
      image_url: {
        url: `data:${att.mimeType};base64,${bytes.toString("base64")}`,
      },
    };
  } catch {
    return null;
  }
}

async function breakStatusLine(session: Json): Promise<string | null> {
  if (!session.planned_minutes) return null;
  const elapsedMin =
    (Date.now() - new Date(session.started_at).getTime()) / 60000;
  const injected = await one(
    "select count(*)::int as n from messages where session_id = $1 and role = 'system' and display_text = 'status'",
    [session.id],
  );
  const crossed = BREAK_THRESHOLDS.filter(
    (t) => elapsedMin >= t * session.planned_minutes,
  ).length;
  if (crossed <= (injected?.n ?? 0)) return null;
  return `Session status: ${Math.round(elapsedMin)} of ${session.planned_minutes} planned minutes elapsed. If this is a natural stopping point, weave in a short break suggestion (and call record_break_suggestion).`;
}
