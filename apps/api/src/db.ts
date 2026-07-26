import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("render.com")
    ? { rejectUnauthorized: false }
    : undefined,
  max: 10,
});

// deno-lint-ignore no-explicit-any
type Row = any;

/** Parameterized query returning all rows. */
export async function q(text: string, params: unknown[] = []): Promise<Row[]> {
  const result = await pool.query(text, params);
  return result.rows;
}

/** Parameterized query returning the first row or null. */
export async function one(
  text: string,
  params: unknown[] = [],
): Promise<Row | null> {
  const rows = await q(text, params);
  return rows[0] ?? null;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
