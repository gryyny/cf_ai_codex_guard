import type { UIMessage } from "ai";
import { useMemo, useState } from "react";
import { parsePrUrl, type RepoAgentState } from "../shared/contracts";
import { MOCK_MESSAGES, MOCK_REPORTS, MOCK_STATE } from "./mock";
import type { GuardSession } from "./session";

const REPLY =
  "This is mock mode, so no model is connected. Open the page without `?mock=1` to talk to the agent.";

function respond(messages: UIMessage[], approvalId: string, approved: boolean): UIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) =>
      "approval" in part && part.approval?.id === approvalId && part.state === "approval-requested"
        ? { ...part, state: "approval-responded" as const, approval: { id: approvalId, approved } }
        : part,
    ),
  }));
}

export function useMockSession(): GuardSession {
  const [state, setState] = useState<RepoAgentState>(MOCK_STATE);
  const [messages, setMessages] = useState<UIMessage[]>(MOCK_MESSAGES);

  return useMemo<GuardSession>(
    () => ({
      connection: "mock",
      connectionError: null,
      state,
      messages,
      busy: false,
      chatError: null,
      sendMessage: (text) =>
        setMessages((prev) => [
          ...prev,
          { id: `u${prev.length}`, role: "user", parts: [{ type: "text", text }] },
          { id: `a${prev.length}`, role: "assistant", parts: [{ type: "text", text: REPLY }] },
        ]),
      respondToApproval: (id, approved) => setMessages((prev) => respond(prev, id, approved)),
      clearHistory: () => setMessages([]),
      startReview: async (prUrl) => {
        const ref = parsePrUrl(prUrl);
        if (!ref) throw new Error("That is not a GitHub pull request URL.");
        const id = `rev-${ref.number}-${Date.now()}`;
        setState((prev) => ({
          ...prev,
          activeReview: { id, prUrl: ref.url, progress: { step: "fetch-pr", percent: 0.05 } },
          reviews: [
            {
              id,
              prUrl: ref.url,
              prNumber: ref.number,
              title: `Pull request #${ref.number}`,
              status: "running" as const,
              startedAt: new Date().toISOString(),
            },
            ...prev.reviews,
          ].slice(0, 10),
        }));
        return { reviewId: id };
      },
      removeException: async (id) =>
        setState((prev) => ({ ...prev, exceptions: prev.exceptions.filter((e) => e.id !== id) })),
      getReview: async (id) => MOCK_REPORTS[id] ?? null,
    }),
    [state, messages],
  );
}
