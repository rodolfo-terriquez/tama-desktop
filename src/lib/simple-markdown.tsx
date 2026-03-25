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

function getHeading(line: string): { level: 1 | 2 | 3 | 4 | 5 | 6; text: string } | null {
  const match = /^(#{1,6})\s+(.*)$/.exec(line.trim());
  if (!match) return null;
  return {
    level: match[1].length as 1 | 2 | 3 | 4 | 5 | 6,
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

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  return /^\|?[\s:-]+(?:\|[\s:-]+)+\|?$/.test(trimmed) && trimmed.includes("-");
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes("|") && splitTableRow(trimmed).length >= 2;
}

function getTable(lines: string[], startIndex: number): { header: string[]; rows: string[][]; nextIndex: number } | null {
  if (startIndex + 1 >= lines.length) return null;
  const headerLine = lines[startIndex];
  const separatorLine = lines[startIndex + 1];

  if (!isTableRow(headerLine) || !isTableSeparator(separatorLine)) {
    return null;
  }

  const header = splitTableRow(headerLine);
  const rows: string[][] = [];
  let index = startIndex + 2;

  while (index < lines.length && lines[index].trim()) {
    if (!isTableRow(lines[index])) break;
    rows.push(splitTableRow(lines[index]));
    index += 1;
  }

  return {
    header,
    rows,
    nextIndex: index,
  };
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

    const table = getTable(lines, index);
    if (table) {
      blocks.push(
        <div
          key={`table-${index}`}
          className="overflow-x-auto rounded-lg border border-border/60 bg-background/30"
        >
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-foreground/5">
                {table.header.map((cell, cellIndex) => (
                  <th
                    key={cellIndex}
                    className="px-3 py-2 text-left font-semibold align-top"
                  >
                    {renderInlineMarkdown(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-border/40 last:border-b-0">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-3 py-2 align-top text-muted-foreground">
                      {renderInlineMarkdown(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      index = table.nextIndex;
      continue;
    }

    const heading = getHeading(line);
    if (heading) {
      const headingClass =
        heading.level === 1
          ? "text-base font-semibold"
          : heading.level === 2
            ? "text-[0.95rem] font-semibold"
            : heading.level === 3
              ? "text-sm font-semibold"
              : "text-sm font-semibold text-foreground/95";
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
