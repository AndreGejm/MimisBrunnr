import { describe, expect, it } from "vitest";
import { loadClientConfig } from "../../src/config/load-client-config.js";

describe("loadClientConfig", () => {
  it("requires explicit Mimir MCP command and skill roots", () => {
    expect(() =>
      loadClientConfig({
        mimir: { serverCommand: [], serverArgs: [] },
        skills: { rootPaths: [] },
        models: { primary: "openai/gpt-4.1-mini" }
      })
    ).toThrow(/serverCommand/i);
  });

  it("accepts explicit Mimir MCP command and skill roots", () => {
    const config = loadClientConfig({
      mimir: {
        serverCommand: ["mimir"],
        serverArgs: ["mcp"],
        transport: "stdio"
      },
      skills: {
        rootPaths: ["C:/Users/vikel/.codex/skills", "F:/Dev/skills"]
      },
      models: {
        primary: "openai/gpt-4.1-mini",
        fallback: ["anthropic/claude-sonnet-4"]
      }
    });

    expect(config.mimir.serverCommand).toEqual(["mimir"]);
    expect(config.skills.rootPaths).toHaveLength(2);
    expect(config.models.fallback).toEqual(["anthropic/claude-sonnet-4"]);
  });

  it("applies schema defaults for optional arrays and transport", () => {
    const config = loadClientConfig({
      mimir: {
        serverCommand: ["mimir"]
      },
      skills: {
        rootPaths: ["C:/Users/vikel/.codex/skills"]
      },
      models: {
        primary: "openai/gpt-4.1-mini"
      }
    });

    expect(config.mimir.serverArgs).toEqual([]);
    expect(config.mimir.transport).toBe("stdio");
    expect(config.models.fallback).toEqual([]);
    expect(config.configVersion).toBe(1);
    expect(config.runtime.mode).toBe("local-only");
    expect(config.runtime.trustedWorkspaceRoots).toEqual([]);
    expect(config.claude.enabled).toBe(false);
    expect(config.claude.skillPacks).toEqual([]);
    expect(config.claude.profiles).toEqual([]);
  });

  it("rejects automatic default runtime modes without trusted workspace roots", () => {
    expect(() =>
      loadClientConfig({
        mimir: {
          serverCommand: ["mimir"]
        },
        skills: {
          rootPaths: ["C:/Users/vikel/.codex/skills"]
        },
        models: {
          primary: "openai/gpt-4.1-mini"
        },
        runtime: {
          mode: "voltagent-default"
        }
      })
    ).toThrow(/trustedWorkspaceRoots/i);
  });

  it("rejects Claude runtime modes when Claude escalation is disabled", () => {
    expect(() =>
      loadClientConfig({
        mimir: {
          serverCommand: ["mimir"]
        },
        skills: {
          rootPaths: ["C:/Users/vikel/.codex/skills"]
        },
        models: {
          primary: "openai/gpt-4.1-mini"
        },
        runtime: {
          mode: "voltagent+claude-manual",
          trustedWorkspaceRoots: ["F:/Dev/scripts/Mimir"]
        }
      })
    ).toThrow(/claude/i);
  });

  it("accepts explicit Claude skill packs and profiles", () => {
    const config = loadClientConfig({
      mimir: {
        serverCommand: ["mimir"],
        serverArgs: ["mcp"]
      },
      skills: {
        rootPaths: ["C:/Users/vikel/.codex/skills"]
      },
      models: {
        primary: "openai/gpt-4.1-mini",
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
      }
    });

    expect(config.runtime.mode).toBe("voltagent+claude-manual");
    expect(config.runtime.trustedWorkspaceRoots).toEqual([
      "F:/Dev/scripts/Mimir"
    ]);
    expect(config.claude.enabled).toBe(true);
    expect(config.claude.skillPacks[0]?.skillPackId).toBe("review-core");
    expect(config.claude.profiles[0]?.profileId).toBe("release-reviewer");
  });

  it("rejects Claude profiles that reference unknown skill packs", () => {
    expect(() =>
      loadClientConfig({
        mimir: {
          serverCommand: ["mimir"]
        },
        skills: {
          rootPaths: ["C:/Users/vikel/.codex/skills"]
        },
        models: {
          primary: "openai/gpt-4.1-mini"
        },
        runtime: {
          mode: "voltagent+claude-manual",
          trustedWorkspaceRoots: ["F:/Dev/scripts/Mimir"]
        },
        claude: {
          enabled: true,
          skillPacks: [],
          profiles: [
            {
              profileId: "release-reviewer",
              roleId: "release_reviewer",
              skillPackId: "missing-pack",
              model: "anthropic/claude-sonnet-4",
              escalationReasons: ["pre_release_review"],
              timeouts: {
                totalMs: 90000,
                modelMs: 60000
              }
            }
          ]
        }
      })
    ).toThrow(/skillPackId/i);
  });

  it("rejects duplicate Claude profile ids and duplicate skill pack ids", () => {
    expect(() =>
      loadClientConfig({
        mimir: {
          serverCommand: ["mimir"]
        },
        skills: {
          rootPaths: ["C:/Users/vikel/.codex/skills"]
        },
        models: {
          primary: "openai/gpt-4.1-mini"
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
            },
            {
              skillPackId: "review-core",
              skills: ["superpowers:verification-before-completion"]
            }
          ],
          profiles: []
        }
      })
    ).toThrow(/skill pack/i);

    expect(() =>
      loadClientConfig({
        mimir: {
          serverCommand: ["mimir"]
        },
        skills: {
          rootPaths: ["C:/Users/vikel/.codex/skills"]
        },
        models: {
          primary: "openai/gpt-4.1-mini"
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
            },
            {
              profileId: "release-reviewer",
              roleId: "implementation_reviewer",
              skillPackId: "review-core",
              model: "anthropic/claude-sonnet-4",
              escalationReasons: ["post_change_review"],
              timeouts: {
                totalMs: 90000,
                modelMs: 60000
              }
            }
          ]
        }
      })
    ).toThrow(/profile id/i);
  });

  it("rejects unknown keys", () => {
    expect(() =>
      loadClientConfig({
        mimir: {
          serverCommand: ["mimir"]
        },
        skills: {
          rootPaths: ["C:/Users/vikel/.codex/skills"]
        },
        models: {
          primary: "openai/gpt-4.1-mini"
        },
        extra: true
      })
    ).toThrow(/unrecognized key/i);
  });

  it("rejects empty serverArgs entries", () => {
    expect(() =>
      loadClientConfig({
        mimir: {
          serverCommand: ["mimir"],
          serverArgs: [""]
        },
        skills: {
          rootPaths: ["C:/Users/vikel/.codex/skills"]
        },
        models: {
          primary: "openai/gpt-4.1-mini"
        }
      })
    ).toThrow(/serverArgs/i);
  });

  it("rejects whitespace-only serverArgs entries", () => {
    expect(() =>
      loadClientConfig({
        mimir: {
          serverCommand: ["mimir"],
          serverArgs: ["   "]
        },
        skills: {
          rootPaths: ["C:/Users/vikel/.codex/skills"]
        },
        models: {
          primary: "openai/gpt-4.1-mini"
        }
      })
    ).toThrow(/serverArgs/i);
  });

  it("rejects whitespace-only required strings", () => {
    expect(() =>
      loadClientConfig({
        mimir: {
          serverCommand: ["   "]
        },
        skills: {
          rootPaths: ["C:/Users/vikel/.codex/skills"]
        },
        models: {
          primary: "openai/gpt-4.1-mini"
        }
      })
    ).toThrow(/serverCommand/i);

    expect(() =>
      loadClientConfig({
        mimir: {
          serverCommand: ["mimir"]
        },
        skills: {
          rootPaths: ["   "]
        },
        models: {
          primary: "openai/gpt-4.1-mini"
        }
      })
    ).toThrow(/rootPaths/i);

    expect(() =>
      loadClientConfig({
        mimir: {
          serverCommand: ["mimir"]
        },
        skills: {
          rootPaths: ["C:/Users/vikel/.codex/skills"]
        },
        models: {
          primary: "   "
        }
      })
    ).toThrow(/primary/i);
  });

  it("rejects whitespace-only fallback entries", () => {
    expect(() =>
      loadClientConfig({
        mimir: {
          serverCommand: ["mimir"]
        },
        skills: {
          rootPaths: ["C:/Users/vikel/.codex/skills"]
        },
        models: {
          primary: "openai/gpt-4.1-mini",
          fallback: ["   "]
        }
      })
    ).toThrow(/fallback/i);
  });

  it("rejects nested unknown keys under mimir, skills, and models", () => {
    expect(() =>
      loadClientConfig({
        mimir: {
          serverCommand: ["mimir"],
          unexpected: true
        },
        skills: {
          rootPaths: ["C:/Users/vikel/.codex/skills"]
        },
        models: {
          primary: "openai/gpt-4.1-mini"
        }
      })
    ).toThrow(/unrecognized key/i);

    expect(() =>
      loadClientConfig({
        mimir: {
          serverCommand: ["mimir"]
        },
        skills: {
          rootPaths: ["C:/Users/vikel/.codex/skills"],
          unexpected: true
        },
        models: {
          primary: "openai/gpt-4.1-mini"
        }
      })
    ).toThrow(/unrecognized key/i);

    expect(() =>
      loadClientConfig({
        mimir: {
          serverCommand: ["mimir"]
        },
        skills: {
          rootPaths: ["C:/Users/vikel/.codex/skills"]
        },
        models: {
          primary: "openai/gpt-4.1-mini",
          unexpected: true
        }
      })
    ).toThrow(/unrecognized key/i);
  });
});
