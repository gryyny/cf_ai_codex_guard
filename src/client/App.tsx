import { agentNameForRepo } from "../shared/contracts";
import { GuardPage } from "./components/GuardPage";
import { useLiveSession } from "./useLiveSession";
import { useMockSession } from "./useMockSession";
import { useRepoSelection, type RepoSelection } from "./useRepoSelection";

type OpenRepo = (slug: string) => boolean;

function LivePage({ selection, onOpenRepo }: { selection: RepoSelection; onOpenRepo: OpenRepo }) {
  const session = useLiveSession(agentNameForRepo(selection.owner, selection.repo));
  return <GuardPage repoSlug={selection.slug} session={session} onOpenRepo={onOpenRepo} />;
}

function MockPage({ onOpenRepo }: { onOpenRepo: OpenRepo }) {
  const session = useMockSession();
  return <GuardPage repoSlug={session.state?.repo ?? "cloudflare/agents"} session={session} onOpenRepo={onOpenRepo} />;
}

export function App({ mock }: { mock: boolean }) {
  const { selection, openRepo } = useRepoSelection();
  if (mock) return <MockPage onOpenRepo={() => true} />;
  return (
    <LivePage
      key={agentNameForRepo(selection.owner, selection.repo)}
      selection={selection}
      onOpenRepo={openRepo}
    />
  );
}
