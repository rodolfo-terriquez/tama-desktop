import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SimpleMarkdownProps {
  content: string;
  className?: string;
}

type ListType = "ordered" | "unordered";

function renderInlineMarkdown(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(<strong key={match.index}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(
        <code
          key={match.index}
          className="rounded bg-foreground/8 px-1 py-0.5 font-mono text-[0.95em]"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      parts.push(<em key={match.index}>{token.slice(1, -1)}</em>);
    } else {
      parts.push(token);
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function isRule(line: string): boolean {
  return /^-{3,}$/.test(line.trim());
}

function getHeading(line: string): { level: 1 | 2 | 3; text: string } | null {
  const match = /^(#{1,3})\s+(.*)$/.exec(line.trim());
  if (!match) return null;
  return {
    level: match[1].length as 1 | 2 | 3,
    text: match[2],
  };
}

function getListItem(line: string): { type: ListType; text: string } | null {
  const trimmed = line.trim();
  const ordered = /^(\d+)\.\s+(.*)$/.exec(trimmed);
  if (ordered) {
    return { type: "ordered", text: ordered[2] };
  }

  const unordered = /^[-*]\s+(.*)$/.exec(trimmed);
  if (unordered) {
    return { type: "unordered", text: unordered[1] };
  }

  return null;
}

export function SimpleMarkdown({ content, className }: SimpleMarkdownProps) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (isRule(trimmed)) {
      blocks.push(<hr key={`rule-${index}`} className="border-border/60" />);
      index += 1;
      continue;
    }

    const heading = getHeading(line);
    if (heading) {
      const headingClass =
        heading.level === 1
          ? "text-base font-semibold"
          : heading.level === 2
            ? "text-[0.95rem] font-semibold"
            : "text-sm font-semibold";
      blocks.push(
        <div key={`heading-${index}`} className={headingClass}>
          {renderInlineMarkdown(heading.text)}
        </div>
      );
      index += 1;
      continue;
    }

    const listItem = getListItem(line);
    if (listItem) {
      const listType = listItem.type;
      const items: string[] = [];

      while (index < lines.length) {
        const current = getListItem(lines[index]);
        if (!current || current.type !== listType) break;
        items.push(current.text);
        index += 1;
      }

      const ListTag = listType === "ordered" ? "ol" : "ul";
      blocks.push(
        <ListTag
          key={`list-${blocks.length}`}
          className={cn("space-y-1.5 pl-5", listType === "ordered" ? "list-decimal" : "list-disc")}
        >
          {items.map((item, itemIndex) => (
            <li key={itemIndex} className="pl-0.5">
              {renderInlineMarkdown(item)}
            </li>
          ))}
        </ListTag>
      );
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length) {
      const next = lines[index];
      if (!next.trim() || isRule(next.trim()) || getHeading(next) || getListItem(next)) {
        break;
      }
      paragraphLines.push(next);
      index += 1;
    }

    blocks.push(
      <div key={`paragraph-${blocks.length}`} className="leading-relaxed whitespace-pre-wrap">
        {renderInlineMarkdown(paragraphLines.join("\n"))}
      </div>
    );
  }

  return <div className={cn("space-y-3", className)}>{blocks}</div>;
}
