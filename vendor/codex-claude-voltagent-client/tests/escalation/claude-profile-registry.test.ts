import { describe, expect, it } from "vitest";
import { loadClientConfig } from "../../src/config/load-client-config.js";
import {
  ClaudeProfileRegistry,
  createClaudeProfileRegistry
} from "../../src/escalation/claude-profile-registry.js";

function createRegistry() {
  return createClaudeProfileRegistry({
    enabled: true,
    skillPacks: [
      {
        skillPackId: "review-core",
        skills: [
          "superpowers:requesting-code-review",
          "superpowers:verification-before-completion"
        ]
      }
    ],
    profiles: [
      {
        profileId: "release-reviewer",
        roleId: "release_reviewer",
        skillPackId: "review-core",
        model: "anthropic/claude-sonnet-4",
        fallback: ["openai/gpt-5-mini"],
        escalationReasons: ["pre_release_review"],
        outputMode: "structured",
        timeouts: {
          totalMs: 90000,
          modelMs: 60000
        },
        retries: 1
      }
    ]
  });
}

describe("ClaudeProfileRegistry", () => {
  it("resolves a profile together with its skill pack", () => {
    const registry = createRegistry();
    const resolved = registry.getProfile("release-reviewer");

    expect(resolved.profile.roleId).toBe("release_reviewer");
    expect(resolved.skillPack.skillPackId).toBe("review-core");
    expect(resolved.skillPack.skills).toEqual([
      "superpowers:requesting-code-review",
      "superpowers:verification-before-completion"
    ]);
  });

  it("lists profiles by escalation reason", () => {
    const registry = createRegistry();

    expect(
      registry.findProfilesForReason("pre_release_review").map(
        (entry) => entry.profile.profileId
      )
    ).toEqual(["release-reviewer"]);
  });

  it("throws a clear error for unknown profile ids", () => {
    const registry = createRegistry();

    expect(() => registry.getProfile("missing-profile")).toThrow(/missing-profile/i);
  });

  it("rejects duplicate skill ids inside the same Claude skill pack", () => {
    expect(() =>
      loadClientConfig({
        configVersion: 1,
        mimir: {
          serverCommand: ["node"],
          serverArgs: ["./tests/fixtures/fake-mimir-mcp-server.mjs"],
          transport: "stdio"
        },
        skills: {
          rootPaths: ["C:/Users/test/.codex/skills"]
        },
        models: {
          primary: "openai/gpt-5-mini",
          fallback: []
        },
        runtime: {
          mode: "voltagent+claude-manual",
          trustedWorkspaceRoots: ["C:/repo"]
        },
        claude: {
          enabled: true,
          skillPacks: [
            {
              skillPackId: "review-core",
              skills: [
                "superpowers:requesting-code-review",
                "superpowers:requesting-code-review"
              ]
            }
          ],
          profiles: [
            {
              profileId: "release-reviewer",
              roleId: "release_reviewer",
              skillPackId: "review-core",
              model: "anthropic/claude-sonnet-4",
              fallback: [],
              escalationReasons: ["pre_release_review"],
              outputMode: "structured",
              timeouts: {
                totalMs: 90000,
                modelMs: 60000
              },
              retries: 1
            }
          ]
        }
      })
    ).toThrow(/duplicate claude skill/i);
  });
});
