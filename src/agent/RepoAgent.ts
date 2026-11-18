import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { callable } from "agents";
import { createAI } from "agents/models/ai-sdk";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  pruneMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import {
  RULES,
  repoFromAgentName,
  type ExceptionRecord,
  type RepoAgentCallable,
  type RepoAgentRpc,
  type RepoAgentState,
  type ReviewReport,
  type ReviewWorkflowParams,
  type RuleId,
} from "../shared/contracts";
import { errorChunksToText, friendlyAiError } from "./aiErrors";
import { LIMITS, utcDate, validateNewException, type ExceptionInput } from "./exceptionInput";
import { buildSystemPrompt } from "./prompt";
import { reportToMarkdown, reviewFailedMarkdown } from "./reportMarkdown";
import { reportForTool } from "./reportView";
import {
  checkPrForRepo,
  isReviewProgress,
  isReviewReport,
  isStaleReview,
  shortError,
} from "./reviewInput";
import {
  MAX_REVIEW_SUMMARIES,
  parseReport,
  toExceptionRecords,
  toReviewSummaries,
  type ExceptionRow,
  type ReviewRow,
} from "./rows";

const WORKFLOW = "REVIEW_WORKFLOW";
const MAX_STEPS = 4;
const MAX_CONTEXT_MESSAGES = 40;
const MESSAGE_WAIT_MS = 10_000;

const RULE_IDS = RULES.map((rule) => rule.id) as [RuleId, ...RuleId[]];

type ActiveReview = RepoAgentState["activeReview"];

export class RepoAgent
  extends AIChatAgent<Env, RepoAgentState>
  implements RepoAgentRpc, RepoAgentCallable
{
  initialState: RepoAgentState = { repo: "", exceptions: [], reviews: [], activeReview: null };
  maxPersistedMessages = 100;

  private get repo(): string {
    const repo = repoFromAgentName(this.name);
    if (!repo) throw new Error(`"${this.name}" is not a valid repo agent name. Use "owner.repo".`);
    return repo;
  }

  async onStart(): Promise<void> {
    const repo = this.repo;
    this.sql`CREATE TABLE IF NOT EXISTS exceptions (
      id TEXT PRIMARY KEY,
      repo TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      path_glob TEXT,
      reason TEXT NOT NULL,
      owner TEXT NOT NULL,
      expires_on TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`;
    this.sql`CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      pr_url TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      error TEXT,
      report_json TEXT
    )`;
    this.syncState(this.state.repo === repo ? this.state.activeReview : null);
  }

  // ---------- SQL <-> state ----------

  private readExceptions(): ExceptionRecord[] {
    return toExceptionRecords(this.sql<ExceptionRow>`SELECT * FROM exceptions WHERE repo = ${this.repo}`);
  }

  private readReview(id: string): ReviewRow | null {
    return this.sql<ReviewRow>`SELECT * FROM reviews WHERE id = ${id}`[0] ?? null;
  }

  private syncState(activeReview: ActiveReview = this.state.activeReview): void {
    const rows = this.sql<ReviewRow>`SELECT * FROM reviews ORDER BY started_at DESC LIMIT ${MAX_REVIEW_SUMMARIES}`;
    this.setState({
      repo: this.repo,
      exceptions: this.readExceptions(),
      reviews: toReviewSummaries(rows),
      activeReview,
    });
  }

  private activeAfterFinishing(reviewId: string): ActiveReview {
    const active = this.state.activeReview;
    return active?.id === reviewId ? null : active;
  }

  private markErrored(reviewId: string, error: string): boolean {
    const row = this.readReview(reviewId);
    if (!row || row.status !== "running") return false;
    this.sql`UPDATE reviews SET status = 'errored', finished_at = ${new Date().toISOString()}, error = ${error}
      WHERE id = ${reviewId}`;
    this.syncState(this.activeAfterFinishing(reviewId));
    return true;
  }

  /** A review whose workflow never called back must not block the repo forever. */
  private releaseStaleReview(): void {
    const active = this.state.activeReview;
    if (!active) return;
    const row = this.readReview(active.id);
    if (!row || row.status !== "running") {
      this.syncState(null);
    } else if (isStaleReview(row.started_at, new Date())) {
      this.markErrored(active.id, "The review timed out.");
    }
  }

  // ---------- Chat messages without a model turn ----------

  /** Same id twice (workflow step retry) updates the message instead of adding a copy. */
  private async appendAssistantMessage(id: string, text: string): Promise<void> {
    // Pending approvals are ignored on purpose: they can wait for a human for a long time.
    await this.waitUntilStable({ timeout: MESSAGE_WAIT_MS, pendingInteraction: () => false });
    const message: UIMessage = { id, role: "assistant", parts: [{ type: "text", text }] };
    const exists = this.messages.some((existing) => existing.id === id);
    const next = exists
      ? this.messages.map((existing) => (existing.id === id ? message : existing))
      : [...this.messages, message];
    await this.persistMessages(next);
  }

  // ---------- RPC for the review workflow ----------

  async listExceptions(): Promise<ExceptionRecord[]> {
    return this.readExceptions();
  }

  async saveReview(report: ReviewReport): Promise<void> {
    if (`${report.pr.owner}/${report.pr.repo}`.toLowerCase() !== this.repo) {
      throw new Error(`Report for ${report.pr.owner}/${report.pr.repo} does not belong to ${this.repo}.`);
    }
    const finishedAt = new Date().toISOString();
    const json = JSON.stringify(report);
    if (this.readReview(report.id)) {
      this.sql`UPDATE reviews SET status = 'complete', title = ${report.title}, finished_at = ${finishedAt},
        error = NULL, report_json = ${json} WHERE id = ${report.id}`;
    } else {
      this.sql`INSERT INTO reviews (id, pr_url, pr_number, title, status, started_at, finished_at, error, report_json)
        VALUES (${report.id}, ${report.pr.url}, ${report.pr.number}, ${report.title}, 'complete',
          ${report.createdAt}, ${finishedAt}, NULL, ${json})`;
    }
    this.syncState(this.activeAfterFinishing(report.id));
    await this.appendAssistantMessage(`review-${report.id}`, reportToMarkdown(report, this.readExceptions()));
  }

  // ---------- Callable methods for the page ----------

  @callable()
  async startReview(prUrl: string): Promise<{ reviewId: string }> {
    const check = checkPrForRepo(prUrl, this.repo);
    if (!check.ok) throw new Error(check.error);
    this.releaseStaleReview();
    const active = this.state.activeReview;
    if (active) throw new Error(`A review is already running for ${active.prUrl}. Wait until it finishes.`);

    const { pr } = check;
    const reviewId = crypto.randomUUID();
    // Row and activeReview are written before the first await, so a parallel call sees them.
    this.sql`INSERT INTO reviews (id, pr_url, pr_number, title, status, started_at, finished_at, error, report_json)
      VALUES (${reviewId}, ${pr.url}, ${pr.number}, ${`PR #${pr.number}`}, 'running',
        ${new Date().toISOString()}, NULL, NULL, NULL)`;
    this.syncState({ id: reviewId, prUrl: pr.url, progress: null });

    try {
      const params: ReviewWorkflowParams = { repo: this.repo, pr };
      await this.runWorkflow(WORKFLOW, params, { id: reviewId, metadata: { prUrl: pr.url } });
    } catch (error) {
      console.error("Review workflow did not start", shortError(error));
      this.markErrored(reviewId, "The review could not start.");
      throw new Error("The review could not start. Please try again.");
    }
    return { reviewId };
  }

  @callable()
  async removeException(id: string): Promise<void> {
    const found = this.sql<{ id: string }>`SELECT id FROM exceptions WHERE id = ${id} AND repo = ${this.repo}`;
    if (found.length === 0) throw new Error(`No exception with id ${id} in ${this.repo}.`);
    this.sql`DELETE FROM exceptions WHERE id = ${id} AND repo = ${this.repo}`;
    this.syncState();
  }

  @callable()
  async getReview(id: string): Promise<ReviewReport | null> {
    return parseReport(this.readReview(id)?.report_json ?? null);
  }

  private addException(input: ExceptionInput): ExceptionRecord | { error: string } {
    const result = validateNewException(input, utcDate(new Date()));
    if (!result.ok) return { error: result.error };
    const { ruleId, pathGlob, reason, owner, expiresOn } = result.value;
    const record: ExceptionRecord = {
      id: crypto.randomUUID(),
      repo: this.repo,
      ruleId,
      pathGlob,
      reason,
      owner,
      expiresOn,
      createdAt: new Date().toISOString(),
    };
    this.sql`INSERT INTO exceptions (id, repo, rule_id, path_glob, reason, owner, expires_on, created_at)
      VALUES (${record.id}, ${record.repo}, ${record.ruleId}, ${record.pathGlob}, ${record.reason},
        ${record.owner}, ${record.expiresOn}, ${record.createdAt})`;
    this.syncState();
    return record;
  }

  private latestReport(): ReviewReport | null {
    const row = this.sql<ReviewRow>`SELECT * FROM reviews WHERE status = 'complete'
      ORDER BY finished_at DESC LIMIT 1`[0];
    return parseReport(row?.report_json ?? null);
  }

  // ---------- Workflow callbacks ----------

  async onWorkflowProgress(workflowName: string, workflowId: string, progress: unknown): Promise<void> {
    const active = this.state.activeReview;
    if (workflowName !== WORKFLOW || active?.id !== workflowId || !isReviewProgress(progress)) return;
    this.setState({ ...this.state, activeReview: { ...active, progress } });
  }

  /** Fallback for a workflow that returned its report without calling saveReview. */
  async onWorkflowComplete(workflowName: string, workflowId: string, result?: unknown): Promise<void> {
    if (workflowName !== WORKFLOW || this.readReview(workflowId)?.status !== "running") return;
    if (isReviewReport(result, workflowId)) {
      await this.saveReview(result);
    } else {
      await this.failReview(workflowId, "The review finished without a report.");
    }
  }

  async onWorkflowError(workflowName: string, workflowId: string, error: string): Promise<void> {
    if (workflowName !== WORKFLOW) return;
    await this.failReview(workflowId, shortError(error));
  }

  private async failReview(reviewId: string, rawError: string): Promise<void> {
    // Workflow errors arrive as "NonRetryableError: <message>"; users only need the message.
    const error = rawError.replace(/^\w*Error:\s*/, "");
    const row = this.readReview(reviewId);
    if (!row || !this.markErrored(reviewId, error)) return;
    await this.appendAssistantMessage(`review-${reviewId}`, reviewFailedMarkdown(row.pr_url, error));
  }

  // ---------- Chat ----------

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions): Promise<Response> {
    const today = utcDate(new Date());
    const ai = createAI({ binding: this.env.AI });
    const modelMessages = await convertToModelMessages(this.messages.slice(-MAX_CONTEXT_MESSAGES));

    const result = streamText({
      model: ai(this.env.LLM_MODEL),
      system: buildSystemPrompt(this.repo, today, RULES),
      messages: pruneMessages({ messages: modelMessages, toolCalls: "before-last-2-messages" }),
      tools: this.chatTools(today),
      temperature: 0.1,
      maxRetries: 1,
      stopWhen: stepCountIs(MAX_STEPS),
      abortSignal: options?.abortSignal,
      onError: ({ error }) => console.error("Chat model error", shortError(error)),
    });

    const stream = result.toUIMessageStream({ onError: friendlyAiError }).pipeThrough(errorChunksToText());
    return createUIMessageStreamResponse({ stream });
  }

  private chatTools(today: string) {
    return {
      reviewPullRequest: tool({
        description:
          "Start a background review of a pull request of this repo. The result is posted to the chat when done.",
        inputSchema: z.object({ prUrl: z.string().max(300).describe("Full GitHub PR URL") }),
        execute: async ({ prUrl }) => {
          try {
            const { reviewId } = await this.startReview(prUrl);
            return {
              reviewId,
              status: "started" as const,
              note: "The result will be posted to the chat automatically. Tell the user it started and stop.",
            };
          } catch (error) {
            return { error: shortError(error) };
          }
        },
      }),
      listExceptions: tool({
        description: "List this repo's rule exceptions, including expired ones.",
        inputSchema: z.object({}),
        execute: async () => ({ today, exceptions: this.readExceptions() }),
      }),
      addException: tool({
        description:
          "Add a time-boxed exception to a rule. Needs the user's approval. Ask for reason, owner and expiry first.",
        inputSchema: z.object({
          ruleId: z.enum(RULE_IDS),
          pathGlob: z
            .string()
            .max(LIMITS.pathGlob.max)
            .optional()
            .describe('Optional glob like "src/generated/**"; leave out for the whole repo'),
          reason: z.string().max(LIMITS.reason.max),
          owner: z.string().max(LIMITS.owner.max).describe("Person or team responsible"),
          expiresOn: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .describe("Last valid day, YYYY-MM-DD"),
        }),
        // Invalid input skips approval and returns the policy error to the model instead.
        needsApproval: (input) => validateNewException(input, today).ok,
        execute: async (input) => this.addException(input),
      }),
      removeException: tool({
        description: "Remove an exception by id. Needs the user's approval.",
        inputSchema: z.object({ id: z.string().max(100) }),
        needsApproval: true,
        execute: async ({ id }) => {
          try {
            await this.removeException(id);
            return { removed: id };
          } catch (error) {
            return { error: shortError(error) };
          }
        },
      }),
      getLatestReview: tool({
        description: "Get the findings of the latest finished review of this repo.",
        inputSchema: z.object({}),
        execute: async () => {
          const report = this.latestReport();
          return report ? reportForTool(report, this.readExceptions()) : { error: "No finished review yet." };
        },
      }),
    };
  }
}
