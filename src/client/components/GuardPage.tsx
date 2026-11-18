import type { GuardSession } from "../session";
import { ActiveReview } from "./ActiveReview";
import { ChatPanel } from "./ChatPanel";
import { ExceptionsList } from "./ExceptionsList";
import { Header } from "./Header";
import { RecentReviews } from "./RecentReviews";
import { ReviewForm } from "./ReviewForm";

interface GuardPageProps {
  repoSlug: string;
  session: GuardSession;
  onOpenRepo: (slug: string) => boolean;
}

export function GuardPage({ repoSlug, session, onOpenRepo }: GuardPageProps) {
  const { state } = session;
  const offline = session.connection === "connecting" || session.connection === "closed";

  return (
    <div className="app">
      <Header repoSlug={repoSlug} connection={session.connection} onOpenRepo={onOpenRepo} />
      {session.connectionError ? (
        <p className="banner" role="alert">
          Could not connect to the agent for {repoSlug}: {session.connectionError}
        </p>
      ) : null}
      <main className="layout">
        <ChatPanel
          repoSlug={repoSlug}
          messages={session.messages}
          exceptions={state?.exceptions ?? []}
          busy={session.busy}
          disabled={offline}
          error={session.chatError}
          onSend={session.sendMessage}
          onApproval={session.respondToApproval}
          onClear={session.clearHistory}
        />
        <aside className="side" aria-label="Repository status">
          <ReviewForm repoSlug={repoSlug} disabled={offline} onStart={session.startReview} onOpenRepo={onOpenRepo} />
          {state ? (
            <>
              <ActiveReview active={state.activeReview} />
              <ExceptionsList exceptions={state.exceptions} disabled={offline} onRemove={session.removeException} />
              <RecentReviews reviews={state.reviews} onLoad={session.getReview} />
            </>
          ) : (
            <section className="panel">
              <p className="muted" aria-live="polite">
                Loading the state of {repoSlug}…
              </p>
            </section>
          )}
        </aside>
      </main>
    </div>
  );
}
