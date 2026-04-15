import type { ActorContext } from "../common/actor-context.js";
import type { ImportJob, NoteId } from "@mimir/domain";

export interface ImportResourceRequest {
  actor: ActorContext;
  sourcePath: string;
  importKind: string;
}

export interface ImportResourceResponse {
  importJob: ImportJob;
  draftNoteIds: NoteId[];
  canonicalOutputs: string[];
}
