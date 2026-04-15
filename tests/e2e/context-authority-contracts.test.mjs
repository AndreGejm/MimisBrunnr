import assert from "node:assert/strict";
import test from "node:test";
import * as domain from "../../packages/domain/dist/index.js";
import { parseContextNodeDescriptor } from "../../packages/contracts/dist/index.js";

test("context node descriptors preserve authority and freshness fields", async () => {
  assert.equal(typeof domain.createContextAuthorityStateSet, "function");
  assert.equal(typeof parseContextNodeDescriptor, "function");
  const descriptor = parseContextNodeDescriptor({
    uri: "mimir://mimisbrunnr/note/test-note",
    ownerScope: "mimisbrunnr",
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
    updatedAt: "2026-04-06T00:00:00.000Z",
    representations: [
      {
        nodeUri: "mimir://mimisbrunnr/note/test-note",
        representationLayer: "L2",
        representationUri: "mimir://mimisbrunnr/note/test-note#L2",
        available: true,
        selected: true
      }
    ]
  });

  assert.equal(descriptor.authorityState, "canonical");
  assert.equal(descriptor.freshness.freshnessClass, "current");
  assert.equal(descriptor.representations?.[0].representationLayer, "L2");
  assert.equal(descriptor.representations?.[0].selected, true);
  assert.throws(
    () =>
      parseContextNodeDescriptor({
        ...descriptor,
        representations: [
          {
            ...descriptor.representations[0],
            available: "yes"
          }
        ]
      }),
    /representation/i
  );
  assert.throws(
    () =>
      parseContextNodeDescriptor({
        ...descriptor,
        representations: {}
      }),
    /representations/i
  );
});
