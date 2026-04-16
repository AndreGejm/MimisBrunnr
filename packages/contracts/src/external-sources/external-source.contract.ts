export type ExternalSourceType = "obsidian_vault" | "filesystem_markdown";

export type ExternalSourceDocumentContentType = "text/markdown";

export interface ExternalSourceAccessPolicy {
  allowedReadGlobs: string[];
  deniedReadGlobs: string[];
  allowWrites: false;
  deniedWriteGlobs: string[];
}

export interface ExternalSourceRegistration {
  sourceId: string;
  sourceType: ExternalSourceType;
  displayName: string;
  rootPath: string;
  accessPolicy: ExternalSourceAccessPolicy;
}

export interface ExternalSourceDocumentRef {
  sourceId: string;
  sourceType: ExternalSourceType;
  path: string;
  title: string;
  contentType: ExternalSourceDocumentContentType;
}

export interface ExternalSourceDocumentContent extends ExternalSourceDocumentRef {
  content: string;
  frontmatter: Record<string, string>;
  links: {
    wiki: string[];
    markdown: Array<{ label: string; target: string }>;
  };
  contentHash: string;
}