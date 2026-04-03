import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CanonicalNoteRecord, CanonicalNoteRepository } from "@multi-agent-brain/application";
import type { CorpusId, NoteId } from "@multi-agent-brain/domain";
import { computeRevision, parseMarkdownNote, serializeMarkdownNote } from "./frontmatter-codec.js";
import {
  ensureParentDirectory,
  listMarkdownFiles,
  normalizeNotePath,
  toAbsoluteNotePath,
  toRelativeVaultPath
} from "./vault-paths.js";

export class FileSystemCanonicalNoteRepository implements CanonicalNoteRepository {
  constructor(private readonly rootPath: string) {}

  async getById(noteId: NoteId): Promise<CanonicalNoteRecord | null> {
    const files = await listMarkdownFiles(this.rootPath);

    for (const filePath of files) {
      const record = await this.readRecord(filePath);
      if (record?.noteId === noteId) {
        return record;
      }
    }

    return null;
  }

  async getByPath(notePath: string): Promise<CanonicalNoteRecord | null> {
    const corpusId = inferCorpusFromPath(notePath);
    const absolutePath = toAbsoluteNotePath(this.rootPath, notePath, corpusId);

    return this.readRecord(absolutePath);
  }

  async listByCorpus(corpusId: CorpusId): Promise<CanonicalNoteRecord[]> {
    const corpusRoot = path.resolve(this.rootPath, corpusId);
    const files = await listMarkdownFiles(corpusRoot);
    const records = await Promise.all(files.map((filePath) => this.readRecord(filePath)));
    return records.filter((record): record is CanonicalNoteRecord => record !== null);
  }

  async writeCanonicalNote(note: CanonicalNoteRecord): Promise<CanonicalNoteRecord> {
    const notePath = normalizeNotePath(note.notePath, note.corpusId);
    const absolutePath = toAbsoluteNotePath(this.rootPath, notePath, note.corpusId);
    const frontmatter = {
      ...note.frontmatter,
      noteId: note.noteId,
      corpusId: note.corpusId
    };
    const markdown = serializeMarkdownNote({
      frontmatter,
      body: note.body
    });

    await ensureParentDirectory(absolutePath);
    await writeFile(absolutePath, markdown, "utf8");

    return {
      noteId: note.noteId,
      corpusId: note.corpusId,
      notePath,
      revision: computeRevision(markdown),
      frontmatter,
      body: note.body
    };
  }

  async exists(notePath: string): Promise<boolean> {
    return (await this.getByPath(notePath)) !== null;
  }

  private async readRecord(filePath: string): Promise<CanonicalNoteRecord | null> {
    try {
      const markdown = await readFile(filePath, "utf8");
      const parsed = parseMarkdownNote(markdown);
      return {
        noteId: parsed.frontmatter.noteId,
        corpusId: parsed.frontmatter.corpusId,
        notePath: toRelativeVaultPath(this.rootPath, filePath),
        revision: computeRevision(markdown),
        frontmatter: parsed.frontmatter,
        body: parsed.body
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }
}

function inferCorpusFromPath(notePath: string): CorpusId {
  const normalized = notePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.startsWith("context_brain/")) {
    return "context_brain";
  }
  if (normalized.startsWith("general_notes/")) {
    return "general_notes";
  }
  throw new Error(`Unable to infer corpus from note path '${notePath}'.`);
}
