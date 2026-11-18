import type { UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";
import {
  AI_BUSY_MESSAGE,
  AI_DAILY_LIMIT_MESSAGE,
  AI_GENERIC_MESSAGE,
  errorChunksToText,
  friendlyAiError,
} from "./aiErrors";

describe("friendlyAiError", () => {
  it("detects the Workers AI daily free limit", () => {
    const error = Object.assign(new Error("AiError: 4006: you have used up your daily free allocation of 10,000 neurons"), {
      code: "rate-limit",
      status: 429,
    });
    expect(friendlyAiError(error)).toBe(AI_DAILY_LIMIT_MESSAGE);
    expect(friendlyAiError(new Error("wrapped", { cause: error }))).toBe(AI_DAILY_LIMIT_MESSAGE);
  });

  it("maps other rate limits to a busy message", () => {
    expect(friendlyAiError(Object.assign(new Error("slow down"), { status: 429 }))).toBe(AI_BUSY_MESSAGE);
    expect(friendlyAiError({ code: "rate-limit", message: "x" })).toBe(AI_BUSY_MESSAGE);
  });

  it("hides details of other errors", () => {
    expect(friendlyAiError(new Error("socket hang up at 10.0.0.1"))).toBe(AI_GENERIC_MESSAGE);
    expect(friendlyAiError(undefined)).toBe(AI_GENERIC_MESSAGE);
  });
});

async function collect(chunks: UIMessageChunk[]): Promise<UIMessageChunk[]> {
  const source = new ReadableStream<UIMessageChunk>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
  const out: UIMessageChunk[] = [];
  const reader = source.pipeThrough(errorChunksToText()).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out.push(value);
  }
}

describe("errorChunksToText", () => {
  it("replaces error chunks with a text part and keeps the rest", async () => {
    const out = await collect([
      { type: "text-start", id: "t" },
      { type: "error", errorText: AI_BUSY_MESSAGE },
    ]);
    expect(out).toEqual([
      { type: "text-start", id: "t" },
      { type: "text-start", id: "ai-error-0" },
      { type: "text-delta", id: "ai-error-0", delta: AI_BUSY_MESSAGE },
      { type: "text-end", id: "ai-error-0" },
    ]);
  });
});
