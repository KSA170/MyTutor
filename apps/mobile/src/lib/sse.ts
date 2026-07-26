import type { SseEvent } from "@mytutor/shared";

/**
 * Incremental Server-Sent-Events parser. Push raw text chunks, get parsed
 * SseEvent objects back. Pure logic — unit tested.
 */
export class SseParser {
  private buffer = "";

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    let sep: number;
    while ((sep = this.buffer.indexOf("\n\n")) !== -1) {
      const raw = this.buffer.slice(0, sep);
      this.buffer = this.buffer.slice(sep + 2);
      for (const line of raw.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          events.push(JSON.parse(payload) as SseEvent);
        } catch {
          // Ignore malformed frames rather than killing the stream.
        }
      }
    }
    return events;
  }
}
