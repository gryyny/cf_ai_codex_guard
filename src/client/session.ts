import type { UIMessage } from "ai";
import type { RepoAgentCallable, RepoAgentState } from "../shared/contracts";

export type ConnectionStatus = "connecting" | "open" | "closed" | "mock";

/** Everything the page needs from a repo agent, live or mocked. */
export interface GuardSession extends RepoAgentCallable {
  connection: ConnectionStatus;
  connectionError: string | null;
  state: RepoAgentState | undefined;
  messages: UIMessage[];
  busy: boolean;
  chatError: string | null;
  sendMessage(text: string): void;
  respondToApproval(approvalId: string, approved: boolean): void;
  clearHistory(): void;
}
