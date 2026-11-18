import { isTextUIPart, isToolUIPart, type UIMessage } from "ai";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ExceptionRecord } from "../../shared/contracts";
import { daysFromTodayUtc } from "../format";
import { RichText } from "./RichText";
import { ToolPart } from "./ToolPart";

interface ChatPanelProps {
  repoSlug: string;
  messages: UIMessage[];
  exceptions: ExceptionRecord[];
  busy: boolean;
  disabled: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onApproval: (approvalId: string, approved: boolean) => void;
  onClear: () => void;
}

function examplePrompts(repoSlug: string): string[] {
  return [
    `Review https://github.com/${repoSlug}/pull/1`,
    "List the exceptions for this repo",
    `Waive lockfile-sync for this repo until ${daysFromTodayUtc(30)}, reason: one root lockfile, owner: me`,
  ];
}

function Message({
  message,
  exceptions,
  onApproval,
}: {
  message: UIMessage;
  exceptions: ExceptionRecord[];
  onApproval: ChatPanelProps["onApproval"];
}) {
  const parts = message.parts.flatMap((part, i) => {
    if (isTextUIPart(part)) {
      if (!part.text.trim()) return [];
      return message.role === "user" ? (
        <p key={i} className="user-text">
          {part.text}
        </p>
      ) : (
        <RichText key={i} text={part.text} />
      );
    }
    if (isToolUIPart(part)) {
      return <ToolPart key={part.toolCallId} part={part} exceptions={exceptions} onApproval={onApproval} />;
    }
    return [];
  });
  if (parts.length === 0) return null;
  return (
    <li className={`message message-${message.role}`}>
      <span className="message-role">{message.role === "user" ? "You" : "Codex Guard"}</span>
      <div className="message-body">{parts}</div>
    </li>
  );
}

export function ChatPanel(props: ChatPanelProps) {
  const { repoSlug, messages, exceptions, busy, disabled, error, onSend, onApproval, onClear } = props;
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, busy]);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy || disabled) return;
    onSend(trimmed);
    setDraft("");
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send(draft);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(draft);
    }
  };

  return (
    <section className="panel chat" aria-labelledby="chat-title">
      <div className="panel-head">
        <h2 id="chat-title">Chat</h2>
        {messages.length > 0 ? (
          <button type="button" className="btn ghost small" onClick={onClear} disabled={busy}>
            Clear chat
          </button>
        ) : null}
      </div>

      <div className="chat-log" ref={logRef}>
        {messages.length === 0 ? (
          <div className="empty-chat">
            <p>Ask for a review, list the exceptions, or request a new one. Exceptions always need your approval.</p>
            <ul className="examples" aria-label="Example prompts">
              {examplePrompts(repoSlug).map((prompt) => (
                <li key={prompt}>
                  <button type="button" className="example" onClick={() => send(prompt)} disabled={busy || disabled}>
                    {prompt}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ol className="messages" role="log" aria-live="polite" aria-relevant="additions text">
            {messages.map((message) => (
              <Message key={message.id} message={message} exceptions={exceptions} onApproval={onApproval} />
            ))}
          </ol>
        )}
      </div>

      <p className="chat-status" aria-live="polite">
        {busy ? "Codex Guard is replying…" : ""}
      </p>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}

      <form className="composer" onSubmit={onSubmit}>
        <label htmlFor="composer-input" className="visually-hidden">
          Message
        </label>
        <textarea
          id="composer-input"
          rows={2}
          maxLength={2000}
          value={draft}
          placeholder={`Ask about ${repoSlug}…`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
        />
        <button type="submit" className="btn primary" disabled={busy || disabled || !draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
