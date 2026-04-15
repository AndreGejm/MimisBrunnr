import type { DraftNoteRequest, DraftNoteResponse } from "@mimir/contracts";

export interface DraftingProvider {
  readonly providerId: string;
  draftStructuredNote(request: DraftNoteRequest): Promise<DraftNoteResponse>;
}
