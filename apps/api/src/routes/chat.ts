import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { SseEvent, TutorChatRequest } from "@mytutor/shared";
import { requireAuth } from "../auth.js";
import { one } from "../db.js";
import { runTutorTurn } from "../ai/loop.js";
import { finishSession } from "../services/session.js";

type Env = { Variables: { userId: string } };

export const chatRoutes = new Hono<Env>();

chatRoutes.post("/chat", requireAuth, async (c) => {
  const userId = c.get("userId");
  const body = (await c.req.json()) as TutorChatRequest;
  if (!body.sessionId || !body.message?.trim()) {
    return c.json({ error: "sessionId and message are required" }, 400);
  }
  const session = await one(
    "select * from sessions where id = $1 and user_id = $2",
    [body.sessionId, userId],
  );
  if (!session) return c.json({ error: "Session not found" }, 404);
  if (session.status !== "active") {
    return c.json({ error: "Session is not active" }, 409);
  }

  return streamSSE(c, async (stream) => {
    // Serialize writes: emit is sync for the loop, ordered on this chain.
    let chain = Promise.resolve();
    const emit = (event: SseEvent) => {
      chain = chain.then(() =>
        stream.writeSSE({ data: JSON.stringify(event) })
      ).catch(() => {});
    };
    try {
      await runTutorTurn(userId, session, body, emit);
    } catch (err) {
      console.error("chat turn failed:", err);
      emit({
        type: "error",
        message: "Something went wrong. Please try again.",
      });
    }
    await chain;
  });
});

chatRoutes.post("/sessions/:id/finish", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const outcome = body.outcome === "abandoned" ? "abandoned" : "completed";
  const result = await finishSession(
    c.get("userId"),
    c.req.param("id") ?? "",
    outcome,
  );
  return c.json(result);
});
