import {
  createHomeInstallLayout,
  parseInstallArgs,
  syncInstalledPlugin,
  updateMarketplace
} from "./lib/home-plugin-install.mjs";

try {
  const args = parseInstallArgs(process.argv.slice(2));
  const layout = createHomeInstallLayout({
    homeRoot: args.homeRoot,
    fromImportMetaUrl: import.meta.url
  });

  syncInstalledPlugin(layout);
  updateMarketplace(layout);

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        homeRoot: layout.homeRoot,
        clientRoot: layout.clientRoot,
        pluginPath: layout.pluginPath,
        marketplacePath: layout.marketplacePath
      },
      null,
      2
    )}\n`
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  process.stderr.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
  process.exitCode = 1;
}
