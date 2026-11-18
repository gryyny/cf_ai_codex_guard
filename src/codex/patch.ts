export type DiffLineKind = "add" | "del" | "context";

export interface DiffLine {
  kind: DiffLineKind;
  /** Line text without the diff prefix. */
  text: string;
  /** Line number in the new file; null for deleted lines. */
  newLine: number | null;
}

export interface Hunk {
  /** Text after the closing "@@" (the enclosing section git found, often empty). */
  section: string;
  lines: DiffLine[];
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/;

interface ParseState {
  hunks: Hunk[];
  nextNewLine: number;
}

function parseLine(state: ParseState, raw: string): ParseState {
  const header = raw.match(HUNK_HEADER);
  if (header) {
    return {
      hunks: [...state.hunks, { section: header[2] ?? "", lines: [] }],
      nextNewLine: Number(header[1]),
    };
  }
  const current = state.hunks.at(-1);
  // Lines before the first hunk are file headers ("--- a/x", "+++ b/x"), never content.
  if (!current) return state;
  const prefix = raw.charAt(0);
  const text = raw.slice(1);
  const line: DiffLine | null =
    prefix === "+"
      ? { kind: "add", text, newLine: state.nextNewLine }
      : prefix === "-"
        ? { kind: "del", text, newLine: null }
        : prefix === " " || raw === ""
          ? { kind: "context", text, newLine: state.nextNewLine }
          : null;
  if (!line) return state;
  const updated: Hunk = { ...current, lines: [...current.lines, line] };
  return {
    hunks: [...state.hunks.slice(0, -1), updated],
    nextNewLine: line.kind === "del" ? state.nextNewLine : state.nextNewLine + 1,
  };
}

/** Parses a GitHub unified diff patch into hunks with new-file line numbers. */
export function parsePatch(patch: string): Hunk[] {
  const rawLines = patch.split("\n");
  // A trailing newline yields an empty last element that is not a context line.
  const lines = rawLines.at(-1) === "" ? rawLines.slice(0, -1) : rawLines;
  return lines.reduce<ParseState>(parseLine, { hunks: [], nextNewLine: 0 }).hunks;
}

export function addedLines(patch: string): DiffLine[] {
  return parsePatch(patch).flatMap((hunk) => hunk.lines.filter((line) => line.kind === "add"));
}
