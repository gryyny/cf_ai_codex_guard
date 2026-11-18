import type { ReactNode } from "react";

type Block = { kind: "paragraph"; lines: string[] } | { kind: "list"; ordered: boolean; items: string[] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s)]+)/g;

function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.replace(/^#{1,6}\s+/, "");
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const last = blocks[blocks.length - 1];
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const item = (bullet ?? numbered)?.[1] ?? "";
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(item);
      else blocks.push({ kind: "list", ordered, items: [item] });
    } else if (line.trim() === "") {
      if (last?.kind === "paragraph" && last.lines.length > 0) blocks.push({ kind: "paragraph", lines: [] });
    } else if (last?.kind === "paragraph") {
      last.lines.push(line);
    } else {
      blocks.push({ kind: "paragraph", lines: [line] });
    }
  }
  return blocks.filter((block) => block.kind === "list" || block.lines.length > 0);
}

function githubHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === "https:" && (host === "github.com" || host === "www.github.com")
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

function link(label: string, url: string, key: string): ReactNode {
  const href = githubHref(url);
  if (!href) return label === url ? url : `${label} (${url})`;
  return (
    <a key={key} href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE).map((token, i) => {
    const key = `${keyPrefix}-${i}`;
    if (token.startsWith("**") && token.endsWith("**") && token.length > 4) {
      return <strong key={key}>{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith("`") && token.endsWith("`") && token.length > 2) {
      return <code key={key}>{token.slice(1, -1)}</code>;
    }
    const md = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
    if (md?.[1] && md[2]) return link(md[1], md[2], key);
    if (/^https?:\/\//.test(token)) {
      const trimmed = token.replace(/[.,;:!?]+$/, "");
      const rest = token.slice(trimmed.length);
      return [link(trimmed, trimmed, key), rest];
    }
    return token;
  });
}

export function RichText({ text }: { text: string }) {
  return (
    <div className="rich-text">
      {toBlocks(text).map((block, b) => {
        if (block.kind === "paragraph") {
          return (
            <p key={b}>
              {block.lines.flatMap((line, l) => [
                ...(l > 0 ? [<br key={`br-${l}`} />] : []),
                ...renderInline(line, `${b}-${l}`),
              ])}
            </p>
          );
        }
        const items = block.items.map((item, i) => <li key={i}>{renderInline(item, `${b}-${i}`)}</li>);
        return block.ordered ? <ol key={b}>{items}</ol> : <ul key={b}>{items}</ul>;
      })}
    </div>
  );
}
