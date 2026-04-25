import {
  assertEscalationDepth,
  createClaudeHandoffEnvelope,
  loadClaudeRuntimeContext,
  parseClaudeHandoffArgs,
  resolveAutoProfile
} from "./lib/claude-handoff.mjs";

async function main() {
  const args = parseClaudeHandoffArgs(process.argv.slice(2), {
    requireProfile: false
  });
  const { registry } = await loadClaudeRuntimeContext(args.configPath);

  assertEscalationDepth(args.escalationDepth);

  const resolved = resolveAutoProfile(registry, args.reason);
  const envelope = createClaudeHandoffEnvelope(resolved, args);

  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);

  process.stderr.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
  process.exitCode = 1;
});
