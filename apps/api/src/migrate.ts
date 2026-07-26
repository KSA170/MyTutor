/** Tiny forward-only migration runner: node --run migrate (or tsx src/migrate.ts). */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "./db.js";

const dir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

await pool.query(
  "create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())",
);

const applied = new Set(
  (await pool.query("select name from _migrations")).rows.map((r) => r.name),
);

for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  if (applied.has(file)) continue;
  const sql = readFileSync(path.join(dir, file), "utf8");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into _migrations (name) values ($1)", [file]);
    await client.query("commit");
    console.log(`applied ${file}`);
  } catch (err) {
    await client.query("rollback");
    console.error(`FAILED ${file}:`, err);
    process.exit(1);
  } finally {
    client.release();
  }
}
console.log("migrations up to date");
await pool.end();
