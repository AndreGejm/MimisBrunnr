import type {
  CorpusId,
  NoteFrontmatter,
  NoteId,
  NoteLifecycleState
} from "@multi-agent-brain/domain";

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
  listByCorpus(corpusId: CorpusId): Promise<StagingDraftRecord[]>;
}
