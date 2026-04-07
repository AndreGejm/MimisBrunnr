import type { ContextAuthorityState } from "./context-authority-state.js";
import type { ContextKind } from "./context-kind.js";
import type { ContextOwnerScope } from "./context-owner-scope.js";
import type { ContextRepresentationLayer } from "./context-representation-layer.js";

export const CONTEXT_SOURCE_TYPES = [
  "canonical_note",
  "staging_draft",
  "import_artifact",
  "session_archive",
  "derived_projection",
  "external_reference"
] as const;

export type ContextSourceType = (typeof CONTEXT_SOURCE_TYPES)[number];

export const CONTEXT_FRESHNESS_CLASSES = [
  "current",
  "stale",
  "expired",
  "future_dated",
  "expiring_soon",
  "superseded"
] as const;

export type ContextFreshnessClass = (typeof CONTEXT_FRESHNESS_CLASSES)[number];

export interface ContextFreshness {
  validFrom: string;
  validUntil: string;
  freshnessClass: ContextFreshnessClass;
  freshnessReason: string;
}

export const CONTEXT_PROMOTION_STATUSES = [
  "not_applicable",
  "pending_review",
  "promotable",
  "promoted",
  "rejected"
] as const;

export type ContextPromotionStatus = (typeof CONTEXT_PROMOTION_STATUSES)[number];

export const CONTEXT_SUPERSESSION_STATUSES = [
  "active",
  "superseded",
  "snapshot",
  "archived",
  "not_applicable"
] as const;

export type ContextSupersessionStatus =
  (typeof CONTEXT_SUPERSESSION_STATUSES)[number];

export type ContextRepresentationAvailability = Record<
  ContextRepresentationLayer,
  boolean
>;

export interface ContextNode {
  uri: string;
  ownerScope: ContextOwnerScope;
  contextKind: ContextKind;
  authorityState: ContextAuthorityState;
  sourceType: ContextSourceType;
  sourceRef: string;
  freshness: ContextFreshness;
  representationAvailability: ContextRepresentationAvailability;
  promotionStatus: ContextPromotionStatus;
  supersessionStatus: ContextSupersessionStatus;
  createdAt: string;
  updatedAt: string;
}
