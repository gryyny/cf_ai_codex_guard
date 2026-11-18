import { useState } from "react";
import type { ExceptionRecord } from "../../shared/contracts";
import { errorMessage, isExpired, ruleById } from "../format";

interface ExceptionsListProps {
  exceptions: ExceptionRecord[];
  disabled: boolean;
  onRemove: (id: string) => Promise<void>;
}

function ExceptionItem({ exception, disabled, onRemove }: { exception: ExceptionRecord } & Omit<ExceptionsListProps, "exceptions">) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expired = isExpired(exception.expiresOn);
  const rule = ruleById(exception.ruleId);

  const remove = async () => {
    setPending(true);
    setError(null);
    try {
      await onRemove(exception.id);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
      setConfirming(false);
    }
  };

  return (
    <li className={`exception${expired ? " is-expired" : ""}`}>
      <div className="exception-head">
        <span className="mono rule-id" title={rule?.title}>
          {exception.ruleId}
        </span>
        {expired ? <span className="badge badge-expired">expired</span> : null}
      </div>
      <p className="exception-path">
        {exception.pathGlob ? <span className="mono">{exception.pathGlob}</span> : <span className="muted">whole repo</span>}
      </p>
      <p className="exception-reason">{exception.reason}</p>
      <p className="meta">
        <span>Owner: {exception.owner}</span>
        <span>
          {expired ? "Expired" : "Expires"} <time dateTime={exception.expiresOn}>{exception.expiresOn}</time>
        </span>
      </p>
      {confirming ? (
        <div className="confirm" role="group" aria-label={`Confirm removal of ${exception.ruleId} exception`}>
          <span>Remove this exception?</span>
          <button type="button" className="btn danger small" onClick={remove} disabled={pending || disabled}>
            {pending ? "Removing…" : "Yes, remove"}
          </button>
          <button type="button" className="btn small" onClick={() => setConfirming(false)} disabled={pending}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className="btn ghost small" onClick={() => setConfirming(true)} disabled={disabled}>
          Remove
        </button>
      )}
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

export function ExceptionsList({ exceptions, disabled, onRemove }: ExceptionsListProps) {
  return (
    <section className="panel" aria-labelledby="exceptions-title">
      <h2 id="exceptions-title">
        Exceptions <span className="count">{exceptions.length}</span>
      </h2>
      {exceptions.length === 0 ? (
        <p className="muted">No exceptions. Ask in the chat to add one; you approve it before it is saved.</p>
      ) : (
        <ul className="list">
          {exceptions.map((exception) => (
            <ExceptionItem key={exception.id} exception={exception} disabled={disabled} onRemove={onRemove} />
          ))}
        </ul>
      )}
    </section>
  );
}
