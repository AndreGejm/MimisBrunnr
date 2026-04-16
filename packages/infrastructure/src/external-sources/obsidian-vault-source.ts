import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import type {
  ExternalSourceAccessPolicy,
  ExternalSourceAdapter,
  ExternalSourceDocumentContent,
  ExternalSourceDocumentRef,
  ExternalSourceRegistration
} from "@mimir/contracts";

interface ParsedMarkdown {
  frontmatter: Record<string, string>;
  title: string;
  links: ExternalSourceDocumentContent["links"];
}

export class ObsidianVaultSource implements ExternalSourceAdapter {
  private readonly registration: ExternalSourceRegistration;
  private readonly rootPath: string;

  constructor(registration: ExternalSourceRegistration) {
    if (registration.sourceType !== "obsidian_vault") {
      throw new Error("ObsidianVaultSource requires sourceType obsidian_vault");
    }

    if (registration.accessPolicy.allowWrites !== false) {
      throw new Error("ObsidianVaultSource only supports read-only external source policies");
    }

    this.rootPath = resolve(registration.rootPath);
    this.registration = {
      ...registration,
      rootPath: this.rootPath,
      accessPolicy: copyAccessPolicy(registration.accessPolicy)
    };
  }

  getRegistration(): ExternalSourceRegistration {
    return {
      ...this.registration,
      accessPolicy: copyAccessPolicy(this.registration.accessPolicy)
    };
  }

  async listDocuments(): Promise<ExternalSourceDocumentRef[]> {
    const documents: ExternalSourceDocumentRef[] = [];
    await this.walkDirectory(this.rootPath, documents);
    return documents.sort((left, right) => left.path.localeCompare(right.path));
  }

  async readDocument(documentPath: string): Promise<ExternalSourceDocumentContent> {
    const normalizedPath = normalizeExternalPath(documentPath);
    assertReadAllowed(normalizedPath, this.registration.accessPolicy);

    const absolutePath = this.resolveInsideRoot(normalizedPath);
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      throw new Error(`External source path is not a file: ${normalizedPath}`);
    }

    const content = await readFile(absolutePath, "utf8");
    const parsed = parseMarkdown(content, normalizedPath);

    return {
      sourceId: this.registration.sourceId,
      sourceType: this.registration.sourceType,
      path: normalizedPath,
      title: parsed.title,
      contentType: "text/markdown",
      content,
      frontmatter: parsed.frontmatter,
      links: parsed.links,
      contentHash: `sha256:${createHash("sha256").update(content).digest("hex")}`
    };
  }

  private async walkDirectory(directoryPath: string, documents: ExternalSourceDocumentRef[]): Promise<void> {
    const entries = await readdir(directoryPath, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = join(directoryPath, entry.name);
      const normalizedPath = normalizeResolvedPath(this.rootPath, absolutePath);

      if (isDefaultDeniedPath(normalizedPath) || matchesAnyGlob(normalizedPath, this.registration.accessPolicy.deniedReadGlobs)) {
        continue;
      }

      if (entry.isDirectory()) {
        await this.walkDirectory(absolutePath, documents);
        continue;
      }

      if (!entry.isFile() || extname(entry.name).toLowerCase() !== ".md") {
        continue;
      }

      if (!isReadAllowed(normalizedPath, this.registration.accessPolicy)) {
        continue;
      }

      const content = await readFile(absolutePath, "utf8");
      const parsed = parseMarkdown(content, normalizedPath);
      documents.push({
        sourceId: this.registration.sourceId,
        sourceType: this.registration.sourceType,
        path: normalizedPath,
        title: parsed.title,
        contentType: "text/markdown"
      });
    }
  }

  private resolveInsideRoot(normalizedPath: string): string {
    const absolutePath = resolve(this.rootPath, normalizedPath);
    if (absolutePath !== this.rootPath && !absolutePath.startsWith(`${this.rootPath}${sep}`)) {
      throw new Error("External source paths must be relative path inside the external source root");
    }

    return absolutePath;
  }
}

function copyAccessPolicy(policy: ExternalSourceAccessPolicy): ExternalSourceAccessPolicy {
  return {
    allowedReadGlobs: [...policy.allowedReadGlobs],
    deniedReadGlobs: [...policy.deniedReadGlobs],
    allowWrites: false,
    deniedWriteGlobs: [...policy.deniedWriteGlobs]
  };
}

function normalizeResolvedPath(rootPath: string, absolutePath: string): string {
  const rootRelativePath = relative(rootPath, absolutePath);
  return rootRelativePath.split(sep).join("/");
}

function normalizeExternalPath(documentPath: string): string {
  if (documentPath.includes("\0") || documentPath.trim() === "") {
    throw new Error("External source paths must be relative path inside the external source root");
  }

  if (isAbsolute(documentPath) || /^[A-Za-z]:[\\/]/.test(documentPath)) {
    throw new Error("External source paths must be relative path inside the external source root");
  }

  const normalizedPath = posix.normalize(documentPath.replaceAll("\\", "/"));
  if (normalizedPath === "." || normalizedPath === ".." || normalizedPath.startsWith("../")) {
    throw new Error("External source paths must be relative path inside the external source root");
  }

  return normalizedPath;
}

function assertReadAllowed(normalizedPath: string, policy: ExternalSourceAccessPolicy): void {
  if (!isReadAllowed(normalizedPath, policy)) {
    throw new Error(`External source path is not allowed by external source access policy: ${normalizedPath}`);
  }
}

function isReadAllowed(normalizedPath: string, policy: ExternalSourceAccessPolicy): boolean {
  if (isDefaultDeniedPath(normalizedPath)) {
    return false;
  }

  if (matchesAnyGlob(normalizedPath, policy.deniedReadGlobs)) {
    return false;
  }

  if (policy.allowedReadGlobs.length === 0) {
    return extname(normalizedPath).toLowerCase() === ".md";
  }

  return matchesAnyGlob(normalizedPath, policy.allowedReadGlobs);
}

function isDefaultDeniedPath(normalizedPath: string): boolean {
  return normalizedPath === ".obsidian" || normalizedPath.startsWith(".obsidian/");
}

function matchesAnyGlob(normalizedPath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesGlob(normalizedPath, pattern));
}

function matchesGlob(normalizedPath: string, pattern: string): boolean {
  const normalizedPattern = pattern.replaceAll("\\", "/").replace(/^\.\//, "");

  if (normalizedPattern === "**" || normalizedPattern === "**/*") {
    return normalizedPath.length > 0;
  }

  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  }

  return globToRegExp(normalizedPattern).test(normalizedPath);
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const nextChar = pattern[index + 1];

    if (char === "*" && nextChar === "*") {
      const afterGlobStar = pattern[index + 2];
      if (afterGlobStar === "/") {
        source += "(?:.*\/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    source += escapeRegexChar(char);
  }

  return new RegExp(`${source}$`);
}

function escapeRegexChar(char: string): string {
  return /[|\\{}()[\]^$+?.]/.test(char) ? `\\${char}` : char;
}

function parseMarkdown(content: string, normalizedPath: string): ParsedMarkdown {
  const { frontmatter, body } = parseFrontmatter(content);
  return {
    frontmatter,
    title: deriveTitle(frontmatter, body, normalizedPath),
    links: extractLinks(content)
  };
}

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const normalizedContent = content.replaceAll("\r\n", "\n");
  const lines = normalizedContent.split("\n");

  if (lines[0] !== "---") {
    return { frontmatter: {}, body: content };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (closingIndex === -1) {
    return { frontmatter: {}, body: content };
  }

  const frontmatter: Record<string, string> = {};
  for (const line of lines.slice(1, closingIndex)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key.length > 0) {
      frontmatter[key] = value;
    }
  }

  return {
    frontmatter,
    body: lines.slice(closingIndex + 1).join("\n")
  };
}

function deriveTitle(frontmatter: Record<string, string>, body: string, normalizedPath: string): string {
  if (frontmatter.title?.trim()) {
    return frontmatter.title.trim();
  }

  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) {
    return heading;
  }

  return basename(normalizedPath, extname(normalizedPath));
}

function extractLinks(content: string): ExternalSourceDocumentContent["links"] {
  const wiki = [...content.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)].map((match) => match[1].trim());
  const markdown = [...content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((match) => ({
    label: match[1].trim(),
    target: match[2].trim()
  }));

  return { wiki, markdown };
}