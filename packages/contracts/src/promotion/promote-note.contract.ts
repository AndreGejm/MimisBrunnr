import type { CorpusId, NoteId } from "@multi-agent-brain/domain";
import type { ActorContext } from "../common/actor-context.js";

export interface PromoteNoteRequest {
  actor: ActorContext;
  draftNoteId: NoteId;
  targetCorpus: CorpusId;
  expectedDraftRevision?: string;
  targetPath?: string;
  promoteAsCurrentState: boolean;
}

export interface PromoteNoteResponse {
  promotedNoteId: NoteId;
  canonicalPath: string;
  supersededNoteIds: NoteId[];
  chunkCount: number;
  auditEntryId: string;
}
