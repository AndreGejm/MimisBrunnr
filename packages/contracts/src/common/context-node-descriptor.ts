import {
  CONTEXT_AUTHORITY_STATES,
  CONTEXT_FRESHNESS_CLASSES,
  CONTEXT_KINDS,
  CONTEXT_OWNER_SCOPES,
  CONTEXT_PROMOTION_STATUSES,
  CONTEXT_SOURCE_TYPES,
  CONTEXT_SUPERSESSION_STATUSES,
  type ContextAuthorityState,
  type ContextFreshnessClass,
  type ContextKind,
  type ContextOwnerScope,
  type ContextPromotionStatus,
  type ContextSourceType,
  type ContextSupersessionStatus
} from "@mimir/domain";
import {
  parseContextRepresentationRef,
  type ContextRepresentationRef
} from "./context-representation-ref.js";

export interface ContextNodeDescriptor {
  uri: string;
  ownerScope: ContextOwnerScope;
  contextKind: ContextKind;
  authorityState: ContextAuthorityState;
  sourceType: ContextSourceType;
  sourceRef: string;
  freshness: {
    validFrom: string;
    validUntil: string;
    freshnessClass: ContextFreshnessClass;
    freshnessReason: string;
  };
  representationAvailability: Record<"L0" | "L1" | "L2", boolean>;
  promotionStatus: ContextPromotionStatus;
  supersessionStatus: ContextSupersessionStatus;
  createdAt: string;
  updatedAt: string;
  representations?: ContextRepresentationRef[];
}

export function parseContextNodeDescriptor(
  value: unknown
): ContextNodeDescriptor {
  if (!isRecord(value)) {
    throw new TypeError("ContextNodeDescriptor must be an object");
  }

  return {
    uri: expectString(value.uri, "ContextNodeDescriptor.uri"),
    ownerScope: expectOneOf(
      value.ownerScope,
      CONTEXT_OWNER_SCOPES,
      "ContextNodeDescriptor.ownerScope"
    ),
    contextKind: expectOneOf(
      value.contextKind,
      CONTEXT_KINDS,
      "ContextNodeDescriptor.contextKind"
    ),
    authorityState: expectOneOf(
      value.authorityState,
      CONTEXT_AUTHORITY_STATES,
      "ContextNodeDescriptor.authorityState"
    ),
    sourceType: expectOneOf(
      value.sourceType,
      CONTEXT_SOURCE_TYPES,
      "ContextNodeDescriptor.sourceType"
    ),
    sourceRef: expectString(value.sourceRef, "ContextNodeDescriptor.sourceRef"),
    freshness: parseFreshness(value.freshness),
    representationAvailability: parseRepresentationAvailability(
      value.representationAvailability
    ),
    promotionStatus: expectOneOf(
      value.promotionStatus,
      CONTEXT_PROMOTION_STATUSES,
      "ContextNodeDescriptor.promotionStatus"
    ),
    supersessionStatus: expectOneOf(
      value.supersessionStatus,
      CONTEXT_SUPERSESSION_STATUSES,
      "ContextNodeDescriptor.supersessionStatus"
    ),
    createdAt: expectString(value.createdAt, "ContextNodeDescriptor.createdAt"),
    updatedAt: expectString(value.updatedAt, "ContextNodeDescriptor.updatedAt"),
    representations: parseRepresentations(value.representations)
  };
}

function parseFreshness(value: unknown): ContextNodeDescriptor["freshness"] {
  if (!isRecord(value)) {
    throw new TypeError("ContextNodeDescriptor.freshness must be an object");
  }

  return {
    validFrom: expectString(value.validFrom, "ContextNodeDescriptor.freshness.validFrom"),
    validUntil: expectString(
      value.validUntil,
      "ContextNodeDescriptor.freshness.validUntil"
    ),
    freshnessClass: expectOneOf(
      value.freshnessClass,
      CONTEXT_FRESHNESS_CLASSES,
      "ContextNodeDescriptor.freshness.freshnessClass"
    ),
    freshnessReason: expectString(
      value.freshnessReason,
      "ContextNodeDescriptor.freshness.freshnessReason"
    )
  };
}

function parseRepresentationAvailability(
  value: unknown
): ContextNodeDescriptor["representationAvailability"] {
  if (!isRecord(value)) {
    throw new TypeError(
      "ContextNodeDescriptor.representationAvailability must be an object"
    );
  }

  return {
    L0: expectBoolean(
      value.L0,
      "ContextNodeDescriptor.representationAvailability.L0"
    ),
    L1: expectBoolean(
      value.L1,
      "ContextNodeDescriptor.representationAvailability.L1"
    ),
    L2: expectBoolean(
      value.L2,
      "ContextNodeDescriptor.representationAvailability.L2"
    )
  };
}

function parseRepresentations(
  value: unknown
): ContextRepresentationRef[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new TypeError("ContextNodeDescriptor.representations must be an array");
  }

  return value.map((representation) => parseContextRepresentationRef(representation));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }

  return value;
}

function expectBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean`);
  }

  return value;
}

function expectOneOf<T extends readonly string[]>(
  value: unknown,
  candidates: T,
  label: string
): T[number] {
  if (typeof value !== "string" || !candidates.includes(value)) {
    throw new TypeError(`${label} must be one of: ${candidates.join(", ")}`);
  }

  return value as T[number];
}
