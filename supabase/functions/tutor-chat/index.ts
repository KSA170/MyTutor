/**
 * tutor-chat — the MyTutor agent loop.
 *
 * POST { sessionId, message, attachments?, mode? }  →  SSE stream of SseEvent.
 *
 * Design notes (see docs/PLAN.md):
 * - Prompt caching: breakpoint 1 = static tutor prompt, breakpoint 2 =
 *   deterministic course context, breakpoint 3 = last block of the newest
 *   message. History is replayed byte-identically from messages.content.
 * - Modes are enforced by prompt + server-side tool gating (give_hint /
 *   reveal_answer count in session_events).
 * - Mode switches and break-status lines are system-role messages inside
 *   `messages` (supported on claude-opus-5), persisted so replay is stable.
 */

import { getAnthropic, TUTOR_MODEL } from "../_shared/anthropic.ts";
import {
  corsHeaders,
  errorResponse,
  HttpError,
  requireUser,
  serviceClient,
  userClient,
} from "../_shared/db.ts";
import { SseChannel } from "../_shared/sse.ts";
import {
  buildCourseContext,
  modeInstruction,
  STATIC_TUTOR_PROMPT,
} from "../_shared/prompts.ts";
import {
  customToolDefinitions,
  runTool,
  toolLabel,
  type ToolContext,
} from "../_shared/tools/index.ts";
import {
  BREAK_THRESHOLDS,
  HISTORY_MESSAGE_CAP,
  MATERIALS_BUCKET,
  MAX_TOOL_ROUNDS,
  TUTOR_MAX_TOKENS,
  WEB_SEARCH_MAX_USES,
  type ChatAttachment,
  type TurnUsage,
  type TutorChatRequest,
} from "../../../packages/shared/src/protocol.ts";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

// deno-lint-ignore no-explicit-any
type Json = any;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const supabase = userClient(req);
    const user = await requireUser(supabase);
    const body = (await req.json()) as TutorChatRequest;
    if (!body.sessionId || !body.message?.trim()) {
      throw new HttpError(400, "sessionId and message are required");
    }

    const { data: session } = await supabase
      .from("sessions")
      .select("*")
      .eq("id", body.sessionId)
      .single();
    if (!session) throw new HttpError(404, "Session not found");
    if (session.status !== "active") {
      throw new HttpError(409, "Session is not active");
    }

    const channel = new SseChannel(corsHeaders);
    EdgeRuntime.waitUntil(
      runTurn(supabase, user.id, session, body, channel).catch((err) => {
        console.error("tutor-chat turn failed:", err);
        channel.emit({ type: "error", message: "Something went wrong. Please try again." });
        channel.close();
      }),
    );
    return channel.response;
  } catch (err) {
    return errorResponse(err);
  }
});

async function runTurn(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  // deno-lint-ignore no-explicit-any
  session: any,
  body: TutorChatRequest,
  channel: SseChannel,
): Promise<void> {
  const anthropic = getAnthropic();

  // ---- 1. Mode switch (before building anything) ------------------------
  let mode: string = session.mode;
  let modeSwitched = false;
  if (body.mode && body.mode !== session.mode) {
    mode = body.mode;
    modeSwitched = true;
    await supabase
      .from("sessions")
      .update({ mode })
      .eq("id", session.id);
    await supabase.from("session_events").insert({
      session_id: session.id,
      user_id: userId,
      type: "mode_switched",
      payload: { from: session.mode, to: mode },
    });
  }

  // ---- 2. Cached context blocks ----------------------------------------
  const courseContext = await buildCourseContext(
    supabase,
    userId,
    session.course_id,
  );

  // ---- 3. Replay history -----------------------------------------------
  const { data: historyRows } = await supabase
    .from("messages")
    .select("seq, role, content")
    .eq("session_id", session.id)
    .order("seq", { ascending: false })
    .limit(HISTORY_MESSAGE_CAP);
  const history = (historyRows ?? []).reverse();
  let nextSeq = history.length > 0
    ? history[history.length - 1].seq + 1
    : 1;
  const isFirstTurn = history.length === 0;

  // The cap can slice mid tool-exchange: the replay must start with a plain
  // user message (not a tool_result pair whose tool_use was truncated away,
  // not an assistant/system row — messages[0] must be role "user").
  while (history.length > 0) {
    const first = history[0];
    const isPlainUser = first.role === "user" &&
      (!Array.isArray(first.content) ||
        !first.content.some((b: Json) => b?.type === "tool_result"));
    if (isPlainUser) break;
    history.shift();
  }

  const messages: Json[] = history.map((row: Json) => ({
    role: row.role,
    content: row.content,
  }));

  const persist = async (
    role: string,
    content: Json,
    displayText: string | null,
  ): Promise<string> => {
    const { data, error } = await supabase
      .from("messages")
      .insert({
        session_id: session.id,
        user_id: userId,
        seq: nextSeq++,
        role,
        content,
        display_text: displayText,
      })
      .select("id")
      .single();
    if (error) throw new Error(`persist failed: ${error.message}`);
    return data.id as string;
  };

  // ---- 4. New user turn (text + attachments) ---------------------------
  const userBlocks: Json[] = [];
  for (const att of body.attachments ?? []) {
    const block = await attachmentBlock(supabase, userId, att);
    if (block) userBlocks.push(block);
    if (att.addToCourse && session.course_id) {
      EdgeRuntime.waitUntil(
        enqueueIngestion(supabase, userId, session.course_id, att),
      );
    }
  }
  userBlocks.push({ type: "text", text: body.message });
  await persist("user", userBlocks, body.message);
  messages.push({ role: "user", content: userBlocks });

  // ---- 5. System-role injections (persisted for replay stability) ------
  // Merged into ONE system message per turn: consecutive system-role
  // messages are not valid (each must be last or followed by an assistant
  // turn).
  const injections: string[] = [];
  if (isFirstTurn || modeSwitched) {
    injections.push(
      (modeSwitched ? "Mode switched. " : "") + modeInstruction(mode),
    );
  }
  const statusLine = await breakStatusLine(supabase, session);
  if (statusLine) injections.push(statusLine);
  if (injections.length > 0) {
    const text = injections.join("\n\n");
    await persist("system", text, statusLine ? "status" : "mode");
    messages.push({ role: "system", content: text });
  }

  // ---- 6. Tools (deterministic order: server tool first, then customs) --
  const tools: Json[] = [
    {
      type: "web_search_20260209",
      name: "web_search",
      max_uses: WEB_SEARCH_MAX_USES,
    },
    ...customToolDefinitions,
  ];

  // MCP connectors (Phase 2/3 UI; plumbing live now). Tokens only via
  // service role — the app never sees them.
  const { data: connectors } = await serviceClient()
    .from("user_connectors")
    .select("service, server_url, authorization_token")
    .eq("user_id", userId)
    .eq("status", "connected")
    .order("service", { ascending: true });
  const mcpServers: Json[] = (connectors ?? []).map((c: Json) => ({
    type: "url",
    url: c.server_url,
    name: c.service,
    ...(c.authorization_token
      ? { authorization_token: c.authorization_token }
      : {}),
  }));
  for (const c of connectors ?? []) {
    tools.push({ type: "mcp_toolset", mcp_server_name: c.service });
  }

  const system = [
    {
      type: "text",
      text: STATIC_TUTOR_PROMPT,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: courseContext,
      cache_control: { type: "ephemeral" },
    },
  ];

  const toolCtx: ToolContext = {
    supabase,
    userId,
    sessionId: session.id,
    courseId: session.course_id,
    mode,
    emit: (e) => channel.emit(e),
  };

  // ---- 7. Agent loop ----------------------------------------------------
  const usage: TurnUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
  let lastAssistantId = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const requestParams: Json = {
      model: TUTOR_MODEL,
      max_tokens: TUTOR_MAX_TOKENS,
      output_config: { effort: "high" },
      system,
      tools,
      messages: withCacheMarker(messages),
    };
    if (mcpServers.length > 0) {
      requestParams.mcp_servers = mcpServers;
      requestParams.betas = ["mcp-client-2025-11-20"];
    }

    const stream = mcpServers.length > 0
      ? anthropic.beta.messages.stream(requestParams)
      : anthropic.messages.stream(requestParams);

    const blockTypes = new Map<number, string>();
    for await (const event of stream) {
      switch (event.type) {
        case "content_block_start": {
          blockTypes.set(event.index, event.content_block.type);
          if (event.content_block.type === "thinking") {
            channel.emit({ type: "thinking", active: true });
          } else if (event.content_block.type === "server_tool_use") {
            channel.emit({
              type: "tool",
              name: event.content_block.name,
              label: "Searching the web",
            });
          }
          break;
        }
        case "content_block_delta": {
          if (event.delta.type === "text_delta") {
            channel.emit({ type: "delta", text: event.delta.text });
          }
          break;
        }
        case "content_block_stop": {
          if (blockTypes.get(event.index) === "thinking") {
            channel.emit({ type: "thinking", active: false });
          }
          break;
        }
      }
    }

    const final = await stream.finalMessage();
    usage.inputTokens += final.usage.input_tokens ?? 0;
    usage.outputTokens += final.usage.output_tokens ?? 0;
    usage.cacheReadInputTokens += final.usage.cache_read_input_tokens ?? 0;
    usage.cacheCreationInputTokens += final.usage.cache_creation_input_tokens ??
      0;
    if ((final.usage.cache_read_input_tokens ?? 0) === 0 && !isFirstTurn) {
      console.warn(
        `cache-miss on turn>=2 session=${session.id} round=${round} — check prompt determinism`,
      );
    }

    const persistedContent = sanitizeAssistantContent(
      final.content,
      final.stop_reason,
    );
    const displayText = persistedContent
      .filter((b: Json) => b.type === "text")
      .map((b: Json) => b.text)
      .join("");
    lastAssistantId = await persist("assistant", persistedContent, displayText);
    messages.push({ role: "assistant", content: persistedContent });

    if (final.stop_reason === "refusal") {
      channel.emit({
        type: "error",
        message:
          "I can't help with that request. Let's get back to your coursework.",
      });
      break;
    }

    if (final.stop_reason === "pause_turn") {
      continue; // re-send with the assistant turn appended; server resumes
    }

    if (final.stop_reason === "tool_use") {
      const toolUses = final.content.filter((b: Json) => b.type === "tool_use");
      const results: Json[] = [];
      for (const tu of toolUses) {
        channel.emit({
          type: "tool",
          name: tu.name,
          label: toolLabel(tu.name, tu.input),
        });
        const { content, isError } = await runTool(tu.name, tu.input, toolCtx);
        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content,
          ...(isError ? { is_error: true } : {}),
        });
      }
      await persist("user", results, null);
      messages.push({ role: "user", content: results });
      continue;
    }

    // end_turn / max_tokens — done
    break;
  }

  channel.emit({ type: "done", messageId: lastAssistantId, usage });
  channel.close();
}

/**
 * Make a final assistant message safe to persist + replay.
 * - max_tokens can truncate mid tool call: a dangling tool_use with no
 *   tool_result in the next message 400s every later turn — drop from the
 *   first unpaired call onward.
 * - refusal (and the above) can leave empty content, which is also invalid
 *   in replay — substitute a placeholder text block.
 */
function sanitizeAssistantContent(content: Json[], stopReason: string): Json[] {
  let blocks = content;
  if (stopReason === "max_tokens") {
    blocks = [];
    for (let i = 0; i < content.length; i++) {
      const b = content[i];
      if (b.type === "tool_use") break; // results will never be supplied
      if (b.type === "server_tool_use") {
        const next = content[i + 1];
        if (!next || !String(next.type ?? "").endsWith("_result")) break;
      }
      blocks.push(b);
    }
  }
  if (blocks.length === 0) {
    return [{ type: "text", text: "[response interrupted]" }];
  }
  return blocks;
}

/** Add the 3rd cache breakpoint to a deep copy of the newest block. */
function withCacheMarker(messages: Json[]): Json[] {
  const out = messages.slice();
  for (let i = out.length - 1; i >= 0; i--) {
    if (Array.isArray(out[i].content) && out[i].content.length > 0) {
      const content = out[i].content.map((b: Json, j: number) =>
        j === out[i].content.length - 1
          ? { ...b, cache_control: { type: "ephemeral" } }
          : b
      );
      out[i] = { ...out[i], content };
      break;
    }
  }
  return out;
}

/** Download a chat attachment from storage → Anthropic content block. */
async function attachmentBlock(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  att: ChatAttachment,
): Promise<Json | null> {
  if (!att.storagePath.startsWith(`${userId}/`)) return null;
  const { data, error } = await supabase.storage
    .from(MATERIALS_BUCKET)
    .download(att.storagePath);
  if (error || !data) {
    console.error("attachment download failed:", error);
    return null;
  }
  const base64 = encodeBase64(await data.arrayBuffer());
  if (att.mimeType === "application/pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: base64 },
    };
  }
  if (att.mimeType.startsWith("image/")) {
    return {
      type: "image",
      source: { type: "base64", media_type: att.mimeType, data: base64 },
    };
  }
  return null;
}

/** Register an in-chat attachment as course material and kick off ingestion. */
async function enqueueIngestion(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  courseId: string,
  att: ChatAttachment,
): Promise<void> {
  const kind = att.mimeType === "application/pdf"
    ? "pdf"
    : att.mimeType.startsWith("image/")
    ? "image"
    : "other";
  const title = att.storagePath.split("/").pop() ?? "Chat attachment";
  const { data: material, error } = await supabase
    .from("materials")
    .insert({
      user_id: userId,
      course_id: courseId,
      title,
      kind,
      storage_path: att.storagePath,
      mime_type: att.mimeType,
      status: "uploaded",
    })
    .select("id")
    .single();
  if (error || !material) return;

  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ingest-material`;
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({ materialId: material.id }),
  }).catch((err) => console.error("ingest enqueue failed:", err));
}

/** Elapsed-time status line when a planned-length threshold is crossed. */
async function breakStatusLine(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  session: any,
): Promise<string | null> {
  if (!session.planned_minutes) return null;
  const elapsedMin = (Date.now() - new Date(session.started_at).getTime()) /
    60000;
  const { count } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("session_id", session.id)
    .eq("role", "system")
    .eq("display_text", "status");
  const alreadyInjected = count ?? 0;
  const crossed = BREAK_THRESHOLDS.filter(
    (t) => elapsedMin >= t * session.planned_minutes,
  ).length;
  if (crossed <= alreadyInjected) return null;
  return `Session status: ${Math.round(elapsedMin)} of ${session.planned_minutes} planned minutes elapsed. If this is a natural stopping point, weave in a short break suggestion (and call record_break_suggestion).`;
}
