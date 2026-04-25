import {
  createDoctor,
  parseCliArgs,
  readClientConfig,
  runRuntimeProbe
} from "./lib/client-config.mjs";

try {
  const { configPath, workspaceRoot, probeRuntime, stateRoot } = parseCliArgs(
    process.argv.slice(2)
  );
  const config = readClientConfig(configPath);
  const report = createDoctor(config, { workspaceRoot });

  if (probeRuntime) {
    try {
      const probe = runRuntimeProbe({
        configPath,
        workspaceRoot,
        stateRoot
      });

      report.status.runtimeHealth = probe.runtimeHealth;
      report.status.mimirConnection = probe.mimirConnection;
      report.checks.push({
        code: "client_composition",
        status: probe.ok ? "ok" : "error",
        message: probe.ok
          ? `Composed client runtime probe succeeded (${probe.ownershipStatus}).`
          : `Composed client runtime probe failed (${probe.ownershipStatus}).`
      });
      report.ok = report.ok && probe.ok;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      report.ok = false;
      report.checks.push({
        code: "client_composition",
        status: "error",
        message
      });
    }
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  process.stderr.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
  process.exitCode = 1;
}
