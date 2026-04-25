import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  createDoctor,
  readClientConfig,
  runRuntimeProbe
} from "../plugins/codex-voltagent-default/scripts/lib/client-config.mjs";
import { hasNativeCodexInstall } from "./lib/codex-native-install.mjs";

function parseDoctorArgs(argv) {
  const parsed = {
    homeRoot: resolve(homedir()),
    configPath: undefined,
    workspaceRoot: resolve(process.cwd()),
    probeRuntime: false,
    stateRoot: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--") {
      continue;
    }

    if (token === "--home-root") {
      parsed.homeRoot = resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === "--config") {
      parsed.configPath = resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === "--workspace") {
      parsed.workspaceRoot = resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === "--probe-runtime") {
      parsed.probeRuntime = true;
      continue;
    }

    if (token === "--state-root") {
      parsed.stateRoot = resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!parsed.configPath) {
    parsed.configPath = resolve(parsed.workspaceRoot, "client-config.json");
  }

  return parsed;
}

try {
  const parsed = parseDoctorArgs(process.argv.slice(2));
  const config = readClientConfig(parsed.configPath);
  const pluginShellPresent = existsSync(
    join(
      parsed.homeRoot,
      "plugins",
      "codex-voltagent-default",
      ".codex-plugin",
      "plugin.json"
    )
  );
  const report = createDoctor(config, {
    workspaceRoot: parsed.workspaceRoot,
    homeRoot: parsed.homeRoot,
    pluginShellPresent,
    nativeCodexInstallPresent: hasNativeCodexInstall(parsed.homeRoot)
  });

  if (parsed.probeRuntime) {
    try {
      const probe = runRuntimeProbe({
        configPath: parsed.configPath,
        workspaceRoot: parsed.workspaceRoot,
        stateRoot: parsed.stateRoot
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
