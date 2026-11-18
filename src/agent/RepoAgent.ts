// STUB (lead, P0). Agent 3 replaces this with the repo agent.
import { AIChatAgent } from "@cloudflare/ai-chat";
import type {
  ExceptionRecord,
  RepoAgentCallable,
  RepoAgentRpc,
  RepoAgentState,
  ReviewReport,
} from "../shared/contracts";

export class RepoAgent
  extends AIChatAgent<Env, RepoAgentState>
  implements RepoAgentRpc, RepoAgentCallable
{
  async listExceptions(): Promise<ExceptionRecord[]> {
    throw new Error("not implemented");
  }
  async saveReview(_report: ReviewReport): Promise<void> {
    throw new Error("not implemented");
  }
  async startReview(_prUrl: string): Promise<{ reviewId: string }> {
    throw new Error("not implemented");
  }
  async removeException(_id: string): Promise<void> {
    throw new Error("not implemented");
  }
  async getReview(_id: string): Promise<ReviewReport | null> {
    throw new Error("not implemented");
  }
}
