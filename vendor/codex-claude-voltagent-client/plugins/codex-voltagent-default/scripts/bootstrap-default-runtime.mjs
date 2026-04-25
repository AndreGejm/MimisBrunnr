import {
  createHomeInstallLayout,
  parseInstallArgs,
  syncInstalledPlugin,
  updateMarketplace
} from "./lib/home-plugin-install.mjs";
import {
  createValidatedClientConfig,
  parseInitArgs,
  writeClientConfigFile
} from "./lib/init-client-config.mjs";

async function main() {
  const installArgs = parseInstallArgs(process.argv.slice(2), {
    allowUnknown: true
  });
  const initArgs = parseInitArgs(process.argv.slice(2), {
    allowUnknown: true,
    homeRoot: installArgs.homeRoot
  });
  const installLayout = createHomeInstallLayout({
    homeRoot: installArgs.homeRoot,
    fromImportMetaUrl: import.meta.url
  });
  const config = await createValidatedClientConfig(initArgs);

  syncInstalledPlugin(installLayout);
  updateMarketplace(installLayout);
  writeClientConfigFile(initArgs.configPath, config, initArgs.force);

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        install: {
          homeRoot: installLayout.homeRoot,
          clientRoot: installLayout.clientRoot,
          pluginPath: installLayout.pluginPath,
          marketplacePath: installLayout.marketplacePath
        },
        config: {
          configPath: initArgs.configPath,
          mode: config.runtime.mode,
          workspaceRoot: initArgs.workspaceRoot ?? null,
          claudeEnabled: config.claude.enabled,
          profileIds: config.claude.profiles.map((profile) => profile.profileId)
        }
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
