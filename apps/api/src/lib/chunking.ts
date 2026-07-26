/**
 * Pure chunking logic for material ingestion — page-aligned chunks of
 * ~CHUNK_TOKEN_TARGET tokens. No I/O; unit-tested.
 */
import { CHUNK_TOKEN_TARGET } from "@mytutor/shared";

const CHUNK_CHAR_TARGET = CHUNK_TOKEN_TARGET * 4;

export interface PageText {
  page: number | null;
  text: string;
}

export interface Chunk {
  seq: number;
  page_start: number | null;
  page_end: number | null;
  content: string;
  token_estimate: number;
}

export function chunkPages(pages: PageText[]): Chunk[] {
  const chunks: Chunk[] = [];
  let buf = "";
  let start: number | null = null;
  let end: number | null = null;

  const flush = () => {
    const content = buf.trim();
    if (content) {
      chunks.push({
        seq: chunks.length,
        page_start: start,
        page_end: end,
        content,
        token_estimate: Math.ceil(content.length / 4),
      });
    }
    buf = "";
    start = null;
    end = null;
  };

  for (const p of pages) {
    if (!p.text) continue;
    // A single giant page (or unpaged doc) is split on paragraph boundaries.
    const pieces = p.text.length > CHUNK_CHAR_TARGET * 1.5
      ? splitLongText(p.text)
      : [p.text];
    for (const piece of pieces) {
      if (buf.length > 0 && buf.length + piece.length > CHUNK_CHAR_TARGET) {
        flush();
      }
      if (start === null) start = p.page;
      end = p.page;
      buf += (buf ? "\n\n" : "") + piece;
    }
  }
  flush();
  return chunks;
}

export function splitLongText(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  const pieces: string[] = [];
  let buf = "";
  for (const para of paragraphs) {
    if (buf.length > 0 && buf.length + para.length > CHUNK_CHAR_TARGET) {
      pieces.push(buf);
      buf = "";
    }
    buf += (buf ? "\n\n" : "") + para;
  }
  if (buf) pieces.push(buf);
  return pieces;
}
