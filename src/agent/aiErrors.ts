import type { UIMessageChunk } from "ai";

export const AI_DAILY_LIMIT_MESSAGE =
  "The daily Workers AI limit for this app is reached, so I cannot answer right now. It resets at 00:00 UTC. Reviews that already ran are still in the review list.";
export const AI_BUSY_MESSAGE =
  "The AI model is busy right now. Please try again in a minute.";
export const AI_GENERIC_MESSAGE =
  "I could not get an answer from the AI model. Please try again.";

interface ErrorFields {
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
  message?: unknown;
  responseBody?: unknown;
  cause?: unknown;
}

function collectText(error: unknown, depth = 0): string {
  if (depth > 3 || error === null || error === undefined) return "";
  if (typeof error === "string") return error;
  if (typeof error !== "object") return String(error);
  const fields = error as ErrorFields;
  return [fields.message, fields.responseBody, fields.code]
    .filter((value): value is string => typeof value === "string")
    .concat(collectText(fields.cause, depth + 1))
    .join(" ");
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const fields = error as ErrorFields;
  const status = fields.status ?? fields.statusCode;
  return typeof status === "number" ? status : undefined;
}

/**
 * Maps a Workers AI / AI SDK failure to a short message for the chat.
 * Workers AI reports the free daily allocation as error 4006 ("daily free allocation" of neurons).
 */
export function friendlyAiError(error: unknown): string {
  const text = collectText(error).toLowerCase();
  if (/4006|daily free allocation|neurons/.test(text)) return AI_DAILY_LIMIT_MESSAGE;
  if (statusOf(error) === 429 || /rate-limit|rate limit|too many requests|capacity/.test(text)) {
    return AI_BUSY_MESSAGE;
  }
  return AI_GENERIC_MESSAGE;
}

/**
 * Turns stream "error" chunks into a normal assistant text part, so a failed model call
 * ends the turn with a plain, persisted answer instead of an error state in the chat.
 */
export function errorChunksToText(): TransformStream<UIMessageChunk, UIMessageChunk> {
  let count = 0;
  return new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      if (chunk.type !== "error") {
        controller.enqueue(chunk);
        return;
      }
      const id = `ai-error-${count++}`;
      controller.enqueue({ type: "text-start", id });
      controller.enqueue({ type: "text-delta", id, delta: chunk.errorText });
      controller.enqueue({ type: "text-end", id });
    },
  });
}
