import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..");

function readRepoFile(...segments: string[]) {
  return readFileSync(join(repoRoot, ...segments), "utf8");
}

describe("public docs and examples", () => {
  it("describes the Mimir stdio config shape without hardcoding a machine-specific command", () => {
    const readme = readRepoFile("README.md");

    expect(readme).toContain("serverCommand");
    expect(readme).toContain("serverArgs");
    expect(readme).toContain("valid MCP stdio command");
    expect(readme).not.toContain('serverCommand: ["mimir-mcp"]');
    expect(readme).toContain('from "./dist/index.js"');
    expect(readme).toContain("createCodexClient");
  });

  it("points the examples at the built root export surface without assuming a global mimir-mcp launcher", () => {
    const codexExample = readRepoFile("examples", "codex-basic.ts");
    const claudeExample = readRepoFile("examples", "claude-basic.ts");

    expect(codexExample).toContain('from "../dist/index.js"');
    expect(codexExample).toContain("createCodexClient");
    expect(codexExample).not.toContain('"mimir-mcp"');
    expect(claudeExample).toContain('from "../dist/index.js"');
    expect(claudeExample).toContain("createClaudeClient");
    expect(claudeExample).not.toContain('"mimir-mcp"');
  });

  it("separates routing smoke coverage from runtime entrypoint coverage and composed integration coverage", () => {
    const boundaryDoc = readRepoFile("docs", "mimir-boundary.md");

    expect(boundaryDoc).toContain("tests/smoke/boundary-smoke.test.ts");
    expect(boundaryDoc).toContain(
      "tests/entrypoints/client-entrypoints.test.ts"
    );
    expect(boundaryDoc).toContain(
      "tests/integration/composed-client-surface.test.ts"
    );
  });

  it("documents the repo-local Codex plugin shell and explicit home-local install helper", () => {
    const readme = readRepoFile("README.md");

    expect(readme).toContain("plugins/codex-voltagent-default");
    expect(readme).toContain("status.mjs");
    expect(readme).toContain("doctor.mjs");
    expect(readme).toContain("enable.mjs");
    expect(readme).toContain("disable.mjs");
    expect(readme).toContain("init-client-config.mjs");
    expect(readme).toContain("bootstrap-default-runtime.mjs");
    expect(readme).toContain("profiles.mjs");
    expect(readme).toContain("route-preview.mjs");
    expect(readme).toContain("claude-handoff.mjs");
    expect(readme).toContain("claude-auto-handoff.mjs");
    expect(readme).toContain("install-home-plugin.mjs");
    expect(readme).toContain("--probe-runtime");
    expect(readme).toContain("client-root.json");
    expect(readme).toContain("pnpm build");
    expect(readme).toContain("pnpm plugin:install-home");
    expect(readme).toContain("pnpm plugin:init-config");
    expect(readme).toContain("pnpm plugin:bootstrap-default");
    expect(readme).toContain("~/.codex/voltagent/client-config.json");
    expect(readme).toContain("repo-local plugin shell");
    expect(readme).toContain("no automatic startup hook");
  });

  it("documents native Codex skill installation as the primary activation path", () => {
    const readme = readRepoFile("README.md");
    const installDoc = readRepoFile(".codex", "INSTALL.md");

    expect(readme).toContain("native Codex skill discovery");
    expect(readme).toContain("primary activation path");
    expect(readme).toContain("~/.codex/skills");
    expect(readme).toContain("plugin shell install (optional)");

    expect(installDoc).toContain("Installing VoltAgent Default for Codex");
    expect(installDoc).toContain("native Codex skill discovery");
    expect(installDoc).toContain("~/.codex/skills/voltagent-default");
    expect(installDoc).toContain("restart Codex");
    expect(installDoc).toContain("scripts/install-codex.ps1");
    expect(installDoc).toContain("scripts/install-codex.sh");
  });

  it("ships native Codex install scripts alongside the install guide", () => {
    expect(existsSync(join(repoRoot, "scripts", "install-codex.ps1"))).toBe(
      true
    );
    expect(existsSync(join(repoRoot, "scripts", "install-codex.sh"))).toBe(
      true
    );
  });

  it("documents the repo-level onboarding and doctor commands", () => {
    const readme = readRepoFile("README.md");
    const installDoc = readRepoFile(".codex", "INSTALL.md");
    const activationDoc = readRepoFile("docs", "codex-default-activation.md");

    expect(existsSync(join(repoRoot, "scripts", "codex-onboard.mjs"))).toBe(true);
    expect(existsSync(join(repoRoot, "scripts", "codex-doctor.mjs"))).toBe(true);

    expect(readme).toContain("pnpm codex:onboard");
    expect(readme).toContain("pnpm codex:doctor");
    expect(readme).toContain("single onboarding command");
    expect(readme).toContain("pnpm codex:smoke");
    expect(readme).toContain("workspace override");

    expect(installDoc).toContain("pnpm codex:onboard");
    expect(installDoc).toContain("pnpm codex:doctor");
    expect(installDoc).toContain("pnpm codex:smoke");
    expect(installDoc).toContain("~/.codex/voltagent/client-config.json");
    expect(activationDoc).toContain("Fresh-machine smoke");
    expect(activationDoc).toContain("pnpm codex:smoke");
    expect(activationDoc).toContain("Config discovery is intentionally layered");
  });

  it("documents the stable default workflow and route policy for Codex users", () => {
    const readme = readRepoFile("README.md");
    const activationDoc = readRepoFile("docs", "codex-default-activation.md");
    const workflowSkill = readRepoFile(
      "skills",
      "voltagent-default-workflow",
      "SKILL.md"
    );

    expect(readme).toContain("docs/codex-default-activation.md");

    expect(activationDoc).toContain("Codex Default VoltAgent Activation");
    expect(activationDoc).toContain("client-skill");
    expect(activationDoc).toContain("client-paid-runtime");
    expect(activationDoc).toContain("mimir-retrieval");
    expect(activationDoc).toContain("mimir-local-execution");
    expect(activationDoc).toContain("mimir-memory-write");
    expect(activationDoc).toContain("claude-escalation");
    expect(activationDoc).toContain("client selects the profile");
    expect(activationDoc).toContain("model does not select its own role");
    expect(activationDoc).toContain("Without Mimir");
    expect(activationDoc).toContain("Without Claude profile configuration");

    expect(workflowSkill).toContain("Recommended workflow");
    expect(workflowSkill).toContain("voltagent-route-preview");
    expect(workflowSkill).toContain("voltagent-claude-auto-handoff");
  });
});
