import assert from "node:assert/strict";
import test from "node:test";
import { validateTransportRequest } from "../../packages/infrastructure/dist/index.js";
import {
  validateExecuteCodingTaskRequest,
  validateListAgentTracesRequest,
  validateShowToolOutputRequest
} from "../../packages/infrastructure/dist/transport/coding-request-validation.js";

const normalizedActor = {
  actorId: "operator-1",
  actorRole: "operator",
  source: undefined,
  requestId: undefined,
  initiatedAt: undefined,
  toolName: undefined,
  authToken: undefined
};

test("coding command validators preserve coding transport payload semantics", () => {
  const commandPayload = {
    taskType: "triage",
    task: "  inspect this  ",
    context: "  keep context  ",
    memoryContext: {
      query: "  recall this  ",
      corpusIds: ["brain"],
      budget: {
        maxTokens: 120,
        maxSources: 2,
        maxRawExcerpts: 1,
        maxSummarySentences: 3
      },
      includeSessionArchives: true,
      sessionId: "session-1",
      includeTrace: true
    },
    repoRoot: "F:/repo",
    filePath: "src/main.ts",
    symbolName: "run",
    diffText: "diff --git a/a b/a",
    pytestTarget: "tests/unit",
    lintTarget: "src"
  };
  const expected = {
    actor: normalizedActor,
    taskType: "triage",
    task: "  inspect this  ",
    context: "  keep context  ",
    memoryContext: {
      query: "  recall this  ",
      corpusIds: ["mimisbrunnr"],
      budget: {
        maxTokens: 120,
        maxSources: 2,
        maxRawExcerpts: 1,
        maxSummarySentences: 3
      },
      includeSessionArchives: true,
      sessionId: "session-1",
      includeTrace: true
    },
    repoRoot: "F:/repo",
    filePath: "src/main.ts",
    symbolName: "run",
    diffText: "diff --git a/a b/a",
    pytestTarget: "tests/unit",
    lintTarget: "src"
  };

  assert.deepEqual(validateExecuteCodingTaskRequest(commandPayload, normalizedActor), expected);
  assert.deepEqual(
    validateTransportRequest("execute-coding-task", {
      ...commandPayload,
      actor: { actorId: "operator-1", actorRole: "operator" }
    }),
    expected
  );
});

test("coding diagnostic validators preserve direct request shapes", () => {
  assert.deepEqual(validateListAgentTracesRequest({ requestId: "req-1" }, normalizedActor), {
    actor: normalizedActor,
    requestId: "req-1"
  });
  assert.deepEqual(validateShowToolOutputRequest({ outputId: "out-1" }, normalizedActor), {
    actor: normalizedActor,
    outputId: "out-1"
  });
});