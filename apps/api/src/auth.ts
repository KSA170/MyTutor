import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import type { Context, Next } from "hono";
import { HttpError, one, q } from "./db.js";

const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(s);
};

export async function signToken(userId: string): Promise<string> {
  return await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export async function verifyToken(token: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) throw new Error("no sub");
    return payload.sub;
  } catch {
    throw new HttpError(401, "Not authenticated");
  }
}

/** Hono middleware: requires a Bearer token, sets c.var userId. */
export async function requireAuth(c: Context, next: Next) {
  const header = c.req.header("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    return c.json({ error: "Not authenticated" }, 401);
  }
  try {
    const userId = await verifyToken(header.slice(7));
    c.set("userId", userId);
    await next();
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Not authenticated" },
      401,
    );
  }
}

export async function createUser(
  email: string,
  password: string,
  displayName: string,
): Promise<{ id: string; token: string }> {
  const normalized = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    throw new HttpError(400, "Enter a valid email address");
  }
  if (password.length < 8) {
    throw new HttpError(400, "Password must be at least 8 characters");
  }
  const existing = await one("select id from users where email = $1", [
    normalized,
  ]);
  if (existing) throw new HttpError(409, "An account with that email exists");

  const hash = await bcrypt.hash(password, 10);
  const user = await one(
    "insert into users (email, password_hash) values ($1, $2) returning id",
    [normalized, hash],
  );
  await q("insert into profiles (id, display_name) values ($1, $2)", [
    user!.id,
    displayName || null,
  ]);
  await q("insert into learning_style_profiles (user_id) values ($1)", [
    user!.id,
  ]);
  return { id: user!.id, token: await signToken(user!.id) };
}

export async function loginUser(
  email: string,
  password: string,
): Promise<{ id: string; token: string }> {
  const user = await one(
    "select id, password_hash from users where email = $1",
    [email.trim().toLowerCase()],
  );
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new HttpError(401, "Wrong email or password");
  }
  return { id: user.id, token: await signToken(user.id) };
}
