import type { ChangedFile, LlmReviewInput, PullRequestData } from "../shared/contracts";
import { isGeneratedOrVendored } from "./files";

const BODY_LIMIT = 4000;
const SEPARATOR = "\n\n";

interface PatchedFile extends ChangedFile {
  patch: string;
}

function hasPatch(file: ChangedFile): file is PatchedFile {
  return file.patch !== undefined;
}

function fileBlock(file: PatchedFile): string {
  return `### ${file.path} (${file.status}, +${file.additions} -${file.deletions})\n${file.patch}`;
}

function capBody(body: string): string {
  return body.length > BODY_LIMIT
    ? `${body.slice(0, BODY_LIMIT)}\n[description cut at ${BODY_LIMIT} characters]`
    : body;
}

/** Builds the capped, filtered input for the LLM rules. maxChars caps diffExcerpt. */
export function buildLlmInput(pr: PullRequestData, maxChars = 24000): LlmReviewInput {
  const eligible = pr.files.filter((file): file is PatchedFile => hasPatch(file) && !isGeneratedOrVendored(file.path));
  const eligibleSet = new Set<ChangedFile>(eligible);
  const filtered = pr.files.filter((file) => !eligibleSet.has(file)).map((file) => file.path);
  const blocks = [...eligible]
    .sort((a, b) => a.patch.length - b.patch.length)
    .map((file) => ({ path: file.path, block: fileBlock(file) }));

  const { included, overflow } = blocks.reduce<{ included: string[]; overflow: string[]; size: number }>(
    (acc, { path, block }) => {
      const nextSize = acc.size + (acc.included.length > 0 ? SEPARATOR.length : 0) + block.length;
      return acc.overflow.length === 0 && nextSize <= maxChars
        ? { ...acc, included: [...acc.included, block], size: nextSize }
        : { ...acc, overflow: [...acc.overflow, path] };
    },
    { included: [], overflow: [], size: 0 },
  );

  return {
    title: pr.title,
    body: capBody(pr.body),
    diffExcerpt: included.join(SEPARATOR),
    skippedFiles: [...filtered, ...overflow],
  };
}
