import type { ChangedFile } from "../shared/contracts";
import { basename, dirname, lockfilesFor } from "./files";
import { parsePatch, type Hunk } from "./patch";

const DEPENDENCY_BLOCKS = new Set([
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
]);

const OBJECT_OPENER = /^\s*"([^"]+)"\s*:\s*\{/;
const DEPENDENCY_ENTRY =
  /^\s*"[^"]+"\s*:\s*"(?:[\^~<>=*]|\d|latest|next|workspace:|npm:|file:|link:|git|https?:|github:)/;
const VERSION_FIELD = /^\s*"version"\s*:/;

function indentOf(text: string): number {
  return text.match(/^\s*/)?.[0].length ?? 0;
}

function opensDependencyBlock(text: string): boolean | null {
  const key = text.match(OBJECT_OPENER)?.[1];
  return key === undefined ? null : DEPENDENCY_BLOCKS.has(key);
}

// Heuristic: the enclosing block is the nearest earlier line on the same side of the hunk
// with less indentation. When the hunk has too little context, it falls back to the hunk
// header section, then to whether the line looks like a `"name": "<version>"` entry, so
// edits deep inside long non-dependency blocks (engines, overrides) can still be misread.
function isInDependencyBlock(hunk: Hunk, index: number): boolean {
  const line = hunk.lines[index];
  if (!line) return false;
  if (opensDependencyBlock(line.text) === true) return true;
  const otherSide = line.kind === "add" ? "del" : "add";
  const indent = indentOf(line.text);
  const parent = hunk.lines
    .slice(0, index)
    .reverse()
    .find((prev) => prev.kind !== otherSide && prev.text.trim() !== "" && indentOf(prev.text) < indent);
  if (parent) return opensDependencyBlock(parent.text) === true;
  const fromSection = opensDependencyBlock(hunk.section);
  if (fromSection !== null) return fromSection;
  return DEPENDENCY_ENTRY.test(line.text) && !VERSION_FIELD.test(line.text);
}

export function changesPackageDependencies(patch: string): boolean {
  return parsePatch(patch).some((hunk) =>
    hunk.lines.some(
      (line, index) => line.kind !== "context" && line.text.trim() !== "" && isInDependencyBlock(hunk, index),
    ),
  );
}

function isDependencyChange(file: ChangedFile): boolean {
  if (basename(file.path) !== "package.json") return true;
  // Without a patch the change cannot be inspected, so assume it touches dependencies.
  return file.patch === undefined || changesPackageDependencies(file.patch);
}

function isSameOrAncestorDir(ancestor: string, dir: string): boolean {
  return ancestor === "" || ancestor === dir || dir.startsWith(`${ancestor}/`);
}

/** Changed dependency manifests with no matching lockfile change in their directory or a parent. */
export function manifestsWithoutLockfile(files: readonly ChangedFile[]): string[] {
  const changed = files.filter((file) => file.status !== "unchanged");
  const hasLockfileFor = (manifest: ChangedFile): boolean => {
    const lockNames = lockfilesFor(basename(manifest.path)) ?? [];
    const manifestDir = dirname(manifest.path);
    return changed.some(
      (file) => lockNames.includes(basename(file.path)) && isSameOrAncestorDir(dirname(file.path), manifestDir),
    );
  };
  return changed
    .filter((file) => file.status !== "removed" && lockfilesFor(basename(file.path)) !== undefined)
    .filter(isDependencyChange)
    .filter((manifest) => !hasLockfileFor(manifest))
    .map((manifest) => manifest.path);
}
