import type {
  CorpusId,
  NoteFrontmatter,
  NoteId,
  NoteLifecycleState
} from "@mimir/domain";

export interface StagingDraftRecord {
  noteId: NoteId;
  corpusId: CorpusId;
  draftPath: string;
  revision: string;
  lifecycleState: NoteLifecycleState;
  frontmatter: NoteFrontmatter;
  body: string;
}

export interface StagingNoteRepository {
  createDraft(note: StagingDraftRecord): Promise<StagingDraftRecord>;
  updateDraft(note: StagingDraftRecord): Promise<StagingDraftRecord>;
  getById(noteId: NoteId): Promise<StagingDraftRecord | null>;
  getByPath(draftPath: string): Promise<StagingDraftRecord | null>;
  listByCorpus(corpusId: CorpusId): Promise<StagingDraftRecord[]>;
}
