import {
  enableDefaultMode,
  parseCliArgs,
  readClientConfig,
  writeClientConfig
} from "./lib/client-config.mjs";

try {
  const { configPath, configSource, workspaceRoot } = parseCliArgs(
    process.argv.slice(2)
  );
  const config = readClientConfig(configPath);
  const updatedConfig = enableDefaultMode(config, workspaceRoot);

  writeClientConfig(configPath, updatedConfig);

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        configPath,
        configSource,
        mode: updatedConfig.runtime.mode,
        workspaceRoot,
        trustedWorkspaceRoots: updatedConfig.runtime.trustedWorkspaceRoots
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
