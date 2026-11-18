import { useEffect, useState, type FormEvent } from "react";
import type { ConnectionStatus } from "../session";

interface HeaderProps {
  repoSlug: string;
  connection: ConnectionStatus;
  onOpenRepo: (slug: string) => boolean;
}

const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  connecting: "Connecting",
  open: "Connected",
  closed: "Offline, retrying",
  mock: "Mock data",
};

export function Header({ repoSlug, connection, onOpenRepo }: HeaderProps) {
  const [draft, setDraft] = useState(repoSlug);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(repoSlug), [repoSlug]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (onOpenRepo(draft)) setError(null);
    else setError("Use the form owner/repo, for example cloudflare/agents.");
  };

  return (
    <header className="site-header">
      <div className="brand">
        <h1>
          <span className="logo" aria-hidden="true">
            ◆
          </span>
          Codex Guard
        </h1>
        <p className="tagline">Checks a pull request against engineering rules and remembers each repo's approved exceptions.</p>
      </div>
      <form className="repo-picker" onSubmit={onSubmit}>
        <label htmlFor="repo-input">Repository</label>
        <div className="row">
          <input
            id="repo-input"
            className="mono"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="owner/repo"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(error)}
            aria-describedby="repo-feedback"
          />
          <button type="submit" className="btn">
            Open
          </button>
        </div>
        <p id="repo-feedback" className={error ? "inline-error" : "connection"} aria-live="polite">
          {error ?? (
            <>
              <span className={`dot dot-${connection}`} aria-hidden="true" />
              {CONNECTION_LABELS[connection]}
            </>
          )}
        </p>
      </form>
    </header>
  );
}
