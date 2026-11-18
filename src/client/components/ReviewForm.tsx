import { useState, type FormEvent } from "react";
import { parsePrUrl } from "../../shared/contracts";
import { errorMessage } from "../format";

interface ReviewFormProps {
  repoSlug: string;
  disabled: boolean;
  onStart: (prUrl: string) => Promise<{ reviewId: string }>;
  onOpenRepo: (slug: string) => void;
}

type Feedback = { kind: "error"; text: string; otherRepo?: string } | { kind: "ok"; text: string };

export function ReviewForm({ repoSlug, disabled, onStart, onOpenRepo }: ReviewFormProps) {
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const ref = parsePrUrl(url);
    if (!ref) {
      setFeedback({ kind: "error", text: "Enter a GitHub pull request URL, like https://github.com/owner/repo/pull/12." });
      return;
    }
    const prRepo = `${ref.owner}/${ref.repo}`;
    if (prRepo.toLowerCase() !== repoSlug.toLowerCase()) {
      setFeedback({ kind: "error", text: `This PR belongs to ${prRepo}, not ${repoSlug}.`, otherRepo: prRepo });
      return;
    }
    setPending(true);
    setFeedback(null);
    try {
      await onStart(ref.url);
      setFeedback({ kind: "ok", text: `Review of #${ref.number} started.` });
      setUrl("");
    } catch (error) {
      setFeedback({ kind: "error", text: errorMessage(error) });
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="review-form-title">
      <h2 id="review-form-title">Review a PR</h2>
      <form className="stack" onSubmit={onSubmit} noValidate>
        <label htmlFor="pr-url">Pull request URL</label>
        <div className="row">
          <input
            id="pr-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder={`https://github.com/${repoSlug}/pull/1`}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            aria-invalid={feedback?.kind === "error"}
            aria-describedby="pr-url-feedback"
          />
          <button type="submit" className="btn primary" disabled={pending || disabled || !url.trim()}>
            {pending ? "Starting…" : "Start review"}
          </button>
        </div>
        <div id="pr-url-feedback" aria-live="polite">
          {feedback?.kind === "error" ? (
            <p className="inline-error">
              {feedback.text}{" "}
              {feedback.otherRepo ? (
                <button type="button" className="link-button" onClick={() => onOpenRepo(feedback.otherRepo ?? "")}>
                  Open {feedback.otherRepo}
                </button>
              ) : null}
            </p>
          ) : feedback ? (
            <p className="inline-ok">{feedback.text}</p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
