import {
  createStatus,
  parseCliArgs,
  readClientConfig,
  runRuntimeProbe
} from "./lib/client-config.mjs";

try {
  const { configPath, workspaceRoot, probeRuntime, stateRoot } = parseCliArgs(
    process.argv.slice(2)
  );
  const config = readClientConfig(configPath);
  let status = createStatus(config, { workspaceRoot });
  let probe;

  if (probeRuntime) {
    probe = runRuntimeProbe({
      configPath,
      workspaceRoot,
      stateRoot
    });
    status = {
      ...status,
      runtimeHealth: probe.runtimeHealth,
      mimirConnection: probe.mimirConnection
    };
  }

  process.stdout.write(
    `${JSON.stringify(
      probe
        ? {
            ...status,
            probe
          }
        : status,
      null,
      2
    )}\n`
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  process.stderr.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
  process.exitCode = 1;
}
