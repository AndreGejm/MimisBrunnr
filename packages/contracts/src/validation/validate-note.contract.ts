import type {
  CorpusId,
  NoteFrontmatter
} from "@mimir/domain";
import type { ActorContext } from "../common/actor-context.js";

export interface NoteValidationIssue {
  field: string;
  message: string;
  severity: "error" | "warning";
}

export interface ValidateNoteRequest {
  actor: ActorContext;
  targetCorpus: CorpusId;
  notePath: string;
  frontmatter: NoteFrontmatter;
  body: string;
  validationMode: "draft" | "promotion";
}

export interface ValidateNoteResponse {
  valid: boolean;
  normalizedFrontmatter?: NoteFrontmatter;
  violations: NoteValidationIssue[];
  blockedFromPromotion: boolean;
}
