import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useAgent } from "agents/react";
import { useCallback, useMemo, useState } from "react";
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

  const chat = useAgentChat({ agent });

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
