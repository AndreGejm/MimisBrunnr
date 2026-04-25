import { listProfiles, parseCliArgs, readClientConfig } from "./lib/client-config.mjs";

try {
  const { configPath, configSource } = parseCliArgs(process.argv.slice(2));
  const config = readClientConfig(configPath);

  process.stdout.write(
    `${JSON.stringify(
      {
        configPath,
        configSource,
        enabled: config.claude.enabled,
        profiles: listProfiles(config)
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
