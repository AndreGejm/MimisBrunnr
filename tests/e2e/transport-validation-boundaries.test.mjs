import assert from "node:assert/strict";
import test from "node:test";
import {
  TransportValidationError,
  validateIssueActorTokenControlRequest,
  validateTransportRequest
} from "../../packages/infrastructure/dist/index.js";
import { TransportValidationError as TransportValidationErrorModule } from "../../packages/infrastructure/dist/transport/transport-validation-error.js";

test("transport validation errors are owned by the shared transport error module", () => {
  assert.equal(TransportValidationError, TransportValidationErrorModule);

  const requestError = captureTransportValidationError(() =>
    validateTransportRequest("search-context", {})
  );
  assert.equal(requestError.name, "TransportValidationError");
  assert.deepEqual(requestError.toServiceError(), {
    code: "validation_failed",
    message: "Invalid request field 'query': must be a non-empty string.",
    details: { field: "query", problem: "must be a non-empty string" }
  });

  const authError = captureTransportValidationError(() =>
    validateIssueActorTokenControlRequest({ actorId: "operator-1", actorRole: "ghost" })
  );
  assert.equal(authError.name, "TransportValidationError");
  assert.deepEqual(authError.toServiceError(), {
    code: "validation_failed",
    message: "Invalid auth control field 'actorRole': must be one of retrieval, writer, orchestrator, system, operator.",
    details: {
      field: "actorRole",
      problem: "must be one of retrieval, writer, orchestrator, system, operator"
    }
  });
});



test("transport validation accepts list-ai-tools runtime descriptors explicitly", () => {
  const request = validateTransportRequest("list-ai-tools", {
    ids: ["aider"],
    includeEnvironment: true,
    includeRuntime: true
  });

  assert.deepEqual(request.ids, ["aider"]);
  assert.equal(request.includeEnvironment, true);
  assert.equal(request.includeRuntime, true);
});
test("transport validation accepts tools-package-plan requests", () => {
  const request = validateTransportRequest("tools-package-plan", {
    ids: ["aider"]
  });

  assert.deepEqual(request.ids, ["aider"]);
});

test("transport validation accepts list-review-queue filters and corpus aliases", () => {
  const request = validateTransportRequest("list-review-queue", {
    targetCorpus: "brain",
    includeRejected: true
  });

  assert.equal(request.targetCorpus, "mimisbrunnr");
  assert.equal(request.includeRejected, true);
});

test("transport validation rejects empty review draft ids", () => {
  const error = captureTransportValidationError(() =>
    validateTransportRequest("accept-note", { draftNoteId: "" })
  );

  assert.equal(error.name, "TransportValidationError");
  assert.deepEqual(error.toServiceError(), {
    code: "validation_failed",
    message: "Invalid request field 'draftNoteId': must be a non-empty string.",
    details: { field: "draftNoteId", problem: "must be a non-empty string" }
  });
});

test("transport validation rejects malformed check-ai-tools ids", () => {
  const error = captureTransportValidationError(() =>
    validateTransportRequest("check-ai-tools", { ids: ["rtk", null] })
  );

  assert.equal(error.name, "TransportValidationError");
  assert.deepEqual(error.toServiceError(), {
    code: "validation_failed",
    message: "Invalid request field 'ids[1]': must be a non-empty string.",
    details: { field: "ids[1]", problem: "must be a non-empty string" }
  });
});

function captureTransportValidationError(fn) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof TransportValidationErrorModule);
    return error;
  }

  assert.fail("Expected a TransportValidationError to be thrown");
}
