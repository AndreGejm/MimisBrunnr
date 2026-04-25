import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..");
const nativeSkillsRoot = join(repoRoot, "skills");
const pluginSkillsRoot = join(
  repoRoot,
  "plugins",
  "codex-voltagent-default",
  "skills"
);

const mirroredSkillIds = [
  "voltagent-bootstrap-default-runtime",
  "voltagent-claude-auto-handoff",
  "voltagent-claude-handoff",
  "voltagent-disable",
  "voltagent-doctor",
  "voltagent-enable",
  "voltagent-profiles",
  "voltagent-route-preview",
  "voltagent-status"
] as const;

function readRepoFile(...segments: string[]) {
  return readFileSync(join(repoRoot, ...segments), "utf8");
}

describe("native Codex skills", () => {
  it("exposes a top-level skills tree for native Codex discovery", () => {
    expect(existsSync(nativeSkillsRoot)).toBe(true);

    for (const skillId of mirroredSkillIds) {
      expect(existsSync(join(nativeSkillsRoot, skillId, "SKILL.md"))).toBe(
        true
      );
    }

    expect(
      existsSync(join(nativeSkillsRoot, "voltagent-default-workflow", "SKILL.md"))
    ).toBe(true);
  });

  it("keeps mirrored native skills in sync with the repo-local plugin skill prompts", () => {
    for (const skillId of mirroredSkillIds) {
      const nativeSkill = readRepoFile("skills", skillId, "SKILL.md");
      const pluginSkill = readRepoFile(
        "plugins",
        "codex-voltagent-default",
        "skills",
        skillId,
        "SKILL.md"
      );

      expect(nativeSkill).toBe(pluginSkill);
    }
  });

  it("defines a default workflow skill that explains the stable routing contract", () => {
    const workflowSkill = readRepoFile(
      "skills",
      "voltagent-default-workflow",
      "SKILL.md"
    );

    expect(workflowSkill).toContain("VoltAgent Default Workflow");
    expect(workflowSkill).toContain("Use the local VoltAgent runtime");
    expect(workflowSkill).toContain("Use Mimir for durable memory retrieval");
    expect(workflowSkill).toContain("Use Claude only through named profiles");
    expect(workflowSkill).toContain("client-skill");
    expect(workflowSkill).toContain("client-paid-runtime");
    expect(workflowSkill).toContain("mimir-retrieval");
    expect(workflowSkill).toContain("mimir-local-execution");
    expect(workflowSkill).toContain("mimir-memory-write");
    expect(workflowSkill).toContain("claude-escalation");
  });
});
