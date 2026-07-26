import { Hono } from "hono";
import { requireAuth } from "../auth.js";
import { HttpError, one, q } from "../db.js";
import { recapForUser } from "../services/recap.js";

type Env = { Variables: { userId: string } };

// deno-lint-ignore no-explicit-any
type Json = any;

export const socialRoutes = new Hono<Env>();
socialRoutes.use("*", requireAuth);

socialRoutes.get("/stats/daily", async (c) => {
  const days = Math.min(Number(c.req.query("days") ?? 14), 90);
  return c.json(
    await q("select * from get_daily_study_stats($1, $2)", [
      c.get("userId"),
      days,
    ]),
  );
});

socialRoutes.get("/points", async (c) => {
  const row = await one(
    `select coalesce(sum(delta), 0)::int as balance,
            coalesce(sum(delta) filter (where delta > 0), 0)::int as lifetime,
            coalesce(sum(delta) filter (where delta > 0 and created_at >= now() - interval '7 days'), 0)::int as week
     from points_ledger where user_id = $1`,
    [c.get("userId")],
  );
  return c.json(row);
});

socialRoutes.get("/tree", async (c) => {
  const row = await one("select * from tree_states where user_id = $1", [
    c.get("userId"),
  ]);
  return c.json(row);
});

socialRoutes.post("/tree/purchase", async (c) => {
  const body = await c.req.json();
  try {
    const row = await one("select purchase_tree_item($1, $2) as balance", [
      c.get("userId"),
      body.itemId,
    ]);
    return c.json({ balance: row?.balance ?? 0 });
  } catch (err: Json) {
    throw new HttpError(400, err?.message ?? "Purchase failed");
  }
});

socialRoutes.post("/tree/equip", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const items: string[] = Array.isArray(body.items) ? body.items : [];
  await q(
    `insert into tree_states (user_id) values ($1) on conflict (user_id) do nothing`,
    [userId],
  );
  await q(
    `update tree_states
     set equipped_items = (
       select coalesce(array_agg(i), '{}') from unnest($1::text[]) as i
       where i = any (owned_items)
     )
     where user_id = $2`,
    [items, userId],
  );
  return c.json({ ok: true });
});

// ---- friends --------------------------------------------------------------

socialRoutes.post("/friends/request", async (c) => {
  const userId = c.get("userId");
  const handle = String((await c.req.json()).handle ?? "").trim().toLowerCase();
  const target = await one("select id from profiles where handle = $1", [
    handle,
  ]);
  if (!target) throw new HttpError(404, "No user with that handle");
  if (target.id === userId) throw new HttpError(400, "That is you");
  const existing = await one(
    "select id from friendships where (requester_id = $1 and addressee_id = $2) or (requester_id = $2 and addressee_id = $1)",
    [userId, target.id],
  );
  if (existing) {
    throw new HttpError(409, "Friendship already exists or is pending");
  }
  await q(
    "insert into friendships (requester_id, addressee_id) values ($1, $2)",
    [userId, target.id],
  );
  return c.json({ requested: true });
});

socialRoutes.post("/friends/respond", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  if (body.accept) {
    await q(
      "update friendships set status = 'accepted' where id = $1 and addressee_id = $2 and status = 'pending'",
      [body.friendshipId, userId],
    );
  } else {
    await q(
      "delete from friendships where id = $1 and addressee_id = $2 and status = 'pending'",
      [body.friendshipId, userId],
    );
  }
  return c.json({ ok: true });
});

socialRoutes.get("/friends/requests", async (c) => {
  const userId = c.get("userId");
  return c.json(
    await q(
      `select f.id as friendship_id,
              case when f.addressee_id = $1 then 'incoming' else 'outgoing' end as direction,
              coalesce(p.display_name, 'Student') as display_name,
              p.handle,
              f.created_at
       from friendships f
       join profiles p on p.id = case when f.addressee_id = $1 then f.requester_id else f.addressee_id end
       where f.status = 'pending' and (f.addressee_id = $1 or f.requester_id = $1)
       order by f.created_at desc`,
      [userId],
    ),
  );
});

socialRoutes.get("/leaderboard", async (c) => {
  const userId = c.get("userId");
  return c.json(
    await q(
      `with circle as (
         select $1::uuid as uid
         union
         select case when requester_id = $1 then addressee_id else requester_id end
         from friendships
         where status = 'accepted' and (requester_id = $1 or addressee_id = $1)
       )
       select p.id as user_id,
              coalesce(p.display_name, 'Student') as display_name,
              p.handle,
              coalesce((select sum(delta) filter (where delta > 0) from points_ledger l
                        where l.user_id = p.id and l.created_at >= now() - interval '7 days'), 0)::int as points_week,
              coalesce((select sum(round(extract(epoch from (s.ended_at - s.started_at)) / 60)) from sessions s
                        where s.user_id = p.id and s.status = 'completed'
                          and s.ended_at >= now() - interval '7 days'), 0)::int as minutes_week,
              coalesce((select sum(delta) filter (where delta > 0) from points_ledger l
                        where l.user_id = p.id), 0)::int as points_total
       from circle c
       join profiles p on p.id = c.uid
       order by 4 desc, 6 desc`,
      [userId],
    ),
  );
});

socialRoutes.post("/recap", async (c) => {
  return c.json(await recapForUser(c.get("userId")));
});
