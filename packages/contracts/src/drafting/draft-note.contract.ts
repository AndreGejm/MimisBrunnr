import type {
  NoteFrontmatter,
  NoteLifecycleState,
  NoteType,
  ProvenanceRef,
  CorpusId
} from "./draft-note.imports.js";
import type { ActorContext } from "../common/actor-context.js";

export interface DraftNoteRequest {
  actor: ActorContext;
  targetCorpus: CorpusId;
  noteType: NoteType;
  title: string;
  sourcePrompt: string;
  supportingSources: ProvenanceRef[];
  frontmatterOverrides?: Partial<NoteFrontmatter>;
  bodyHints?: string[];
}

export interface DraftNoteResponse {
  draftNoteId: string;
  lifecycleState: NoteLifecycleState;
  draftPath: string;
  frontmatter: NoteFrontmatter;
  body: string;
  warnings: string[];
}
