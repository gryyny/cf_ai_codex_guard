import { getToolApproval } from "@cloudflare/ai-chat/react";
import { getToolName, type DynamicToolUIPart, type ToolUIPart } from "ai";
import type { ExceptionRecord } from "../../shared/contracts";
import { readString } from "../format";

type AnyToolPart = ToolUIPart | DynamicToolUIPart;

interface ToolPartProps {
  part: AnyToolPart;
  exceptions: ExceptionRecord[];
  onApproval: (approvalId: string, approved: boolean) => void;
}

const TOOL_LABELS: Record<string, string> = {
  reviewPullRequest: "Review a pull request",
  addException: "Add an exception",
  removeException: "Remove an exception",
  listExceptions: "List exceptions",
};

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={mono ? "mono" : undefined}>{value}</dd>
    </>
  );
}

function ApprovalCard({ name, part, exceptions, onApproval }: ToolPartProps & { name: string }) {
  const approval = getToolApproval(part);
  const input = part.input;
  const removing = name === "removeException";
  const target = removing ? exceptions.find((e) => e.id === readString(input, "id")) : undefined;
  const ruleId = target?.ruleId ?? readString(input, "ruleId") ?? "unknown rule";
  const pathGlob = target ? target.pathGlob : readString(input, "pathGlob");

  return (
    <section className="approval-card" aria-label={`${TOOL_LABELS[name] ?? name}: approval needed`}>
      <h3>{removing ? "Remove this exception?" : "Add this exception?"}</h3>
      <dl className="fields">
        <Field label="Rule" value={ruleId} mono />
        <Field label="Path" value={pathGlob ? pathGlob : "whole repo"} mono={Boolean(pathGlob)} />
        <Field label="Reason" value={target?.reason ?? readString(input, "reason") ?? "-"} />
        <Field label="Owner" value={target?.owner ?? readString(input, "owner") ?? "-"} />
        <Field label="Expires" value={target?.expiresOn ?? readString(input, "expiresOn") ?? "-"} />
        {removing && !target ? <Field label="Id" value={readString(input, "id") ?? "-"} mono /> : null}
      </dl>
      {approval ? (
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => onApproval(approval.id, true)}>
            Approve
          </button>
          <button type="button" className="btn" onClick={() => onApproval(approval.id, false)}>
            Reject
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function ToolPart(props: ToolPartProps) {
  const { part } = props;
  const name = getToolName(part);
  const label = TOOL_LABELS[name] ?? name;

  if (part.state === "approval-requested") return <ApprovalCard {...props} name={name} />;

  if (part.state === "approval-responded" || part.state === "output-denied") {
    const approved = part.approval.approved;
    return (
      <p className={`chip ${approved ? "chip-pass" : "chip-muted"}`}>
        {label}: {approved ? "approved" : "rejected"}
      </p>
    );
  }

  if (part.state === "input-streaming" || part.state === "input-available") {
    return <p className="chip chip-muted">{name === "reviewPullRequest" ? "Starting review…" : `${label}…`}</p>;
  }

  if (part.state === "output-error") {
    return (
      <p className="chip chip-error" role="status">
        {label} failed: {part.errorText}
      </p>
    );
  }

  if (name === "reviewPullRequest") {
    return <p className="chip chip-accent">Review started</p>;
  }

  return (
    <details className="tool-details">
      <summary>{label}: done</summary>
      <pre>{JSON.stringify(part.output, null, 2)}</pre>
    </details>
  );
}
