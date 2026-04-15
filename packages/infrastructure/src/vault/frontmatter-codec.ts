import { createHash } from "node:crypto";
import type { NoteFrontmatter } from "@mimir/domain";

const FRONTMATTER_KEYS: (keyof NoteFrontmatter)[] = [
  "noteId",
  "title",
  "project",
  "type",
  "status",
  "updated",
  "summary",
  "tags",
  "scope",
  "corpusId",
  "currentState",
  "validFrom",
  "validUntil",
  "supersedes",
  "supersededBy"
];

export interface ParsedMarkdownNote {
  frontmatter: NoteFrontmatter;
  body: string;
}

export function serializeMarkdownNote(input: ParsedMarkdownNote): string {
  const frontmatterLines = FRONTMATTER_KEYS.flatMap((key) => {
    const value = input.frontmatter[key];
    if (value === undefined) {
      return [];
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return [`${key}: []`];
      }

      return [
        `${key}:`,
        ...value.map((item) => `  - ${quoteString(item)}`)
      ];
    }

    if (typeof value === "boolean") {
      return [`${key}: ${value ? "true" : "false"}`];
    }

    return [`${key}: ${quoteString(String(value))}`];
  });

  return ["---", ...frontmatterLines, "---", "", normalizeLineEndings(input.body), ""].join("\n");
}

export function parseMarkdownNote(markdown: string): ParsedMarkdownNote {
  const normalized = normalizeLineEndings(markdown);
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error("Markdown note is missing YAML frontmatter.");
  }

  const frontmatter = parseFrontmatterBlock(match[1]);
  return {
    frontmatter,
    body: match[2].trim()
  };
}

export function computeRevision(markdown: string): string {
  return createHash("sha256").update(markdown, "utf8").digest("hex");
}

function parseFrontmatterBlock(block: string): NoteFrontmatter {
  const values = new Map<string, unknown>();
  const lines = block.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) {
      throw new Error(`Unsupported frontmatter line '${line}'.`);
    }

    const [, key, rawValue] = match;
    if (rawValue === "") {
      const items: string[] = [];
      while (index + 1 < lines.length && lines[index + 1].match(/^\s*-\s+/)) {
        index += 1;
        const itemLine = lines[index].replace(/^\s*-\s+/, "");
        items.push(unquoteString(itemLine.trim()));
      }
      values.set(key, items);
      continue;
    }

    values.set(key, parseScalarValue(rawValue.trim()));
  }

  return {
    noteId: asString(values.get("noteId")),
    title: asString(values.get("title")),
    project: asString(values.get("project")),
    type: asString(values.get("type")) as NoteFrontmatter["type"],
    status: asString(values.get("status")) as NoteFrontmatter["status"],
    updated: asString(values.get("updated")),
    summary: asString(values.get("summary")),
    tags: asStringArray(values.get("tags")) as NoteFrontmatter["tags"],
    scope: asString(values.get("scope")),
    corpusId: asString(values.get("corpusId")) as NoteFrontmatter["corpusId"],
    currentState: asBoolean(values.get("currentState")),
    validFrom: optionalString(values.get("validFrom")),
    validUntil: optionalString(values.get("validUntil")),
    supersedes: optionalStringArray(values.get("supersedes")),
    supersededBy: optionalString(values.get("supersededBy"))
  };
}

function parseScalarValue(value: string): boolean | string | string[] {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (value === "[]") {
    return [];
  }

  return unquoteString(value);
}

function quoteString(value: string): string {
  return JSON.stringify(value);
}

function unquoteString(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function optionalStringArray(value: unknown): string[] | undefined {
  const items = asStringArray(value);
  return items.length > 0 ? items : undefined;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n").trimEnd();
}
