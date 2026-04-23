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
  assert.throws(
    () =>
      parseContextNodeDescriptor({
        ...descriptor,
        authorityState: "canonical",
        sourceType: "staging_draft"
      }),
    /authorityState\/sourceType invariant/i
  );
  assert.throws(
    () =>
      parseContextNodeDescriptor({
        ...descriptor,
        authorityState: "canonical",
        promotionStatus: "pending_review"
      }),
    /authorityState\/promotionStatus invariant/i
  );
  assert.throws(
    () =>
      parseContextNodeDescriptor({
        ...descriptor,
        authorityState: "staging",
        sourceType: "staging_draft",
        promotionStatus: "pending_review",
        supersessionStatus: "active"
      }),
    /authorityState\/supersessionStatus invariant/i
  );
});

test("context node descriptors reject authority-state invariants that cross source, promotion, and supersession fields", () => {
  const stagingDescriptor = {
    uri: "mimir://mimisbrunnr/note/staging-note",
    ownerScope: "mimisbrunnr",
    contextKind: "note",
    authorityState: "staging",
    sourceType: "staging_draft",
    sourceRef: "staging-note",
    freshness: {
      validFrom: "2026-04-06",
      validUntil: "2026-04-30",
      freshnessClass: "current",
      freshnessReason: "within validity window"
    },
    representationAvailability: { L0: false, L1: false, L2: true },
    promotionStatus: "pending_review",
    supersessionStatus: "not_applicable",
    createdAt: "2026-04-06T00:00:00.000Z",
    updatedAt: "2026-04-06T00:00:00.000Z"
  };

  assert.equal(
    parseContextNodeDescriptor(stagingDescriptor).authorityState,
    "staging"
  );

  assert.throws(
    () =>
      parseContextNodeDescriptor({
        ...stagingDescriptor,
        sourceType: "canonical_note"
      }),
    /authority.*source/i
  );

  assert.throws(
    () =>
      parseContextNodeDescriptor({
        ...stagingDescriptor,
        promotionStatus: "promoted"
      }),
    /authority.*promotion/i
  );

  assert.throws(
    () =>
      parseContextNodeDescriptor({
        ...stagingDescriptor,
        supersessionStatus: "active"
      }),
    /authority.*supersession/i
  );

  assert.equal(
    parseContextNodeDescriptor({
      uri: "mimir://imports/resource/import-job-1",
      ownerScope: "imports",
      contextKind: "resource",
      authorityState: "imported",
      sourceType: "import_artifact",
      sourceRef: "import-job-1",
      freshness: {
        validFrom: "2026-04-19T00:00:00.000Z",
        validUntil: "2026-04-19T00:00:00.000Z",
        freshnessClass: "current",
        freshnessReason: "Imported artifacts remain read-only until reviewed."
      },
      representationAvailability: { L0: false, L1: false, L2: true },
      promotionStatus: "not_applicable",
      supersessionStatus: "not_applicable",
      createdAt: "2026-04-19T00:00:00.000Z",
      updatedAt: "2026-04-19T00:00:00.000Z"
    }).authorityState,
    "imported"
  );

  assert.throws(
    () =>
      parseContextNodeDescriptor({
        uri: "mimir://imports/resource/import-job-1",
        ownerScope: "imports",
        contextKind: "resource",
        authorityState: "imported",
        sourceType: "import_artifact",
        sourceRef: "import-job-1",
        freshness: {
          validFrom: "2026-04-19T00:00:00.000Z",
          validUntil: "2026-04-19T00:00:00.000Z",
          freshnessClass: "current",
          freshnessReason: "Imported artifacts remain read-only until reviewed."
        },
        representationAvailability: { L0: false, L1: false, L2: true },
        promotionStatus: "not_applicable",
        supersessionStatus: "active",
        createdAt: "2026-04-19T00:00:00.000Z",
        updatedAt: "2026-04-19T00:00:00.000Z"
      }),
    /authority.*supersession/i
  );
});
