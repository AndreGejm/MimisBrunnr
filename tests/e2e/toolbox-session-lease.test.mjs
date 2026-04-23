import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir as fsMkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { spawn } from "node:child_process";
import {
  issueToolboxSessionLease,
  SqliteToolboxSessionLeaseStore,
  ToolboxSessionPolicyEnforcer,
  compileToolboxPolicyFromDirectory,
  verifyToolboxSessionLease
} from "../../packages/infrastructure/dist/index.js";

function writeMcpMessage(stream, message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
  stream.write(Buffer.concat([header, body]));
}

function createMessageCollector(stream) {
  let buffer = Buffer.alloc(0);
  const queue = [];
  const waiters = [];

  stream.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);

    while (true) {
      const separator = buffer.indexOf("\r\n\r\n");
      if (separator === -1) {
        break;
      }

      const header = buffer.subarray(0, separator).toString("utf8");
      const match = header.match(/^Content-Length:\s*(\d+)$/im);
      if (!match) {
        throw new Error("Missing Content-Length header in MCP response.");
      }

      const contentLength = Number.parseInt(match[1], 10);
      const totalLength = separator + 4 + contentLength;
      if (buffer.length < totalLength) {
        break;
      }

      const payload = JSON.parse(
        buffer.subarray(separator + 4, totalLength).toString("utf8")
      );
      buffer = buffer.subarray(totalLength);

      if (waiters.length > 0) {
        const waiter = waiters.shift();
        waiter(payload);
      } else {
        queue.push(payload);
      }
    }
  });

  return {
    next() {
      if (queue.length > 0) {
        return Promise.resolve(queue.shift());
      }

      return new Promise((resolve) => {
        waiters.push(resolve);
      });
    }
  };
}

async function startToolboxScopedMcp(root, {
  activeProfile = "docs-research",
  clientId = "claude",
  sessionPolicyToken
} = {}) {
  const child = spawn(
    process.execPath,
    [path.join(process.cwd(), "apps", "mimir-mcp", "dist", "main.js")],
    {
      cwd: process.cwd(),
      env: {
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
        MAB_PROVIDER_DOCKER_OLLAMA_BASE_URL: "http://127.0.0.1:1",
        MAB_OLLAMA_BASE_URL: "http://127.0.0.1:1",
        MAB_LOG_LEVEL: "error",
        MAB_TOOLBOX_MANIFEST_DIR: path.join(process.cwd(), "docker", "mcp"),
        MAB_TOOLBOX_ACTIVE_PROFILE: activeProfile,
        MAB_TOOLBOX_CLIENT_ID: clientId,
        MAB_TOOLBOX_SESSION_ENFORCEMENT: "enforced",
        MAB_TOOLBOX_LEASE_ISSUER: "mimir-control",
        MAB_TOOLBOX_LEASE_AUDIENCE: "mimir-core",
        MAB_TOOLBOX_LEASE_ISSUER_SECRET: "toolbox-secret",
        ...(sessionPolicyToken
          ? { MAB_TOOLBOX_SESSION_POLICY_TOKEN: sessionPolicyToken }
          : {})
      },
      stdio: ["pipe", "pipe", "pipe"]
    }
  );

  const transport = createMessageCollector(child.stdout);
  writeMcpMessage(child.stdin, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {}
    }
  });
  await transport.next();
  return { child, transport };
}

function buildLease({
  policy,
  profileId = "docs-research",
  clientId = "claude",
  trustClass = "external-read",
  audience = "mimir-core",
  manifestRevision = policy.manifestRevision,
  profileRevision = policy.profiles[profileId].profileRevision
}) {
  const profile = policy.profiles[profileId];
  const issuedAt = new Date().toISOString();
  return issueToolboxSessionLease(
    {
      version: 1,
      sessionId: `session-${randomUUID()}`,
      issuer: "mimir-control",
      audience,
      clientId,
      approvedProfile: profileId,
      approvedCategories: profile.allowedCategories,
      deniedCategories: profile.deniedCategories,
      trustClass,
      manifestRevision,
      profileRevision,
      issuedAt,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      nonce: randomUUID()
    },
    "toolbox-secret"
  );
}

test("toolbox-scoped MCP rejects missing or invalid session leases and accepts valid scoped reads", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-toolbox-lease-"));
  await Promise.all([
    fsMkdir(path.join(root, "vault", "canonical"), { recursive: true }),
    fsMkdir(path.join(root, "vault", "staging"), { recursive: true }),
    fsMkdir(path.join(root, "state"), { recursive: true })
  ]);
  await writeFile(path.join(root, "state", "mimisbrunnr.sqlite"), "");

  const { child, transport } = await startToolboxScopedMcp(root);
  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("close", resolve));
    await rm(root, { recursive: true, force: true });
  });

  const policy = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));
  const validLease = buildLease({ policy });
  const wrongAudienceLease = buildLease({ policy, audience: "wrong-audience" });
  const wrongRevisionLease = buildLease({
    policy,
    manifestRevision: "stale-manifest-revision"
  });

  writeMcpMessage(child.stdin, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "get_context_packet",
      arguments: {
        actor: {
          toolboxSessionMode: "toolbox-activated",
          toolboxClientId: "claude",
          toolboxProfileId: "docs-research"
        },
        intent: "architecture_recall",
        budget: {
          maxTokens: 320,
          maxSources: 2,
          maxRawExcerpts: 1,
          maxSummarySentences: 2
        },
        includeRawExcerpts: false,
        candidates: []
      }
    }
  });
  const missingLease = await transport.next();
  assert.equal(missingLease.result.isError, true);

  for (const [id, token] of [
    [3, wrongAudienceLease],
    [4, wrongRevisionLease],
    [5, validLease]
  ]) {
    writeMcpMessage(child.stdin, {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name: "get_context_packet",
        arguments: {
          actor: {
            sessionPolicyToken: token,
            toolboxSessionMode: "toolbox-activated",
            toolboxClientId: "claude",
            toolboxProfileId: "docs-research"
          },
          intent: "architecture_recall",
          budget: {
            maxTokens: 320,
            maxSources: 2,
            maxRawExcerpts: 1,
            maxSummarySentences: 2
          },
          includeRawExcerpts: false,
          candidates: []
        }
      }
    });
  }

  const wrongAudience = await transport.next();
  const wrongRevision = await transport.next();
  const validRead = await transport.next();

  assert.equal(wrongAudience.result.isError, true);
  assert.equal(wrongRevision.result.isError, true);
  assert.equal(validRead.result.isError, false);
});

test("toolbox-scoped MCP rejects category violations and revoked session leases", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-toolbox-lease-revoke-"));
  await Promise.all([
    fsMkdir(path.join(root, "vault", "canonical"), { recursive: true }),
    fsMkdir(path.join(root, "vault", "staging"), { recursive: true }),
    fsMkdir(path.join(root, "state"), { recursive: true })
  ]);
  await writeFile(path.join(root, "state", "mimisbrunnr.sqlite"), "");

  const { child, transport } = await startToolboxScopedMcp(root);
  const policy = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));
  const validLease = buildLease({ policy });
  const leaseStore = new SqliteToolboxSessionLeaseStore(path.join(root, "state", "mimisbrunnr.sqlite"));
  const revokedLease = buildLease({ policy });
  leaseStore.revokeLeaseId(verifyToolboxSessionLease(revokedLease, "toolbox-secret").leaseId);

  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("close", resolve));
    leaseStore.close();
    await rm(root, { recursive: true, force: true });
  });

  writeMcpMessage(child.stdin, {
    jsonrpc: "2.0",
    id: 10,
    method: "tools/call",
    params: {
      name: "draft_note",
      arguments: {
        actor: {
          sessionPolicyToken: validLease,
          toolboxSessionMode: "toolbox-activated",
          toolboxClientId: "claude",
          toolboxProfileId: "docs-research"
        },
        targetCorpus: "general_notes",
        noteType: "reference",
        title: "Denied Draft",
        sourcePrompt: "Denied draft",
        supportingSources: []
      }
    }
  });

  const categoryViolation = await transport.next();
  assert.equal(categoryViolation.result.isError, true);

  writeMcpMessage(child.stdin, {
    jsonrpc: "2.0",
    id: 11,
    method: "tools/call",
    params: {
      name: "get_context_packet",
      arguments: {
        actor: {
          sessionPolicyToken: revokedLease,
          toolboxSessionMode: "toolbox-activated",
          toolboxClientId: "claude",
          toolboxProfileId: "docs-research"
        },
        intent: "architecture_recall",
        budget: {
          maxTokens: 320,
          maxSources: 2,
          maxRawExcerpts: 1,
          maxSummarySentences: 2
        },
        includeRawExcerpts: false,
        candidates: []
      }
    }
  });

  const revokedLeaseResult = await transport.next();
  assert.equal(revokedLeaseResult.result.isError, true);
});

test("toolbox-scoped MCP accepts a lease from the session-policy env default when actor omits it", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-toolbox-lease-env-"));
  await Promise.all([
    fsMkdir(path.join(root, "vault", "canonical"), { recursive: true }),
    fsMkdir(path.join(root, "vault", "staging"), { recursive: true }),
    fsMkdir(path.join(root, "state"), { recursive: true })
  ]);
  await writeFile(path.join(root, "state", "mimisbrunnr.sqlite"), "");

  const policy = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));
  const validLease = buildLease({ policy });
  const { child, transport } = await startToolboxScopedMcp(root, {
    sessionPolicyToken: validLease
  });

  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("close", resolve));
    await rm(root, { recursive: true, force: true });
  });

  writeMcpMessage(child.stdin, {
    jsonrpc: "2.0",
    id: 20,
    method: "tools/call",
    params: {
      name: "get_context_packet",
      arguments: {
        actor: {
          toolboxSessionMode: "toolbox-activated",
          toolboxClientId: "claude",
          toolboxProfileId: "docs-research"
        },
        intent: "architecture_recall",
        budget: {
          maxTokens: 320,
          maxSources: 2,
          maxRawExcerpts: 1,
          maxSummarySentences: 2
        },
        includeRawExcerpts: false,
        candidates: []
      }
    }
  });

  const validRead = await transport.next();
  assert.equal(validRead.result.isError, false);
});

test("toolbox session enforcer rejects leases whose approved or denied categories drift from the active profile", () => {
  const policy = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));
  const enforcer = new ToolboxSessionPolicyEnforcer({
    policy,
    activeProfileId: "docs-research",
    clientId: "claude",
    enforcementMode: "enforced",
    issuer: "mimir-control",
    audience: "mimir-core",
    issuerSecret: "toolbox-secret"
  });

  const approvedCategoryMismatch = issueToolboxSessionLease(
    {
      version: 1,
      sessionId: `session-${randomUUID()}`,
      issuer: "mimir-control",
      audience: "mimir-core",
      clientId: "claude",
      approvedProfile: "docs-research",
      approvedCategories: [...policy.profiles["docs-research"].allowedCategories, "internal-memory-write"],
      deniedCategories: policy.profiles["docs-research"].deniedCategories,
      trustClass: "external-read",
      manifestRevision: policy.manifestRevision,
      profileRevision: policy.profiles["docs-research"].profileRevision,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      nonce: randomUUID()
    },
    "toolbox-secret"
  );

  assert.throws(
    () =>
      enforcer.authorize("get-context-packet", {
        sessionPolicyToken: approvedCategoryMismatch,
        toolboxSessionMode: "toolbox-activated",
        toolboxClientId: "claude",
        toolboxProfileId: "docs-research"
      }),
    (error) => {
      assert.match(error.message, /approved categories/i);
      return true;
    }
  );

  const deniedCategoryMismatch = issueToolboxSessionLease(
    {
      version: 1,
      sessionId: `session-${randomUUID()}`,
      issuer: "mimir-control",
      audience: "mimir-core",
      clientId: "claude",
      approvedProfile: "docs-research",
      approvedCategories: policy.profiles["docs-research"].allowedCategories,
      deniedCategories: [],
      trustClass: "external-read",
      manifestRevision: policy.manifestRevision,
      profileRevision: policy.profiles["docs-research"].profileRevision,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      nonce: randomUUID()
    },
    "toolbox-secret"
  );

  assert.throws(
    () =>
      enforcer.authorize("get-context-packet", {
        sessionPolicyToken: deniedCategoryMismatch,
        toolboxSessionMode: "toolbox-activated",
        toolboxClientId: "claude",
        toolboxProfileId: "docs-research"
      }),
    (error) => {
      assert.match(error.message, /denied categories/i);
      return true;
    }
  );
});

test("toolbox session enforcer rejects commands when approved category mutation is weaker than the command policy", () => {
  const policy = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));
  const weakenedPolicy = structuredClone(policy);
  weakenedPolicy.categories["internal-memory-write"].mutationLevel = "read";

  const lease = buildLease({
    policy: weakenedPolicy,
    profileId: "core-dev",
    clientId: "codex",
    trustClass: "local-readwrite"
  });

  const enforcer = new ToolboxSessionPolicyEnforcer({
    policy: weakenedPolicy,
    activeProfileId: "core-dev",
    clientId: "codex",
    enforcementMode: "enforced",
    issuer: "mimir-control",
    audience: "mimir-core",
    issuerSecret: "toolbox-secret"
  });

  assert.throws(
    () =>
      enforcer.authorize("draft-note", {
        sessionPolicyToken: lease,
        toolboxSessionMode: "toolbox-activated",
        toolboxClientId: "codex",
        toolboxProfileId: "core-dev"
      }),
    (error) => {
      assert.match(error.message, /mutation/i);
      return true;
    }
  );
});
