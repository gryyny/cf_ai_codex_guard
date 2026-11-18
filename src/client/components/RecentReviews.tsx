import { useState } from "react";
import type { FindingStatus, ReviewReport, ReviewSummary } from "../../shared/contracts";
import { errorMessage, formatDateTime, ruleById } from "../format";

interface RecentReviewsProps {
  reviews: ReviewSummary[];
  onLoad: (id: string) => Promise<ReviewReport | null>;
}

type Loaded =
  | { kind: "loading" }
  | { kind: "error"; text: string }
  | { kind: "missing" }
  | { kind: "report"; report: ReviewReport };

const STATUS_ORDER: Record<FindingStatus, number> = { fail: 0, error: 1, warn: 2, waived: 3, pass: 4 };

function ReportView({ report }: { report: ReviewReport }) {
  const findings = [...report.findings].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  return (
    <div className="report">
      <p className="meta">
        <span>by {report.author}</span>
        <span className="mono">{report.headSha.slice(0, 7)}</span>
        <span>{formatDateTime(report.createdAt)}</span>
      </p>
      <ul className="findings">
        {findings.map((finding) => (
          <li key={finding.ruleId} className="finding">
            <span className={`status status-${finding.status}`}>{finding.status}</span>
            <div>
              <p className="finding-title">
                {ruleById(finding.ruleId)?.title ?? finding.ruleId}{" "}
                <span className="mono muted">{finding.ruleId}</span>
              </p>
              <p>{finding.message}</p>
              {finding.paths && finding.paths.length > 0 ? (
                <ul className="paths">
                  {finding.paths.map((path) => (
                    <li key={path} className="mono">
                      {path}
                    </li>
                  ))}
                </ul>
              ) : null}
              {finding.waivedBy ? <p className="muted small">Waived by exception {finding.waivedBy}</p> : null}
              {finding.expiredException ? (
                <p className="muted small">Exception {finding.expiredException} has expired</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <p className="muted small">
        Model checks: <span className="mono">{report.model}</span>
        {report.skippedForLlm.length > 0 ? ` · ${report.skippedForLlm.length} file(s) not sent to the model` : ""}
      </p>
    </div>
  );
}

function ReviewItem({ review, onLoad }: { review: ReviewSummary; onLoad: RecentReviewsProps["onLoad"] }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const panelId = `report-${review.id}`;

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || loaded?.kind === "report") return;
    setLoaded({ kind: "loading" });
    try {
      const report = await onLoad(review.id);
      setLoaded(report ? { kind: "report", report } : { kind: "missing" });
    } catch (error) {
      setLoaded({ kind: "error", text: errorMessage(error) });
    }
  };

  return (
    <li className="review">
      <div className="review-head">
        <a href={review.prUrl} target="_blank" rel="noopener noreferrer" className="review-title">
          <span className="mono">#{review.prNumber}</span> {review.title}
        </a>
        <span className={`status status-${review.status}`}>{review.status}</span>
      </div>
      <div className="review-sub">
        {review.counts ? (
          <span className="counts">
            <span className="count-fail">{review.counts.fail} fail</span>
            <span className="count-warn">{review.counts.warn} warn</span>
            <span className="count-waived">{review.counts.waived} waived</span>
          </span>
        ) : (
          <span className="muted">{formatDateTime(review.startedAt)}</span>
        )}
        {review.status === "complete" ? (
          <button type="button" className="btn ghost small" aria-expanded={open} aria-controls={panelId} onClick={toggle}>
            {open ? "Hide report" : "Show report"}
          </button>
        ) : null}
      </div>
      {review.error ? <p className="inline-error">{review.error}</p> : null}
      {open ? (
        <div id={panelId}>
          {loaded?.kind === "loading" ? <p className="muted">Loading report…</p> : null}
          {loaded?.kind === "missing" ? <p className="muted">The report is not available.</p> : null}
          {loaded?.kind === "error" ? <p className="inline-error">{loaded.text}</p> : null}
          {loaded?.kind === "report" ? <ReportView report={loaded.report} /> : null}
        </div>
      ) : null}
    </li>
  );
}

export function RecentReviews({ reviews, onLoad }: RecentReviewsProps) {
  return (
    <section className="panel" aria-labelledby="reviews-title">
      <h2 id="reviews-title">Recent reviews</h2>
      {reviews.length === 0 ? (
        <p className="muted">No reviews yet.</p>
      ) : (
        <ul className="list">
          {reviews.map((review) => (
            <ReviewItem key={review.id} review={review} onLoad={onLoad} />
          ))}
        </ul>
      )}
    </section>
  );
}
