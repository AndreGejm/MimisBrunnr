import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadClientModule } from "./plugin-runtime-paths.mjs";

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--config") {
      parsed.configPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (token === "--workspace") {
      parsed.workspaceRoot = argv[index + 1];
      index += 1;
      continue;
    }

    if (token === "--state-root") {
      parsed.stateRoot = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!parsed.configPath || !parsed.workspaceRoot || !parsed.stateRoot) {
    throw new Error("--config, --workspace, and --state-root are required");
  }

  return {
    configPath: parsed.configPath,
    workspaceRoot: parsed.workspaceRoot,
    stateRoot: parsed.stateRoot
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { createCodexClient } = await loadClientModule(
    "dist/entrypoints/create-codex-client.js",
    { fromImportMetaUrl: import.meta.url }
  );
  const { loadClientConfig } = await loadClientModule(
    "dist/config/load-client-config.js",
    { fromImportMetaUrl: import.meta.url }
  );
  const { createRuntimeOwnership } = await loadClientModule(
    "dist/runtime/runtime-ownership.js",
    { fromImportMetaUrl: import.meta.url }
  );
  const rawConfig = JSON.parse(readFileSync(args.configPath, "utf8"));
  const config = loadClientConfig(rawConfig);
  const ownership = createRuntimeOwnership({
    stateRoot: args.stateRoot,
    workspaceRoot: args.workspaceRoot,
    ownerId: "codex-voltagent-default-probe",
    pid: process.pid
  });
  const acquireResult = ownership.acquire();

  if (acquireResult.status === "existing_healthy") {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: false,
          runtimeHealth: "degraded",
          mimirConnection: "disconnected",
          ownershipStatus: acquireResult.status,
          discoveredSkillCount: 0
        },
        null,
        2
      )}\n`
    );
    return;
  }

  let client;

  try {
    client = await createCodexClient({
      config,
      workflowMemoryAuthority: "client-operational"
    });

    const discoveredSkills =
      await client.runtime.workspace.skills?.discoverSkills();

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          runtimeHealth: "ready",
          mimirConnection: "connected",
          ownershipStatus: acquireResult.status,
          discoveredSkillCount: discoveredSkills?.length ?? 0
        },
        null,
        2
      )}\n`
    );
  } finally {
    await client?.close();
    ownership.release();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);

  process.stderr.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
  process.exitCode = 1;
});
