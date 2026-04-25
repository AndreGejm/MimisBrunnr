import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  createDoctor,
  parseCliArgs,
  readClientConfig,
  runRuntimeProbe
} from "../plugins/codex-voltagent-default/scripts/lib/client-config.mjs";
import { hasNativeCodexInstall } from "./lib/codex-native-install.mjs";

try {
  const {
    configPath,
    configSource,
    homeRoot,
    workspaceRoot,
    probeRuntime,
    stateRoot
  } = parseCliArgs(process.argv.slice(2));
  const config = readClientConfig(configPath);
  const pluginShellPresent = existsSync(
    join(
      homeRoot,
      "plugins",
      "codex-voltagent-default",
      ".codex-plugin",
      "plugin.json"
    )
  );
  const report = createDoctor(config, {
    configPath,
    configSource,
    homeRoot,
    workspaceRoot,
    pluginShellPresent,
    nativeCodexInstallPresent: hasNativeCodexInstall(homeRoot)
  });

  if (probeRuntime) {
    try {
      const probe = runRuntimeProbe({
        configPath,
        workspaceRoot,
        stateRoot
      });

      report.status.runtimeHealth = probe.runtimeHealth;
      report.status.mimirConnection = probe.mimirConnection;
      report.status.probe = probe;
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
