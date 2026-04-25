import { describe, expect, it } from "vitest";
import { createClientStatus } from "../../src/diagnostics/client-status.js";
import { loadClientConfig } from "../../src/config/load-client-config.js";

describe("createClientStatus", () => {
  it("summarizes runtime mode, trusted roots, and Claude profile ids", () => {
    const config = loadClientConfig({
      mimir: {
        serverCommand: ["mimir"]
      },
      skills: {
        rootPaths: ["C:/Users/vikel/.codex/skills"]
      },
      models: {
        primary: "openai/gpt-5-mini",
        fallback: ["anthropic/claude-sonnet-4"]
      },
      runtime: {
        mode: "voltagent+claude-manual",
        trustedWorkspaceRoots: ["F:/Dev/scripts/Mimir"]
      },
      claude: {
        enabled: true,
        skillPacks: [
          {
            skillPackId: "review-core",
            skills: ["superpowers:requesting-code-review"]
          }
        ],
        profiles: [
          {
            profileId: "release-reviewer",
            roleId: "release_reviewer",
            skillPackId: "review-core",
            model: "anthropic/claude-sonnet-4",
            escalationReasons: ["pre_release_review"],
            timeouts: {
              totalMs: 90000,
              modelMs: 60000
            }
          }
        ]
      }
    });

    const status = createClientStatus(config, {
      workspaceRoot: "F:/Dev/scripts/Mimir/mimir",
      runtimeHealth: "ready",
      mimirConnection: "connected"
    });

    expect(status.mode).toBe("voltagent+claude-manual");
    expect(status.workspaceTrusted).toBe(true);
    expect(status.runtimeHealth).toBe("ready");
    expect(status.mimirConnection).toBe("connected");
    expect(status.claude.profileIds).toEqual(["release-reviewer"]);
    expect(status.claude.skillPackIds).toEqual(["review-core"]);
  });
});
