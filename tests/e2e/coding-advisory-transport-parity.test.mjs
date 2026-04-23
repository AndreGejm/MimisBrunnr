import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir as fsMkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { pathToFileURL } from "node:url";

test("CLI, API, and MCP expose the same codingAdvisory payload on escalations", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-transport-coding-advisory-"));
  const repoRoot = path.join(root, "repo");
  await fsMkdir(path.join(repoRoot, ".git"), { recursive: true });
  await fsMkdir(path.join(repoRoot, "src"), { recursive: true });
  await writeFile(
    path.join(repoRoot, "src", "foo.py"),
    'def greet(name: str) -> str:\n    return f"Hello, {name}"\n',
    "utf8"
  );

  const requestId = `coding-advisory-${randomUUID()}`;
  const request = buildCodingTransportRequest(repoRoot, requestId);
  const advisory = expectedInternalTestCodingAdvisory();
  const auditAdvisory = expectedInternalTestCodingAdvisoryAuditDetail();
  let api;
  let mcpClient;
  const cliEnv = cliEnvironment(root, {
    MAB_PROVIDER_DOCKER_OLLAMA_BASE_URL: "http://127.0.0.1:1",
    MAB_OLLAMA_BASE_URL: "http://127.0.0.1:1",
    MAB_CODING_RUNTIME_PYTHON_EXECUTABLE: "definitely-missing-python-executable",
    MAB_ROLE_CODING_ADVISORY_PROVIDER: "internal_test_stub",
    MAB_ROLE_CODING_ADVISORY_MODEL: "internal-test-model",
    MAB_ROLE_CODING_ADVISORY_TIMEOUT_MS: "18000"
  });

  t.after(async () => {
    await mcpClient?.close();
    await api?.close();
    await rm(root, { recursive: true, force: true });
  });

  const cliExecute = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    ["execute-coding-task", "--json", JSON.stringify(request)],
    cliEnv,
    repoRoot
  );

  assert.equal(cliExecute.exitCode, 1, cliExecute.stderr);
  const cliPayload = JSON.parse(cliExecute.stdout);
  assert.equal(cliPayload.status, "escalate");
  assert.deepEqual(cliPayload.codingAdvisory, advisory);

  const cliTraces = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    ["list-agent-traces", "--json", JSON.stringify({ requestId })],
    cliEnv,
    repoRoot
  );
  assert.equal(cliTraces.exitCode, 0, cliTraces.stderr);
  const cliTracePayload = JSON.parse(cliTraces.stdout);
  assert.equal(cliTracePayload.traces.at(-1).advisoryInvoked, true);
  assert.equal(cliTracePayload.traces.at(-1).advisoryProviderId, "internal_test_stub");
  assert.equal(cliTracePayload.traces.at(-1).advisoryOutcomeClass, "success");
  assert.equal(cliTracePayload.traces.at(-1).advisoryRecommendedAction, "manual_followup");

  const cliHistory = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "query-history",
      "--json",
      JSON.stringify({
        actor: request.actor,
        actorId: request.actor.actorId,
        actionType: "execute_coding_task",
        limit: 10
      })
    ],
    cliEnv,
    repoRoot
  );
  assert.equal(cliHistory.exitCode, 0, cliHistory.stderr);
  const cliHistoryPayload = JSON.parse(cliHistory.stdout);
  const cliAuditEntry = cliHistoryPayload.data.entries.find(
    (entry) => entry.detail?.reason === cliPayload.reason
  );
  assert.ok(cliAuditEntry);
  assert.deepEqual(cliAuditEntry.detail.codingAdvisory, auditAdvisory);

  const { createMimirApiServer } = await import(
    pathToFileURL(path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")).href
  );
  api = createMimirApiServer({
    ...baseApiEnvironment(root),
    roleBindings: {
      coding_advisory: {
        role: "coding_advisory",
        providerId: "internal_test_stub",
        modelId: "internal-test-model",
        temperature: 0,
        timeoutMs: 18_000
      }
    },
    codingRuntimePythonExecutable: "definitely-missing-python-executable"
  });

  await api.listen();
  const baseUrl = apiBaseUrl(api);

  const apiExecuteResponse = await fetch(`${baseUrl}/v1/coding/execute`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(request)
  });
  assert.equal(apiExecuteResponse.status, 409);
  const apiPayload = await apiExecuteResponse.json();
  assert.equal(apiPayload.status, "escalate");
  assert.deepEqual(apiPayload.codingAdvisory, advisory);

  const apiTracesResponse = await fetch(`${baseUrl}/v1/coding/traces`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      actor: request.actor,
      requestId
    })
  });
  assert.equal(apiTracesResponse.status, 200);
  const apiTracePayload = await apiTracesResponse.json();
  assert.equal(apiTracePayload.traces.at(-1).advisoryInvoked, true);
  assert.equal(apiTracePayload.traces.at(-1).advisoryProviderId, "internal_test_stub");
  assert.equal(apiTracePayload.traces.at(-1).advisoryOutcomeClass, "success");
  assert.equal(apiTracePayload.traces.at(-1).advisoryRecommendedAction, "manual_followup");

  const apiHistoryResponse = await fetch(`${baseUrl}/v1/history/query`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      actor: request.actor,
      actorId: request.actor.actorId,
      actionType: "execute_coding_task",
      limit: 10
    })
  });
  assert.equal(apiHistoryResponse.status, 200);
  const apiHistoryPayload = await apiHistoryResponse.json();
  const apiAuditEntry = apiHistoryPayload.data.entries.find(
    (entry) => entry.detail?.reason === apiPayload.reason
  );
  assert.ok(apiAuditEntry);
  assert.deepEqual(apiAuditEntry.detail.codingAdvisory, auditAdvisory);

  mcpClient = await createMcpClient(
    path.join(process.cwd(), "apps", "mimir-mcp", "dist", "main.js"),
    cliEnv,
    repoRoot
  );

  const mcpExecute = await mcpClient.request("tools/call", {
    name: "execute_coding_task",
    arguments: request
  });
  assert.equal(mcpExecute.result.isError, false);
  assert.deepEqual(mcpExecute.result.structuredContent.codingAdvisory, advisory);

  const mcpTraces = await mcpClient.request("tools/call", {
    name: "list_agent_traces",
    arguments: {
      actor: request.actor,
      requestId
    }
  });
  assert.equal(mcpTraces.result.isError, false);
  assert.equal(mcpTraces.result.structuredContent.traces.at(-1).advisoryInvoked, true);
  assert.equal(
    mcpTraces.result.structuredContent.traces.at(-1).advisoryProviderId,
    "internal_test_stub"
  );
  assert.equal(mcpTraces.result.structuredContent.traces.at(-1).advisoryOutcomeClass, "success");
  assert.equal(
    mcpTraces.result.structuredContent.traces.at(-1).advisoryRecommendedAction,
    "manual_followup"
  );

  const mcpHistory = await mcpClient.request("tools/call", {
    name: "query_history",
    arguments: {
      actor: request.actor,
      actorId: request.actor.actorId,
      actionType: "execute_coding_task",
      limit: 10
    }
  });
  assert.equal(mcpHistory.result.isError, false);
  const mcpAuditEntry = mcpHistory.result.structuredContent.data.entries.find(
    (entry) => entry.detail?.reason === mcpExecute.result.structuredContent.reason
  );
  assert.ok(mcpAuditEntry);
  assert.deepEqual(mcpAuditEntry.detail.codingAdvisory, auditAdvisory);
});

test("mimir-api preserves legacy escalation responses when coding_advisory remains disabled", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-api-coding-advisory-disabled-"));
  const repoRoot = path.join(root, "repo");
  await fsMkdir(path.join(repoRoot, ".git"), { recursive: true });
  await fsMkdir(path.join(repoRoot, "src"), { recursive: true });
  await writeFile(
    path.join(repoRoot, "src", "foo.py"),
    'def greet(name: str) -> str:\n    return f"Hello, {name}"\n',
    "utf8"
  );

  const requestId = `coding-disabled-${randomUUID()}`;
  const request = buildCodingTransportRequest(repoRoot, requestId);
  const { createMimirApiServer } = await import(
    pathToFileURL(path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")).href
  );
  const api = createMimirApiServer({
    ...baseApiEnvironment(root),
    codingRuntimePythonExecutable: "definitely-missing-python-executable"
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();
  const baseUrl = apiBaseUrl(api);

  const executeResponse = await fetch(`${baseUrl}/v1/coding/execute`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(request)
  });
  assert.equal(executeResponse.status, 409);
  const payload = await executeResponse.json();
  assert.equal(payload.status, "escalate");
  assert.equal("codingAdvisory" in payload, false);

  const tracesResponse = await fetch(`${baseUrl}/v1/coding/traces`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      actor: request.actor,
      requestId
    })
  });
  assert.equal(tracesResponse.status, 200);
  const tracesPayload = await tracesResponse.json();
  assert.equal(tracesPayload.traces.at(-1).advisoryInvoked ?? false, false);
  assert.equal("advisoryOutcomeClass" in tracesPayload.traces.at(-1), false);

  const historyResponse = await fetch(`${baseUrl}/v1/history/query`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      actor: request.actor,
      actorId: request.actor.actorId,
      actionType: "execute_coding_task",
      limit: 10
    })
  });
  assert.equal(historyResponse.status, 200);
  const historyPayload = await historyResponse.json();
  const auditEntry = historyPayload.data.entries.find(
    (entry) => entry.detail?.reason === payload.reason
  );
  assert.ok(auditEntry);
  assert.equal("codingAdvisory" in auditEntry.detail, false);
});

test("mimir-api records coding advisory failure telemetry when voltagent_agent is misconfigured", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-api-coding-advisory-failure-"));
  const repoRoot = path.join(root, "repo");
  await fsMkdir(path.join(repoRoot, ".git"), { recursive: true });
  await fsMkdir(path.join(repoRoot, "src"), { recursive: true });
  await writeFile(
    path.join(repoRoot, "src", "foo.py"),
    'def greet(name: str) -> str:\n    return f"Hello, {name}"\n',
    "utf8"
  );

  const requestId = `coding-failure-${randomUUID()}`;
  const request = buildCodingTransportRequest(repoRoot, requestId);
  const { createMimirApiServer } = await import(
    pathToFileURL(path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")).href
  );

  await withProcessEnv({ OPENAI_API_KEY: undefined }, async () => {
    const api = createMimirApiServer({
      ...baseApiEnvironment(root),
      roleBindings: {
        coding_advisory: {
          role: "coding_advisory",
          providerId: "voltagent_agent",
          modelId: "openai/gpt-4.1-mini",
          temperature: 0,
          timeoutMs: 18_000
        }
      },
      codingRuntimePythonExecutable: "definitely-missing-python-executable"
    });

    t.after(async () => {
      await api.close();
      await rm(root, { recursive: true, force: true });
    });

    await api.listen();
    const baseUrl = apiBaseUrl(api);

    const executeResponse = await fetch(`${baseUrl}/v1/coding/execute`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(request)
    });
    assert.equal(executeResponse.status, 409);
    const payload = await executeResponse.json();
    assert.equal(payload.status, "escalate");
    assert.equal("codingAdvisory" in payload, false);

    const tracesResponse = await fetch(`${baseUrl}/v1/coding/traces`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        actor: request.actor,
        requestId
      })
    });
    assert.equal(tracesResponse.status, 200);
    const tracesPayload = await tracesResponse.json();
    assert.equal(tracesPayload.traces.at(-1).advisoryInvoked, true);
    assert.equal(tracesPayload.traces.at(-1).advisoryProviderId, "voltagent_agent");
    assert.equal(tracesPayload.traces.at(-1).advisoryOutcomeClass, "invalid_configuration");
    assert.equal(
      tracesPayload.traces.at(-1).advisoryErrorCode,
      "voltagent_missing_openai_api_key"
    );

    const historyResponse = await fetch(`${baseUrl}/v1/history/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        actor: request.actor,
        actorId: request.actor.actorId,
        actionType: "execute_coding_task",
        limit: 10
      })
    });
    assert.equal(historyResponse.status, 200);
    const historyPayload = await historyResponse.json();
    const auditEntry = historyPayload.data.entries.find(
      (entry) => entry.detail?.reason === payload.reason
    );
    assert.ok(auditEntry);
    assert.deepEqual(auditEntry.detail.codingAdvisory, {
      invoked: true,
      advisoryReturned: false,
      telemetry: {
        providerId: "voltagent_agent",
        modelId: "openai/gpt-4.1-mini",
        timeoutMs: 18_000,
        outcomeClass: "invalid_configuration",
        fallbackApplied: false,
        retryCount: 0,
        errorCode: "voltagent_missing_openai_api_key"
      }
    });
  });
});

function cliEnvironment(root, overrides = {}) {
  return {
    ...process.env,
    MAB_NODE_ENV: "test",
    MAB_VAULT_ROOT: path.join(root, "vault", "canonical"),
    MAB_STAGING_ROOT: path.join(root, "vault", "staging"),
    MAB_SQLITE_PATH: path.join(root, "state", "mimisbrunnr.sqlite"),
    MAB_QDRANT_URL: "http://127.0.0.1:6333",
    MAB_QDRANT_COLLECTION: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    MAB_EMBEDDING_PROVIDER: "hash",
    MAB_REASONING_PROVIDER: "heuristic",
    MAB_DRAFTING_PROVIDER: "disabled",
    MAB_RERANKER_PROVIDER: "local",
    MAB_LOG_LEVEL: "error",
    ...overrides
  };
}

function runNodeCommand(scriptPath, args, env, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

async function createMcpClient(scriptPath, env, cwd = process.cwd()) {
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"]
  });

  let stderr = "";
  let nextId = 1;
  let buffer = Buffer.alloc(0);
  const pending = new Map();
  const closed = new Promise((resolve) => {
    child.once("close", () => resolve(undefined));
  });

  const failPending = (error) => {
    for (const { reject } of pending.values()) {
      reject(error);
    }
    pending.clear();
  };

  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    while (true) {
      const separator = buffer.indexOf("\r\n\r\n");
      if (separator === -1) {
        return;
      }

      const header = buffer.subarray(0, separator).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        failPending(new Error("MCP response is missing a valid Content-Length header."));
        return;
      }

      const contentLength = Number(match[1]);
      const totalLength = separator + 4 + contentLength;
      if (buffer.length < totalLength) {
        return;
      }

      const payload = buffer.subarray(separator + 4, totalLength).toString("utf8");
      buffer = buffer.subarray(totalLength);

      const parsed = JSON.parse(payload);
      const pendingRequest = pending.get(parsed.id);
      if (pendingRequest) {
        pending.delete(parsed.id);
        pendingRequest.resolve(parsed);
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  child.once("error", (error) => {
    failPending(error);
  });

  child.once("close", (exitCode) => {
    if (pending.size === 0) {
      return;
    }

    failPending(
      new Error(
        `mimir-mcp exited before responding (exitCode=${exitCode ?? "unknown"}): ${stderr}`
      )
    );
  });

  const send = (message) => {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    child.stdin.write(Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8"));
    child.stdin.write(body);
  };

  const request = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      send({
        jsonrpc: "2.0",
        id,
        method,
        params
      });
    });

  await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: {
      name: "transport-advisory-test",
      version: "1.0.0"
    }
  });
  send({
    jsonrpc: "2.0",
    method: "notifications/initialized"
  });

  return {
    request,
    async close() {
      child.stdin.end();
      if (!child.killed) {
        child.kill();
      }
      await closed;
    }
  };
}

async function withProcessEnv(overrides, callback) {
  const previous = new Map();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function buildCodingTransportRequest(repoRoot, requestId) {
  return {
    actor: {
      actorId: "transport-operator",
      actorRole: "operator",
      source: "transport-advisory-test",
      requestId
    },
    taskType: "propose_fix",
    task: "Fix the writer promotion bug.",
    context: "The local runtime could not apply a safe patch.",
    repoRoot,
    filePath: "src/foo.py"
  };
}

function expectedInternalTestCodingAdvisory() {
  return {
    invoked: true,
    modelRole: "coding_advisory",
    providerId: "internal_test_stub",
    modelId: "internal-test-model",
    recommendedAction: "manual_followup",
    summary:
      "Internal test advisory: inspect the escalation details and continue with a targeted manual follow-up.",
    suggestedChecks: [
      "Review the local escalation reason before retrying.",
      "Narrow the target file or symbol before the next attempt."
    ],
    telemetry: {
      providerId: "internal_test_stub",
      modelId: "internal-test-model",
      timeoutMs: 18_000,
      outcomeClass: "success",
      fallbackApplied: false,
      retryCount: 0
    }
  };
}

function expectedInternalTestCodingAdvisoryAuditDetail() {
  return {
    invoked: true,
    advisoryReturned: true,
    recommendedAction: "manual_followup",
    summary:
      "Internal test advisory: inspect the escalation details and continue with a targeted manual follow-up.",
    suggestedChecks: [
      "Review the local escalation reason before retrying.",
      "Narrow the target file or symbol before the next attempt."
    ],
    telemetry: {
      providerId: "internal_test_stub",
      modelId: "internal-test-model",
      timeoutMs: 18_000,
      outcomeClass: "success",
      fallbackApplied: false,
      retryCount: 0
    }
  };
}

function baseApiEnvironment(root) {
  return {
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "mimisbrunnr.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    providerEndpoints: {
      dockerOllamaBaseUrl: "http://127.0.0.1:1"
    },
    apiHost: "127.0.0.1",
    apiPort: 0,
    logLevel: "error"
  };
}

function apiBaseUrl(api) {
  const address = api.server.address();
  assert.ok(address && typeof address === "object" && typeof address.port === "number");
  return `http://127.0.0.1:${address.port}`;
}
