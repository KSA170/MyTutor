import { describe, expect, it } from "vitest";
import { SseParser } from "../apps/mobile/src/lib/sse.ts";

describe("SseParser", () => {
  it("parses complete events", () => {
    const parser = new SseParser();
    const events = parser.push(
      'data: {"type":"delta","text":"Hello"}\n\ndata: {"type":"done","messageId":"m1","usage":{"inputTokens":1,"outputTokens":2,"cacheReadInputTokens":0,"cacheCreationInputTokens":0}}\n\n',
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "delta", text: "Hello" });
    expect(events[1].type).toBe("done");
  });

  it("handles events split across chunks", () => {
    const parser = new SseParser();
    expect(parser.push('data: {"type":"delta","te')).toHaveLength(0);
    const events = parser.push('xt":"Hi"}\n\n');
    expect(events).toEqual([{ type: "delta", text: "Hi" }]);
  });

  it("handles multiple events in one chunk plus a partial tail", () => {
    const parser = new SseParser();
    const events = parser.push(
      'data: {"type":"thinking","active":true}\n\ndata: {"type":"thinking","active":false}\n\ndata: {"type":"del',
    );
    expect(events).toHaveLength(2);
    expect(parser.push('ta","text":"!"}\n\n')).toEqual([
      { type: "delta", text: "!" },
    ]);
  });

  it("ignores malformed frames without dying", () => {
    const parser = new SseParser();
    const events = parser.push(
      'data: not-json\n\ndata: {"type":"delta","text":"ok"}\n\n',
    );
    expect(events).toEqual([{ type: "delta", text: "ok" }]);
  });

  it("ignores comment/heartbeat lines", () => {
    const parser = new SseParser();
    expect(parser.push(": keep-alive\n\n")).toHaveLength(0);
  });
});
