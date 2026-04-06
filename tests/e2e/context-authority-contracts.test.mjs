import assert from "node:assert/strict";
import test from "node:test";
import * as domain from "../../packages/domain/dist/index.js";

test("context node descriptors preserve authority and freshness fields", async () => {
  assert.equal(typeof domain.createContextAuthorityStateSet, "function");
  const descriptor = {
    uri: "mab://context_brain/note/test-note",
    ownerScope: "context_brain",
    contextKind: "note",
    authorityState: "canonical",
    sourceType: "canonical_note",
    sourceRef: "test-note",
    freshness: {
      validFrom: "2026-04-06",
      validUntil: "2026-04-30",
      freshnessClass: "current",
      freshnessReason: "within validity window"
    },
    representationAvailability: { L0: true, L1: true, L2: true },
    promotionStatus: "promoted",
    supersessionStatus: "active",
    createdAt: "2026-04-06T00:00:00.000Z",
    updatedAt: "2026-04-06T00:00:00.000Z"
  };

  assert.equal(descriptor.authorityState, "canonical");
  assert.equal(descriptor.freshness.freshnessClass, "current");
});
