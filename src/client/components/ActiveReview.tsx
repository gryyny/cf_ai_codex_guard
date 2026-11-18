import type { RepoAgentState, ReviewStep } from "../../shared/contracts";

const STEP_LABELS: Record<ReviewStep, string> = {
  "fetch-pr": "Fetching the pull request",
  "fetch-files": "Fetching changed files",
  "code-checks": "Running code checks",
  "llm-checks": "Running model checks",
  "apply-exceptions": "Applying exceptions",
  save: "Saving the report",
};

export function ActiveReview({ active }: { active: RepoAgentState["activeReview"] }) {
  const number = active ? /\/pull\/(\d+)/.exec(active.prUrl)?.[1] : undefined;
  const percent = active?.progress ? Math.round(Math.min(1, Math.max(0, active.progress.percent)) * 100) : 0;
  const stepLabel = active?.progress ? STEP_LABELS[active.progress.step] : "Queued";

  return (
    <section className="panel" aria-labelledby="active-title">
      <h2 id="active-title">Active review</h2>
      <div aria-live="polite">
        {active ? (
          <div className="stack">
            <p className="active-line">
              <a href={active.prUrl} target="_blank" rel="noopener noreferrer">
                {number ? `PR #${number}` : active.prUrl}
              </a>
              <span>
                {stepLabel} · {percent}%
              </span>
            </p>
            <div
              className="progress"
              role="progressbar"
              aria-label="Review progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-valuetext={`${stepLabel}, ${percent}%`}
            >
              <div className="progress-bar" style={{ width: `${percent}%` }} />
            </div>
          </div>
        ) : (
          <p className="muted">No review is running.</p>
        )}
      </div>
    </section>
  );
}
