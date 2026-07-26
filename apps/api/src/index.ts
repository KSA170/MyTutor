import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HttpError } from "./db.js";
import { authRoutes } from "./routes/auth.js";
import { chatRoutes } from "./routes/chat.js";
import { resourceRoutes } from "./routes/resources.js";
import { socialRoutes } from "./routes/social.js";

const app = new Hono();

app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true }));

app.route("/", authRoutes);
app.route("/", chatRoutes);
app.route("/", resourceRoutes);
app.route("/", socialRoutes);

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: err.message }, err.status as 400);
  }
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal error" }, 500);
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`MyTutor API listening on :${info.port}`);
});
