import type { SseEvent } from "../../../packages/shared/src/protocol.ts";

const encoder = new TextEncoder();

/**
 * Server-Sent Events channel over a ReadableStream.
 * Events are our compact protocol from packages/shared (SseEvent union).
 */
export class SseChannel {
  readonly response: Response;
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  private closed = false;

  constructor(extraHeaders: Record<string, string> = {}) {
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
      cancel: () => {
        this.closed = true;
      },
    });
    this.response = new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        ...extraHeaders,
      },
    });
  }

  emit(event: SseEvent): void {
    if (this.closed) return;
    try {
      this.controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
      );
    } catch {
      this.closed = true;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.controller.close();
    } catch {
      // already closed by the client
    }
  }
}
