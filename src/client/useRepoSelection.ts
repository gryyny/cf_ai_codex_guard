import { useCallback, useState } from "react";
import { parseRepoSlug } from "../shared/contracts";

const STORAGE_KEY = "codex-guard:repo";
export const DEFAULT_REPO = "cloudflare/agents";

export interface RepoSelection {
  owner: string;
  repo: string;
  /** "owner/repo" as the user typed it. */
  slug: string;
}

function toSelection(slug: string | null | undefined): RepoSelection | null {
  if (!slug) return null;
  const parsed = parseRepoSlug(slug);
  return parsed ? { ...parsed, slug: `${parsed.owner}/${parsed.repo}` } : null;
}

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(slug: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, slug);
  } catch {
    // Storage can be blocked; the URL still carries the repo.
  }
}

function initialSelection(): RepoSelection {
  const fromUrl = new URLSearchParams(window.location.search).get("repo");
  return toSelection(fromUrl) ?? toSelection(readStored()) ?? { owner: "cloudflare", repo: "agents", slug: DEFAULT_REPO };
}

function syncUrl(slug: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("repo", slug);
  window.history.replaceState(null, "", url);
}

export function useRepoSelection(): {
  selection: RepoSelection;
  openRepo: (slug: string) => boolean;
} {
  const [selection, setSelection] = useState<RepoSelection>(() => {
    const initial = initialSelection();
    syncUrl(initial.slug);
    return initial;
  });

  const openRepo = useCallback((slug: string): boolean => {
    const next = toSelection(slug);
    if (!next) return false;
    syncUrl(next.slug);
    writeStored(next.slug);
    setSelection(next);
    return true;
  }, []);

  return { selection, openRepo };
}
