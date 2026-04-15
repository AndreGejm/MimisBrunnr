import type { CorpusId, NoteFrontmatter, NoteId } from "@mimir/domain";

export interface CanonicalNoteRecord {
  noteId: NoteId;
  corpusId: CorpusId;
  notePath: string;
  revision: string;
  frontmatter: NoteFrontmatter;
  body: string;
}

export interface CanonicalNoteRepository {
  getById(noteId: NoteId): Promise<CanonicalNoteRecord | null>;
  getByPath(notePath: string): Promise<CanonicalNoteRecord | null>;
  listByCorpus(corpusId: CorpusId): Promise<CanonicalNoteRecord[]>;
  writeCanonicalNote(note: CanonicalNoteRecord): Promise<CanonicalNoteRecord>;
  exists(notePath: string): Promise<boolean>;
}
