import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir as fsMkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

test("validateDockerMcpSessionStartup rejects missing required explicit session env", async () => {
  const { validateDockerMcpSessionStartup } = await importInfrastructure();

  const report = await validateDockerMcpSessionStartup(
    {
      MAB_NODE_ENV: "production"
    },
    {
      isPathMounted: () => true,
      fetchImplementation: async () => {
        throw new Error("fetch should not be called when required env is missing");
      },
      checkPythonExecutable: async () => ({
        ok: true,
        detail: "python3"
      })
    }
  );

  assert.equal(report.ok, false);
  assert.ok(
    report.checks.some(
      (check) =>
        check.name === "required_explicit_env" &&
        check.status === "fail" &&
        String(check.message).includes("MAB_VAULT_ROOT")
    )
  );
});

test("validateDockerMcpSessionStartup rejects missing storage mounts before runtime startup", async () => {
  const { validateDockerMcpSessionStartup } = await importInfrastructure();
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-mcp-session-"));

  try {
    const canonicalRoot = path.join(root, "canonical");
    const stagingRoot = path.join(root, "staging");
    const stateRoot = path.join(root, "state");
    const configRoot = path.join(root, "config");
    await Promise.all([
      fsMkdir(canonicalRoot, { recursive: true }),
      fsMkdir(stagingRoot, { recursive: true }),
      fsMkdir(stateRoot, { recursive: true }),
      fsMkdir(configRoot, { recursive: true })
    ]);
    const registryPath = path.join(configRoot, "actor-registry.json");
    await writeActorRegistry(registryPath);

    const report = await validateDockerMcpSessionStartup(
      buildStrictSessionEnv({
        canonicalRoot,
        stagingRoot,
        sqlitePath: path.join(stateRoot, "mimisbrunnr.sqlite"),
        registryPath
      }),
      {
        isPathMounted: (candidatePath) => candidatePath !== canonicalRoot,
        fetchImplementation: async () => okJsonResponse({ models: [] }),
        checkPythonExecutable: async () => ({
          ok: true,
          detail: "python3"
        })
      }
    );

    assert.equal(report.ok, false);
    assert.ok(
      report.checks.some(
        (check) =>
          check.name === "storage_mounts" &&
          check.status === "fail" &&
          String(check.message).includes(canonicalRoot)
      )
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validateDockerMcpSessionStartup requires reachable model and vector dependencies", async () => {
  const { validateDockerMcpSessionStartup } = await importInfrastructure();
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-mcp-session-deps-"));

  try {
    const canonicalRoot = path.join(root, "canonical");
    const stagingRoot = path.join(root, "staging");
    const stateRoot = path.join(root, "state");
    const configRoot = path.join(root, "config");
    await Promise.all([
      fsMkdir(canonicalRoot, { recursive: true }),
      fsMkdir(stagingRoot, { recursive: true }),
      fsMkdir(stateRoot, { recursive: true }),
      fsMkdir(configRoot, { recursive: true })
    ]);
    const registryPath = path.join(configRoot, "actor-registry.json");
    await writeActorRegistry(registryPath);

    const report = await validateDockerMcpSessionStartup(
      buildStrictSessionEnv({
        canonicalRoot,
        stagingRoot,
        sqlitePath: path.join(stateRoot, "mimisbrunnr.sqlite"),
        registryPath
      }),
      {
        isPathMounted: () => true,
        fetchImplementation: async (url) => {
          if (String(url).includes("/collections/")) {
            throw new Error("Qdrant unavailable");
          }
          throw new Error("Model endpoint unavailable");
        },
        checkPythonExecutable: async () => ({
          ok: true,
          detail: "python3"
        })
      }
    );

    assert.equal(report.ok, false);
    assert.ok(
      report.checks.some(
        (check) => check.name === "qdrant_dependency" && check.status === "fail"
      )
    );
    assert.ok(
      report.checks.some(
        (check) => check.name === "model_endpoint_dependency" && check.status === "fail"
      )
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mimir-mcp exits cleanly when the MCP client closes stdin", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-mcp-stdin-close-"));
  let stdout = "";
  let stderr = "";

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
        MAB_LOG_LEVEL: "error"
      },
      stdio: ["pipe", "pipe", "pipe"]
    }
  );

  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        child.once("close", resolve);
      });
    }
    await rm(root, { recursive: true, force: true });
  });

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  child.stdin.end();

  const exitCode = await Promise.race([
    new Promise((resolve) => child.once("close", resolve)),
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `mimir-mcp did not exit after stdin closed. stdout='${stdout.slice(0, 400)}' stderr='${stderr.slice(0, 400)}'`
            )
          ),
        5_000
      )
    )
  ]);

  assert.notEqual(exitCode, null);
});

async function importInfrastructure() {
  return import(
    pathToFileURL(
      path.join(process.cwd(), "packages", "infrastructure", "dist", "index.js")
    ).href
  );
}

function buildStrictSessionEnv({
  canonicalRoot,
  stagingRoot,
  sqlitePath,
  registryPath
}) {
  return {
    MAB_NODE_ENV: "production",
    MAB_AUTH_MODE: "enforced",
    MAB_AUTH_ALLOW_ANONYMOUS_INTERNAL: "false",
    MAB_AUTH_ACTOR_REGISTRY_PATH: registryPath,
    MAB_VAULT_ROOT: canonicalRoot,
    MAB_STAGING_ROOT: stagingRoot,
    MAB_SQLITE_PATH: sqlitePath,
    MAB_QDRANT_URL: "http://qdrant:6333",
    MAB_QDRANT_COLLECTION: "mimisbrunnr_chunks",
    MAB_PROVIDER_DOCKER_OLLAMA_BASE_URL: "http://model-runner.docker.internal:12434",
    MAB_ROLE_CODING_PRIMARY_PROVIDER: "docker_ollama",
    MAB_ROLE_CODING_PRIMARY_MODEL: "qwen3-coder",
    MAB_ROLE_MIMISBRUNNR_PRIMARY_PROVIDER: "docker_ollama",
    MAB_ROLE_MIMISBRUNNR_PRIMARY_MODEL: "qwen3:4B-F16",
    MAB_ROLE_EMBEDDING_PRIMARY_PROVIDER: "docker_ollama",
    MAB_ROLE_EMBEDDING_PRIMARY_MODEL: "docker.io/ai/qwen3-embedding:0.6B-F16",
    MAB_ROLE_RERANKER_PRIMARY_PROVIDER: "docker_ollama",
    MAB_ROLE_RERANKER_PRIMARY_MODEL: "qwen3-reranker",
    MAB_DISABLE_PROVIDER_FALLBACKS: "true",
    MAB_QDRANT_SOFT_FAIL: "false",
    MAB_CODING_RUNTIME_PYTHON_EXECUTABLE: "python3",
    MAB_CODING_RUNTIME_PYTHONPATH: "/app/runtimes",
    MAB_CODING_RUNTIME_MODULE: "local_experts.bridge",
    MAB_CODING_RUNTIME_TIMEOUT_MS: "120000",
    MAB_MCP_DEFAULT_ACTOR_ID: "docker-mcp-session",
    MAB_MCP_DEFAULT_ACTOR_ROLE: "operator",
    MAB_MCP_DEFAULT_ACTOR_AUTH_TOKEN: "replace-with-session-token",
    MAB_MCP_DEFAULT_SOURCE: "mimir-mcp-session"
  };
}

function okJsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload;
    }
  };
}

async function writeActorRegistry(registryPath) {
  await writeFile(
    registryPath,
    JSON.stringify(
      {
        actors: [
          {
            actorId: "docker-mcp-session",
            actorRole: "operator",
            authToken: "replace-with-session-token",
            source: "mimir-mcp-session",
            allowedTransports: ["mcp"]
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );
}
