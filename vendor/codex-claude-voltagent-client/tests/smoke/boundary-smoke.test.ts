import { describe, expect, it } from "vitest";
import { classifyTaskRoute } from "../../src/router/client-task-router.js";

describe("Mimir/client boundary smoke", () => {
  it("keeps workspace-skill work on the client skill route", () => {
    expect(
      classifyTaskRoute({
        needsWorkspaceSkill: true
      })
    ).toBe("client-skill");
  });

  it("routes governed writes to the dedicated Mimir memory write path", () => {
    expect(
      classifyTaskRoute({
        needsGovernedWrite: true,
        needsWorkspaceSkill: true
      })
    ).toBe("mimir-memory-write");
  });
});
