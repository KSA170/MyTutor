import { Hono } from "hono";
import { createUser, loginUser, requireAuth } from "../auth.js";
import { HttpError, one } from "../db.js";

type Env = { Variables: { userId: string } };

export const authRoutes = new Hono<Env>();

authRoutes.post("/auth/signup", async (c) => {
  const body = await c.req.json();
  const { id, token } = await createUser(
    body.email ?? "",
    body.password ?? "",
    body.displayName ?? "",
  );
  return c.json({ token, userId: id });
});

authRoutes.post("/auth/login", async (c) => {
  const body = await c.req.json();
  const { id, token } = await loginUser(body.email ?? "", body.password ?? "");
  return c.json({ token, userId: id });
});

authRoutes.get("/auth/me", requireAuth, async (c) => {
  const userId = c.get("userId");
  const user = await one("select id, email from users where id = $1", [userId]);
  if (!user) throw new HttpError(401, "Not authenticated");
  const profile = await one("select * from profiles where id = $1", [userId]);
  return c.json({ user, profile });
});
