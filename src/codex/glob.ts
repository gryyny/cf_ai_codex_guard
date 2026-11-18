function escapeRegex(char: string): string {
  return /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
}

/** Converts a glob to an anchored regex: "**" spans path segments, "*" and "?" stay within one. */
export function globToRegExp(glob: string): RegExp {
  let source = "";
  let i = 0;
  while (i < glob.length) {
    const char = glob.charAt(i);
    if (glob.startsWith("**", i)) {
      const atSegmentStart = i === 0 || glob.charAt(i - 1) === "/";
      const followedBySlash = glob.charAt(i + 2) === "/";
      if (atSegmentStart && followedBySlash) {
        source += "(?:.*/)?";
        i += 3;
      } else {
        source += ".*";
        i += 2;
      }
    } else if (char === "*") {
      source += "[^/]*";
      i += 1;
    } else if (char === "?") {
      source += "[^/]";
      i += 1;
    } else {
      source += escapeRegex(char);
      i += 1;
    }
  }
  return new RegExp(`^${source}$`);
}

export function matchesGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(path);
}
