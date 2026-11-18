import { getAgentMessages, useAgentChat } from "@cloudflare/ai-chat/react";
import { useAgent } from "agents/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AGENT_CLASS,
  type RepoAgentCallable,
  type RepoAgentState,
  type ReviewReport,
} from "../shared/contracts";
import type { ConnectionStatus, GuardSession } from "./session";

export function useLiveSession(agentName: string): GuardSession {
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const [state, setState] = useState<RepoAgentState | undefined>(undefined);

  const agent = useAgent<RepoAgentState>({
    agent: AGENT_CLASS,
    name: agentName,
    onStateUpdate: (next) => setState(next),
    onOpen: () => setConnection("open"),
    onClose: () => setConnection("closed"),
  });

  // setMessages is only used to resync from the server, so it must not echo back.
  const chat = useAgentChat({ agent, syncMessagesToServer: false });
  useReviewMessageResync(agentName, state ?? agent.state, chat.messages, chat.setMessages);

  const call = useCallback(
    <K extends keyof RepoAgentCallable>(
      method: K,
      args: Parameters<RepoAgentCallable[K]>,
    ): Promise<Awaited<ReturnType<RepoAgentCallable[K]>>> =>
      agent.call<Awaited<ReturnType<RepoAgentCallable[K]>>>(method, args),
    [agent],
  );

  const startReview = useCallback((prUrl: string) => call("startReview", [prUrl]), [call]);
  const removeException = useCallback((id: string) => call("removeException", [id]), [call]);
  const getReview = useCallback(
    (id: string): Promise<ReviewReport | null> => call("getReview", [id]),
    [call],
  );

  const { messages, sendMessage, addToolApprovalResponse, clearHistory, isStreaming, status, error } =
    chat;

  return useMemo<GuardSession>(
    () => ({
      connection,
      connectionError: agent.connectionError ? agent.connectionError.message : null,
      state: state ?? agent.state,
      messages,
      busy: isStreaming || status === "submitted",
      chatError: error ? error.message : null,
      sendMessage: (text) => void sendMessage({ text }),
      respondToApproval: (id, approved) => void addToolApprovalResponse({ id, approved }),
      clearHistory,
      startReview,
      removeException,
      getReview,
    }),
    [
      connection,
      agent.connectionError,
      agent.state,
      state,
      messages,
      isStreaming,
      status,
      error,
      sendMessage,
      addToolApprovalResponse,
      clearHistory,
      startReview,
      removeException,
      getReview,
    ],
  );
}

const RESYNC_DELAY_MS = 1500;

/**
 * The agent posts a summary message when a review finishes. Right after a tool
 * approval turn the client can miss that broadcast, so when a review we saw
 * running finishes and its message is still absent, reload the transcript.
 */
function useReviewMessageResync(
  agentName: string,
  state: RepoAgentState | undefined,
  messages: readonly { id: string }[],
  setMessages: ReturnType<typeof useAgentChat>["setMessages"],
): void {
  const running = useRef(new Set<string>());
  const latestMessages = useRef(messages);
  latestMessages.current = messages;

  useEffect(() => {
    const finished: string[] = [];
    for (const review of state?.reviews ?? []) {
      if (review.status === "running") running.current.add(review.id);
      else if (running.current.delete(review.id)) finished.push(review.id);
    }
    if (finished.length === 0) return;
    const timer = setTimeout(() => {
      const missing = finished.some(
        (id) => !latestMessages.current.some((message) => message.id === `review-${id}`),
      );
      if (!missing) return;
      getAgentMessages({ host: window.location.origin, agent: AGENT_CLASS, name: agentName })
        .then((fresh) => {
          if (fresh.length > 0) setMessages(fresh);
        })
        .catch(() => undefined);
    }, RESYNC_DELAY_MS);
    return () => clearTimeout(timer);
  }, [agentName, state?.reviews, setMessages]);
}
