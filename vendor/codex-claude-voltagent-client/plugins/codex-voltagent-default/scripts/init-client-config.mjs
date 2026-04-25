import {
  createValidatedClientConfig,
  parseInitArgs,
  writeClientConfigFile
} from "./lib/init-client-config.mjs";

async function main() {
  const args = parseInitArgs(process.argv.slice(2));
  const config = await createValidatedClientConfig(args);

  writeClientConfigFile(args.configPath, config, args.force);

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        configPath: args.configPath,
        mode: config.runtime.mode,
        workspaceRoot: args.workspaceRoot ?? null,
        claudeEnabled: config.claude.enabled,
        profileIds: config.claude.profiles.map((profile) => profile.profileId)
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
