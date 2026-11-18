// STUB (lead, P0). Agent 2 replaces this with the review workflow.
import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "agents/workflows";
import type { ReviewProgress, ReviewReport, ReviewWorkflowParams } from "../shared/contracts";
import type { RepoAgent } from "../agent/RepoAgent";

export class ReviewWorkflow extends AgentWorkflow<RepoAgent, ReviewWorkflowParams, ReviewProgress> {
  async run(
    _event: AgentWorkflowEvent<ReviewWorkflowParams>,
    _step: AgentWorkflowStep,
  ): Promise<ReviewReport> {
    throw new Error("not implemented");
  }
}
