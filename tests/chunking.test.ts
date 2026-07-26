import { describe, expect, it } from "vitest";
import { chunkPages } from "../apps/api/src/lib/chunking.ts";
import { CHUNK_TOKEN_TARGET } from "../packages/shared/src/protocol.ts";

const CHAR_TARGET = CHUNK_TOKEN_TARGET * 4;

describe("chunkPages", () => {
  it("keeps small pages together and tracks page ranges", () => {
    const chunks = chunkPages([
      { page: 1, text: "Page one." },
      { page: 2, text: "Page two." },
      { page: 3, text: "Page three." },
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].page_start).toBe(1);
    expect(chunks[0].page_end).toBe(3);
    expect(chunks[0].seq).toBe(0);
  });

  it("splits when the size target is exceeded, on page boundaries", () => {
    const bigPage = "x".repeat(Math.floor(CHAR_TARGET * 0.7));
    const chunks = chunkPages([
      { page: 1, text: bigPage },
      { page: 2, text: bigPage },
      { page: 3, text: bigPage },
    ]);
    expect(chunks.length).toBeGreaterThan(1);
    // No chunk mixes partial pages: boundaries land between pages.
    expect(chunks[0].page_start).toBe(1);
    expect(chunks[chunks.length - 1].page_end).toBe(3);
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(CHAR_TARGET * 1.6);
    }
  });

  it("splits a single giant unpaged document on paragraphs", () => {
    const para = "word ".repeat(200).trim();
    const doc = Array.from({ length: 30 }, () => para).join("\n\n");
    const chunks = chunkPages([{ page: null, text: doc }]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.token_estimate).toBeGreaterThan(0);
    }
    // Content round-trips (modulo whitespace joins).
    const joined = chunks.map((c) => c.content).join("\n\n");
    expect(joined.replace(/\s+/g, " ")).toBe(doc.replace(/\s+/g, " "));
  });

  it("skips empty pages", () => {
    const chunks = chunkPages([
      { page: 1, text: "" },
      { page: 2, text: "Content." },
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].page_start).toBe(2);
  });
});
