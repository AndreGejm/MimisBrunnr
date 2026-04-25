import { readFileSync } from "node:fs";
import { classifyRoute, parseRouteFlags } from "./lib/client-config.mjs";
import { loadClientModule } from "./lib/plugin-runtime-paths.mjs";

function parseArgs(argv) {
  const routeTokens = [];
  const parsed = {
    configPath: undefined,
    reason: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--config") {
      parsed.configPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (token === "--reason") {
      parsed.reason = argv[index + 1];
      index += 1;
      continue;
    }

    routeTokens.push(token);
  }

  return {
    routeInput: parseRouteFlags(routeTokens),
    ...parsed
  };
}

async function main() {
  const { routeInput, configPath, reason } = parseArgs(process.argv.slice(2));
  const route = classifyRoute(routeInput);
  const response = {
    input: routeInput,
    route
  };

  if (configPath && reason) {
    const { loadClientConfig } = await loadClientModule(
      "dist/config/load-client-config.js",
      { fromImportMetaUrl: import.meta.url }
    );
    const { createClaudeProfileRegistry } = await loadClientModule(
      "dist/escalation/claude-profile-registry.js",
      { fromImportMetaUrl: import.meta.url }
    );
    const rawConfig = JSON.parse(readFileSync(configPath, "utf8"));
    const config = loadClientConfig(rawConfig);

    if (route !== "client-paid-runtime") {
      response.effectiveRoute = route;
      response.claudeAutoSelection = {
        status: "skipped_due_to_route",
        reason
      };
    } else if (
      config.runtime.mode !== "voltagent+claude-auto" ||
      !config.claude.enabled
    ) {
      response.effectiveRoute = route;
      response.claudeAutoSelection = {
        status: "disabled",
        reason
      };
    } else {
      const registry = createClaudeProfileRegistry(config.claude);
      const matches = registry.findProfilesForReason(reason);

      if (matches.length === 0) {
        throw new Error(`No Claude profile allows escalation reason ${reason}`);
      }

      if (matches.length > 1) {
        throw new Error(
          `Multiple Claude profiles allow escalation reason ${reason}; choose one explicitly`
        );
      }

      response.effectiveRoute = "claude-escalation";
      response.claudeAutoSelection = {
        status: "selected",
        profileId: matches[0].profile.profileId,
        roleId: matches[0].profile.roleId,
        skillPackId: matches[0].skillPack.skillPackId,
        skills: matches[0].skillPack.skills,
        model: {
          primary: matches[0].profile.model,
          fallback: matches[0].profile.fallback
        }
      };
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      response,
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
