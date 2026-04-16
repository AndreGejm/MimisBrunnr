import assert from "node:assert/strict";
import test from "node:test";
import {
  optionalString,
  requireEnum,
  requireEnumArray,
  requireInteger,
  requireObject,
  requireString
} from "../../packages/infrastructure/dist/transport/request-field-validation.js";
import { TransportValidationError } from "../../packages/infrastructure/dist/transport/transport-validation-error.js";

const corpora = new Set(["mimisbrunnr", "general_notes"]);
const corpusAliases = new Map([["brain", "mimisbrunnr"]]);

test("request field validators preserve current transport payload semantics", () => {
  assert.equal(requireString("  keep spacing  ", "query"), "  keep spacing  ");
  assert.equal(optionalString(undefined, "query"), undefined);
  assert.deepEqual(requireObject({ a: 1 }, "payload"), { a: 1 });
  assert.equal(requireInteger(3, "limit", { min: 1 }), 3);
  assert.equal(requireEnum(" brain ", "corpusId", corpora, { aliases: corpusAliases }), "mimisbrunnr");
  assert.deepEqual(
    requireEnumArray(["brain"], "corpusIds", corpora, {
      aliases: corpusAliases,
      minItems: 1
    }),
    ["mimisbrunnr"]
  );
});

test("request field validators keep request validation error shape", () => {
  const error = captureTransportValidationError(() => requireInteger(0, "limit", { min: 1 }));

  assert.deepEqual(error.toServiceError(), {
    code: "validation_failed",
    message: "Invalid request field 'limit': must be greater than or equal to 1.",
    details: { field: "limit", problem: "must be greater than or equal to 1" }
  });
});

function captureTransportValidationError(fn) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof TransportValidationError);
    return error;
  }

  assert.fail("Expected a TransportValidationError to be thrown");
}