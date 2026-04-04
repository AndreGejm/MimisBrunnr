import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir as fsMkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { spawn } from "node:child_process";

test("brain-mcp serves initialize, tools/list, get_context_packet, and validate_note over stdio MCP framing", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-mcp-"));
  const repoRoot = path.join(root, "repo");
  await fsMkdir(path.join(repoRoot, ".git"), { recursive: true });
  await fsMkdir(path.join(repoRoot, "src"), { recursive: true });
  await writeFile(
    path.join(repoRoot, "src", "foo.py"),
    'def greet(name: str) -> str:\n    return f"Hello, {name}"\n',
    "utf8"
  );
  const child = spawn(
    process.execPath,
    [path.join(process.cwd(), "apps", "brain-mcp", "dist", "main.js")],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MAB_NODE_ENV: "test",
        MAB_VAULT_ROOT: path.join(root, "vault", "canonical"),
        MAB_STAGING_ROOT: path.join(root, "vault", "staging"),
        MAB_SQLITE_PATH: path.join(root, "state", "multi-agent-brain.sqlite"),
        MAB_QDRANT_URL: "http://127.0.0.1:6333",
        MAB_QDRANT_COLLECTION: `context_brain_chunks_${randomUUID().slice(0, 8)}`,
        MAB_EMBEDDING_PROVIDER: "hash",
        MAB_REASONING_PROVIDER: "heuristic",
        MAB_DRAFTING_PROVIDER: "disabled",
        MAB_RERANKER_PROVIDER: "local",
        MAB_PROVIDER_DOCKER_OLLAMA_BASE_URL: "http://127.0.0.1:1",
        MAB_OLLAMA_BASE_URL: "http://127.0.0.1:1",
        MAB_LOG_LEVEL: "error"
      },
      stdio: ["pipe", "pipe", "pipe"]
    }
  );

  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      child.once("close", resolve);
    });
    await rm(root, { recursive: true, force: true });
  });

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
  const initializeResponse = await transport.next();
  assert.equal(initializeResponse.result.serverInfo.name, "multi-agent-brain-mcp");

  writeMcpMessage(child.stdin, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {}
  });
  const listResponse = await transport.next();
  assert.ok(listResponse.result.tools.some((tool) => tool.name === "validate_note"));
  assert.ok(listResponse.result.tools.some((tool) => tool.name === "get_context_packet"));
  assert.ok(listResponse.result.tools.some((tool) => tool.name === "execute_coding_task"));

  writeMcpMessage(child.stdin, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "get_context_packet",
      arguments: {
        intent: "architecture_recall",
        budget: {
          maxTokens: 320,
          maxSources: 2,
          maxRawExcerpts: 1,
          maxSummarySentences: 2
        },
        includeRawExcerpts: true,
        candidates: [
          {
            noteType: "architecture",
            score: 0.85,
            summary: "MCP can now assemble bounded context packets directly.",
            rawText: "MCP can now assemble bounded context packets directly from ranked candidates.",
            scope: "architecture",
            qualifiers: ["bounded retrieval"],
            tags: ["project/multi-agent-brain"],
            stalenessClass: "current",
            provenance: {
              noteId: "note-mcp-1",
              notePath: "context_brain/architecture/mcp-packets.md",
              headingPath: ["Summary"]
            }
          }
        ]
      }
    }
  });

  const packetResponse = await transport.next();
  assert.equal(packetResponse.result.isError, false);
  assert.equal(packetResponse.result.structuredContent.packet.packetType, "implementation");
  assert.equal(packetResponse.result.structuredContent.packet.evidence[0].noteId, "note-mcp-1");

  const noteId = randomUUID();
  writeMcpMessage(child.stdin, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "validate_note",
      arguments: {
        targetCorpus: "context_brain",
        notePath: "context_brain/decision/invalid-mcp-note.md",
        validationMode: "promotion",
        frontmatter: {
          noteId,
          title: "Invalid MCP Decision",
          project: "multi-agent-brain",
          type: "decision",
          status: "promoted",
          updated: currentDateIso(),
          summary: "Missing required sections.",
          tags: ["project/multi-agent-brain", "domain/orchestration", "status/promoted"],
          scope: "validation",
          corpusId: "context_brain",
          currentState: false
        },
        body: "## Context\n\nOnly one section exists."
      }
    }
  });

  const toolResponse = await transport.next();
  assert.equal(toolResponse.result.isError, false);
  assert.equal(toolResponse.result.structuredContent.valid, false);
  assert.ok(
    toolResponse.result.structuredContent.violations.some(
      (issue) => issue.field === "body.sections"
    )
  );

  writeMcpMessage(child.stdin, {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: {
      name: "execute_coding_task",
      arguments: {
        taskType: "propose_fix",
        task: "Fix the writer promotion bug.",
        context: "The bug affects writer promotion.",
        repoRoot,
        filePath: "src/foo.py"
      }
    }
  });

  const codingResponse = await transport.next();
  assert.equal(codingResponse.result.isError, false);
  assert.equal(codingResponse.result.structuredContent.status, "fail");
  assert.doesNotMatch(
    codingResponse.result.structuredContent.reason,
    /allowed_patch_root|LOCAL_EXPERT_REPO_ROOT/i
  );
});

test("brain-mcp enforces registered actor tokens when auth mode is enforced", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-mcp-auth-"));
  const child = spawn(
    process.execPath,
    [path.join(process.cwd(), "apps", "brain-mcp", "dist", "main.js")],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MAB_NODE_ENV: "test",
        MAB_VAULT_ROOT: path.join(root, "vault", "canonical"),
        MAB_STAGING_ROOT: path.join(root, "vault", "staging"),
        MAB_SQLITE_PATH: path.join(root, "state", "multi-agent-brain.sqlite"),
        MAB_QDRANT_URL: "http://127.0.0.1:6333",
        MAB_QDRANT_COLLECTION: `context_brain_chunks_${randomUUID().slice(0, 8)}`,
        MAB_EMBEDDING_PROVIDER: "hash",
        MAB_REASONING_PROVIDER: "heuristic",
        MAB_DRAFTING_PROVIDER: "disabled",
        MAB_RERANKER_PROVIDER: "local",
        MAB_PROVIDER_DOCKER_OLLAMA_BASE_URL: "http://127.0.0.1:1",
        MAB_OLLAMA_BASE_URL: "http://127.0.0.1:1",
        MAB_LOG_LEVEL: "error",
        MAB_AUTH_MODE: "enforced",
        MAB_AUTH_ACTOR_REGISTRY_JSON: JSON.stringify([
          {
            actorId: "get_context_packet-mcp",
            actorRole: "retrieval",
            authToken: "mcp-secret",
            source: "brain-mcp",
            allowedTransports: ["mcp"],
            allowedCommands: ["get_context_packet"]
          }
        ])
      },
      stdio: ["pipe", "pipe", "pipe"]
    }
  );

  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      child.once("close", resolve);
    });
    await rm(root, { recursive: true, force: true });
  });

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

  writeMcpMessage(child.stdin, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "get_context_packet",
      arguments: {
        intent: "architecture_recall",
        budget: {
          maxTokens: 320,
          maxSources: 2,
          maxRawExcerpts: 1,
          maxSummarySentences: 2
        },
        includeRawExcerpts: false,
        candidates: [
          {
            noteType: "architecture",
            score: 0.85,
            summary: "MCP auth should require a token in enforced mode.",
            scope: "architecture",
            qualifiers: ["auth required"],
            tags: ["project/multi-agent-brain"],
            stalenessClass: "current",
            provenance: {
              noteId: "note-mcp-auth-1",
              notePath: "context_brain/architecture/mcp-auth.md",
              headingPath: ["Summary"]
            }
          }
        ]
      }
    }
  });

  const unauthorized = await transport.next();
  assert.equal(unauthorized.result.isError, true);
  assert.equal(unauthorized.result.structuredContent.error.code, "unauthorized");

  writeMcpMessage(child.stdin, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "get_context_packet",
      arguments: {
        actor: {
          authToken: "mcp-secret"
        },
        intent: "architecture_recall",
        budget: {
          maxTokens: 320,
          maxSources: 2,
          maxRawExcerpts: 1,
          maxSummarySentences: 2
        },
        includeRawExcerpts: false,
        candidates: [
          {
            noteType: "architecture",
            score: 0.85,
            summary: "MCP auth should require a token in enforced mode.",
            scope: "architecture",
            qualifiers: ["auth required"],
            tags: ["project/multi-agent-brain"],
            stalenessClass: "current",
            provenance: {
              noteId: "note-mcp-auth-2",
              notePath: "context_brain/architecture/mcp-auth.md",
              headingPath: ["Summary"]
            }
          }
        ]
      }
    }
  });

  const authorized = await transport.next();
  assert.equal(authorized.result.isError, false);
  assert.equal(authorized.result.structuredContent.packet.evidence[0].noteId, "note-mcp-auth-2");
});

test("brain-mcp loads a file-backed actor registry and honors rotated credential windows", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-mcp-auth-file-"));
  const registryPath = path.join(root, "config", "actor-registry.json");
  await fsMkdir(path.dirname(registryPath), { recursive: true });
  const now = Date.now();
  await writeFile(
    registryPath,
    JSON.stringify(
      {
        actors: [
          {
            actorId: "get_context_packet-mcp",
            actorRole: "retrieval",
            authTokens: [
              {
                token: "expired-mcp-secret",
                label: "previous",
                validUntil: new Date(now - 60_000).toISOString()
              },
              {
                token: "current-mcp-secret",
                label: "current",
                validFrom: new Date(now - 60_000).toISOString(),
                validUntil: new Date(now + 3_600_000).toISOString()
              }
            ],
            source: "brain-mcp",
            allowedTransports: ["mcp"],
            allowedCommands: ["get_context_packet"]
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  const child = spawn(
    process.execPath,
    [path.join(process.cwd(), "apps", "brain-mcp", "dist", "main.js")],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MAB_NODE_ENV: "test",
        MAB_VAULT_ROOT: path.join(root, "vault", "canonical"),
        MAB_STAGING_ROOT: path.join(root, "vault", "staging"),
        MAB_SQLITE_PATH: path.join(root, "state", "multi-agent-brain.sqlite"),
        MAB_QDRANT_URL: "http://127.0.0.1:6333",
        MAB_QDRANT_COLLECTION: `context_brain_chunks_${randomUUID().slice(0, 8)}`,
        MAB_EMBEDDING_PROVIDER: "hash",
        MAB_REASONING_PROVIDER: "heuristic",
        MAB_DRAFTING_PROVIDER: "disabled",
        MAB_RERANKER_PROVIDER: "local",
        MAB_PROVIDER_DOCKER_OLLAMA_BASE_URL: "http://127.0.0.1:1",
        MAB_OLLAMA_BASE_URL: "http://127.0.0.1:1",
        MAB_LOG_LEVEL: "error",
        MAB_AUTH_MODE: "enforced",
        MAB_AUTH_ACTOR_REGISTRY_PATH: registryPath
      },
      stdio: ["pipe", "pipe", "pipe"]
    }
  );

  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      child.once("close", resolve);
    });
    await rm(root, { recursive: true, force: true });
  });

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

  writeMcpMessage(child.stdin, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "get_context_packet",
      arguments: {
        actor: {
          authToken: "expired-mcp-secret"
        },
        intent: "architecture_recall",
        budget: {
          maxTokens: 320,
          maxSources: 2,
          maxRawExcerpts: 1,
          maxSummarySentences: 2
        },
        includeRawExcerpts: false,
        candidates: [
          {
            noteType: "architecture",
            score: 0.85,
            summary: "MCP file-backed auth should reject expired credentials.",
            scope: "architecture",
            qualifiers: ["auth required"],
            tags: ["project/multi-agent-brain"],
            stalenessClass: "current",
            provenance: {
              noteId: "note-mcp-auth-file-expired",
              notePath: "context_brain/architecture/mcp-auth-file.md",
              headingPath: ["Summary"]
            }
          }
        ]
      }
    }
  });

  const expired = await transport.next();
  assert.equal(expired.result.isError, true);
  assert.equal(expired.result.structuredContent.error.code, "unauthorized");
  assert.match(expired.result.structuredContent.error.message, /expired|inactive/i);

  writeMcpMessage(child.stdin, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "get_context_packet",
      arguments: {
        actor: {
          authToken: "current-mcp-secret"
        },
        intent: "architecture_recall",
        budget: {
          maxTokens: 320,
          maxSources: 2,
          maxRawExcerpts: 1,
          maxSummarySentences: 2
        },
        includeRawExcerpts: false,
        candidates: [
          {
            noteType: "architecture",
            score: 0.85,
            summary: "MCP file-backed auth should accept active credentials.",
            scope: "architecture",
            qualifiers: ["auth required"],
            tags: ["project/multi-agent-brain"],
            stalenessClass: "current",
            provenance: {
              noteId: "note-mcp-auth-file-current",
              notePath: "context_brain/architecture/mcp-auth-file.md",
              headingPath: ["Summary"]
            }
          }
        ]
      }
    }
  });

  const current = await transport.next();
  assert.equal(current.result.isError, false);
  assert.equal(
    current.result.structuredContent.packet.evidence[0].noteId,
    "note-mcp-auth-file-current"
  );
});

test("brain-mcp rejects malformed tool arguments at ingress", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-mcp-invalid-"));
  const child = spawn(
    process.execPath,
    [path.join(process.cwd(), "apps", "brain-mcp", "dist", "main.js")],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MAB_NODE_ENV: "test",
        MAB_VAULT_ROOT: path.join(root, "vault", "canonical"),
        MAB_STAGING_ROOT: path.join(root, "vault", "staging"),
        MAB_SQLITE_PATH: path.join(root, "state", "multi-agent-brain.sqlite"),
        MAB_QDRANT_URL: "http://127.0.0.1:6333",
        MAB_QDRANT_COLLECTION: `context_brain_chunks_${randomUUID().slice(0, 8)}`,
        MAB_EMBEDDING_PROVIDER: "hash",
        MAB_REASONING_PROVIDER: "heuristic",
        MAB_DRAFTING_PROVIDER: "disabled",
        MAB_RERANKER_PROVIDER: "local",
        MAB_PROVIDER_DOCKER_OLLAMA_BASE_URL: "http://127.0.0.1:1",
        MAB_OLLAMA_BASE_URL: "http://127.0.0.1:1",
        MAB_LOG_LEVEL: "error"
      },
      stdio: ["pipe", "pipe", "pipe"]
    }
  );

  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      child.once("close", resolve);
    });
    await rm(root, { recursive: true, force: true });
  });

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

  writeMcpMessage(child.stdin, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "get_context_packet",
      arguments: {
        intent: "architecture_recall",
        budget: {
          maxTokens: "320",
          maxSources: 2,
          maxRawExcerpts: 1,
          maxSummarySentences: 2
        },
        includeRawExcerpts: false,
        candidates: []
      }
    }
  });

  const invalid = await transport.next();
  assert.equal(invalid.result.isError, true);
  assert.equal(invalid.result.structuredContent.error.code, "validation_failed");
});

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

function currentDateIso() {
  return new Date().toISOString().slice(0, 10);
}
