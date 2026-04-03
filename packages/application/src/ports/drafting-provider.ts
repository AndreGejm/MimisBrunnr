import type { DraftNoteRequest, DraftNoteResponse } from "@multi-agent-brain/contracts";

export interface DraftingProvider {
  readonly providerId: string;
  draftStructuredNote(request: DraftNoteRequest): Promise<DraftNoteResponse>;
}
