import type {
  ContextPromotionStatus,
  ContextSourceType,
  ContextSupersessionStatus
} from "./context-node.js";
import type { ContextNode } from "./context-node.js";
import type { ContextAuthorityState } from "./context-authority-state.js";

type ContextAuthorityInvariantInput = Pick<
  ContextNode,
  "authorityState" | "sourceType" | "promotionStatus" | "supersessionStatus"
>;

const SOURCE_TYPES_BY_AUTHORITY_STATE: Record<ContextAuthorityState, ContextSourceType> = {
  canonical: "canonical_note",
  staging: "staging_draft",
  derived: "derived_projection",
  imported: "import_artifact",
  session: "session_archive",
  extracted: "external_reference"
};

const PROMOTION_STATUSES_BY_AUTHORITY_STATE: Record<
  ContextAuthorityState,
  readonly ContextPromotionStatus[]
> = {
  canonical: ["promoted"],
  staging: ["pending_review", "promotable", "rejected"],
  derived: ["not_applicable"],
  imported: ["not_applicable"],
  session: ["not_applicable"],
  extracted: ["not_applicable", "pending_review", "promotable", "rejected"]
};

const SUPERSESSION_STATUSES_BY_AUTHORITY_STATE: Record<
  ContextAuthorityState,
  readonly ContextSupersessionStatus[]
> = {
  canonical: ["active", "superseded", "snapshot", "archived"],
  staging: ["not_applicable"],
  derived: ["not_applicable", "active", "superseded", "snapshot", "archived"],
  imported: ["not_applicable", "snapshot", "archived"],
  session: ["not_applicable", "snapshot", "archived"],
  extracted: ["not_applicable", "snapshot", "archived"]
};

export function assertContextNodeAuthorityInvariants(
  descriptor: ContextAuthorityInvariantInput
): void {
  const expectedSourceType = SOURCE_TYPES_BY_AUTHORITY_STATE[descriptor.authorityState];
  if (descriptor.sourceType !== expectedSourceType) {
    throw new TypeError(
      `ContextNodeDescriptor authorityState/sourceType invariant violated: ` +
        `authorityState='${descriptor.authorityState}' requires sourceType='${expectedSourceType}', ` +
        `got '${descriptor.sourceType}'.`
    );
  }

  const allowedPromotionStatuses =
    PROMOTION_STATUSES_BY_AUTHORITY_STATE[descriptor.authorityState];
  if (!allowedPromotionStatuses.includes(descriptor.promotionStatus)) {
    throw new TypeError(
      `ContextNodeDescriptor authorityState/promotionStatus invariant violated: ` +
        `authorityState='${descriptor.authorityState}' allows promotionStatus ` +
        `[${allowedPromotionStatuses.join(", ")}], got '${descriptor.promotionStatus}'.`
    );
  }

  const allowedSupersessionStatuses =
    SUPERSESSION_STATUSES_BY_AUTHORITY_STATE[descriptor.authorityState];
  if (!allowedSupersessionStatuses.includes(descriptor.supersessionStatus)) {
    throw new TypeError(
      `ContextNodeDescriptor authorityState/supersessionStatus invariant violated: ` +
        `authorityState='${descriptor.authorityState}' allows supersessionStatus ` +
        `[${allowedSupersessionStatuses.join(", ")}], got '${descriptor.supersessionStatus}'.`
    );
  }
}
