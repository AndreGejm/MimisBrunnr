import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createHomeInstallLayout,
  parseInstallArgs,
  syncInstalledPlugin,
  updateMarketplace
} from "../plugins/codex-voltagent-default/scripts/lib/home-plugin-install.mjs";
import {
  createDoctor,
  runRuntimeProbe
} from "../plugins/codex-voltagent-default/scripts/lib/client-config.mjs";
import {
  createValidatedClientConfig,
  parseInitArgs,
  writeClientConfigFile
} from "../plugins/codex-voltagent-default/scripts/lib/init-client-config.mjs";
import {
  createNativeSkillInstallLayout,
  hasNativeCodexInstall,
  installNativeCodexSkills
} from "./lib/codex-native-install.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = dirname(currentFilePath);
const repoRoot = resolve(currentDirPath, "..");
const skillsSourcePath = join(repoRoot, "skills");
const pluginRoot = join(repoRoot, "plugins", "codex-voltagent-default");

function parseOnboardArgs(argv) {
  const installArgs = parseInstallArgs(argv, { allowUnknown: true });
  const initArgs = parseInitArgs(argv, {
    allowUnknown: true,
    homeRoot: installArgs.homeRoot
  });
  const parsed = {
    installArgs,
    initArgs,
    installPluginShell: false,
    probeRuntime: false,
    stateRoot: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--install-plugin-shell") {
      parsed.installPluginShell = true;
      continue;
    }

    if (token === "--probe-runtime") {
      parsed.probeRuntime = true;
      continue;
    }

    if (token === "--state-root") {
      parsed.stateRoot = resolve(argv[index + 1]);
      index += 1;
    }
  }

  return parsed;
}

async function main() {
  const parsed = parseOnboardArgs(process.argv.slice(2));
  const nativeInstallLayout = createNativeSkillInstallLayout({
    homeRoot: parsed.installArgs.homeRoot,
    sourcePath: skillsSourcePath
  });

  installNativeCodexSkills(nativeInstallLayout);

  const config = await createValidatedClientConfig(parsed.initArgs);

  writeClientConfigFile(parsed.initArgs.configPath, config, parsed.initArgs.force);

  let pluginInstall = null;

  if (parsed.installPluginShell) {
    const pluginLayout = createHomeInstallLayout({
      homeRoot: parsed.installArgs.homeRoot,
      pluginRoot,
      clientRoot: repoRoot
    });

    syncInstalledPlugin(pluginLayout);
    updateMarketplace(pluginLayout);
    pluginInstall = pluginLayout;
  }

  const pluginPath =
    pluginInstall?.pluginPath ??
    createHomeInstallLayout({
      homeRoot: parsed.installArgs.homeRoot,
      pluginRoot,
      clientRoot: repoRoot
    }).pluginPath;
  const pluginShellPresent = existsSync(
    join(pluginPath, ".codex-plugin", "plugin.json")
  );
  const doctor = createDoctor(config, {
    workspaceRoot: parsed.initArgs.workspaceRoot,
    homeRoot: parsed.installArgs.homeRoot,
    pluginShellPresent,
    nativeCodexInstallPresent: hasNativeCodexInstall(parsed.installArgs.homeRoot)
  });

  if (parsed.probeRuntime) {
    try {
      const probe = runRuntimeProbe({
        configPath: parsed.initArgs.configPath,
        workspaceRoot: parsed.initArgs.workspaceRoot,
        stateRoot: parsed.stateRoot
      });

      doctor.status.runtimeHealth = probe.runtimeHealth;
      doctor.status.mimirConnection = probe.mimirConnection;
      doctor.status.probe = probe;
      doctor.checks.push({
        code: "client_composition",
        status: probe.ok ? "ok" : "error",
        message: probe.ok
          ? `Composed client runtime probe succeeded (${probe.ownershipStatus}).`
          : `Composed client runtime probe failed (${probe.ownershipStatus}).`
      });
      doctor.ok = doctor.ok && probe.ok;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      doctor.ok = false;
      doctor.checks.push({
        code: "client_composition",
        status: "error",
        message
      });
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: doctor.ok,
        install: {
          homeRoot: nativeInstallLayout.homeRoot,
          sourcePath: nativeInstallLayout.sourcePath,
          targetPath: nativeInstallLayout.targetPath,
          pluginShellInstalled: parsed.installPluginShell,
          pluginPath: pluginInstall?.pluginPath ?? null
        },
        config: {
          configPath: parsed.initArgs.configPath,
          mode: config.runtime.mode,
          workspaceRoot: parsed.initArgs.workspaceRoot ?? null,
          claudeEnabled: config.claude.enabled,
          profileIds: config.claude.profiles.map((profile) => profile.profileId)
        },
        doctor
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);

  process.stderr.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
  process.exitCode = 1;
});
