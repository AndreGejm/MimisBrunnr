export const CONTEXT_AUTHORITY_STATES = [
  "canonical",
  "staging",
  "derived",
  "imported",
  "session",
  "extracted"
] as const;

export type ContextAuthorityState = (typeof CONTEXT_AUTHORITY_STATES)[number];

export function createContextAuthorityStateSet(): Set<ContextAuthorityState> {
  return new Set(CONTEXT_AUTHORITY_STATES);
}
