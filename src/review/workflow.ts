import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "agents/workflows";
import { RULES } from "../shared/contracts";
import type {
  Finding,
  PullRequestRef,
  ReviewProgress,
  ReviewReport,
  ReviewStep,
  ReviewWorkflowParams,
} from "../shared/contracts";
import type { RepoAgent } from "../agent/RepoAgent";
import { applyExceptions, buildLlmInput, countFindings, runCodeChecks } from "../codex";
import { NonRetryableError } from "./errors";
import { fetchPullFiles, fetchPullMeta, mergePull } from "./github";
import { LLM_DIFF_MAX_CHARS, judgeLlmRules, llmErrorFindings } from "./llm";

const STEPS: readonly ReviewStep[] = ["fetch-pr", "fetch-files", "code-checks", "llm-checks", "apply-exceptions", "save"];

const GITHUB_STEP = { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" }, timeout: "1 minute" } as const;
const LLM_STEP = { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }, timeout: "2 minutes" } as const;
const LOCAL_STEP = { retries: { limit: 1, delay: "1 second" }, timeout: "30 seconds" } as const;
const AGENT_STEP = { retries: { limit: 2, delay: "2 seconds", backoff: "exponential" }, timeout: "30 seconds" } as const;

interface LlmStepResult {
  findings: Finding[];
  skippedFiles: string[];
}

function assertRepoMatches(repo: string, pr: PullRequestRef): void {
  const prRepo = `${pr.owner}/${pr.repo}`.toLowerCase();
  if (repo !== prRepo) throw new NonRetryableError(`This PR belongs to ${prRepo}, not to ${repo}.`);
}

function inRulesOrder(findings: Finding[]): Finding[] {
  const index = (f: Finding) => RULES.findIndex((rule) => rule.id === f.ruleId);
  return [...findings].sort((a, b) => index(a) - index(b));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class ReviewWorkflow extends AgentWorkflow<RepoAgent, ReviewWorkflowParams, ReviewProgress> {
  private progress(step: ReviewStep): Promise<void> {
    return this.reportProgress({ step, percent: (STEPS.indexOf(step) + 1) / STEPS.length });
  }

  async run(event: AgentWorkflowEvent<ReviewWorkflowParams>, step: AgentWorkflowStep): Promise<ReviewReport> {
    const { repo, pr: ref } = event.payload;
    assertRepoMatches(repo, ref);
    const token = this.env.GITHUB_TOKEN;
    const model = this.env.LLM_MODEL;

    const meta = await step.do("fetch-pr", GITHUB_STEP, () => fetchPullMeta(ref, token));
    await this.progress("fetch-pr");

    const files = await step.do("fetch-files", GITHUB_STEP, () => fetchPullFiles(ref, token));
    const pr = mergePull(meta, files);
    await this.progress("fetch-files");

    const codeFindings = await step.do("code-checks", LOCAL_STEP, async () => runCodeChecks(pr));
    await this.progress("code-checks");

    // A failed LLM step should not sink the whole review: the code findings still stand.
    let llm: LlmStepResult;
    try {
      llm = await step.do("llm-checks", LLM_STEP, async (): Promise<LlmStepResult> => {
        const input = buildLlmInput(pr, LLM_DIFF_MAX_CHARS);
        const findings = await judgeLlmRules(this.env.AI, model, input);
        return { findings, skippedFiles: input.skippedFiles };
      });
    } catch (err) {
      llm = { findings: llmErrorFindings(`LLM check failed: ${errorMessage(err)}`), skippedFiles: [] };
    }
    await this.progress("llm-checks");

    const findings = await step.do("apply-exceptions", AGENT_STEP, async () => {
      const exceptions = await this.agent.listExceptions();
      const today = new Date().toISOString().slice(0, 10);
      return applyExceptions(inRulesOrder([...codeFindings, ...llm.findings]), exceptions, today);
    });
    await this.progress("apply-exceptions");

    const report = await step.do("save", AGENT_STEP, async (): Promise<ReviewReport> => {
      const finished: ReviewReport = {
        id: event.instanceId,
        pr: ref,
        title: pr.title,
        author: pr.author,
        headSha: pr.headSha,
        createdAt: new Date().toISOString(),
        findings,
        counts: countFindings(findings),
        model,
        skippedForLlm: llm.skippedFiles,
      };
      await this.agent.saveReview(finished);
      return finished;
    });
    await this.progress("save");

    await step.reportComplete(report);
    return report;
  }
}
