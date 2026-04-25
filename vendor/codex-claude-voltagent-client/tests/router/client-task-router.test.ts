import { describe, expect, it, vi } from "vitest";
import { createMimirResultCache } from "../../src/cache/mimir-result-cache.js";
import { classifyTaskRoute } from "../../src/router/client-task-router.js";

describe("classifyTaskRoute", () => {
  it("routes governed writes to the dedicated Mimir memory write path", () => {
    expect(
      classifyTaskRoute({
        needsGovernedWrite: true,
        needsDurableMemory: true,
        needsLocalExecution: true,
        needsWorkspaceSkill: true
      })
    ).toBe("mimir-memory-write");
  });

  it("routes local execution to Mimir before workspace-skill or paid-runtime fallbacks", () => {
    expect(
      classifyTaskRoute({
        needsDurableMemory: true,
        needsLocalExecution: true,
        needsWorkspaceSkill: true
      })
    ).toBe("mimir-local-execution");
  });

  it("routes durable memory reads to Mimir retrieval when no stronger route applies", () => {
    expect(
      classifyTaskRoute({
        needsDurableMemory: true,
        needsWorkspaceSkill: true
      })
    ).toBe("mimir-retrieval");
  });

  it("routes workspace-skill-only work to the client skill path", () => {
    expect(
      classifyTaskRoute({
        needsWorkspaceSkill: true
      })
    ).toBe("client-skill");
  });

  it("falls back to the paid client runtime when no special routing is required", () => {
    expect(classifyTaskRoute({})).toBe("client-paid-runtime");
  });

  it("never introduces Workspace or workspace_* routes through Mimir", () => {
    const results = [
      classifyTaskRoute({ needsGovernedWrite: true }),
      classifyTaskRoute({ needsLocalExecution: true }),
      classifyTaskRoute({ needsDurableMemory: true }),
      classifyTaskRoute({ needsWorkspaceSkill: true }),
      classifyTaskRoute({})
    ];

    expect(results).toEqual([
      "mimir-memory-write",
      "mimir-local-execution",
      "mimir-retrieval",
      "client-skill",
      "client-paid-runtime"
    ]);
    expect(results.every((route) => !/workspace/i.test(route))).toBe(true);
  });
});

describe("createMimirResultCache", () => {
  it("returns a bounded ephemeral cache suitable for short-lived Mimir reads", () => {
    const cache = createMimirResultCache<string, string>();

    expect(cache.max).toBeGreaterThan(0);
    expect(cache.ttl).toBeGreaterThan(0);
    expect(cache.ttl).toBeLessThanOrEqual(60_000);
  });

  it("evicts least-recently-used entries once the cache reaches its bound", () => {
    const cache = createMimirResultCache<string, string>();

    for (let index = 0; index < cache.max; index += 1) {
      cache.set(`key-${index}`, `value-${index}`);
    }

    cache.get("key-0");
    cache.set("key-overflow", "value-overflow");

    expect(cache.get("key-0")).toBe("value-0");
    expect(cache.size).toBe(cache.max);
    expect(cache.get("key-1")).toBeUndefined();
    expect(cache.get("key-overflow")).toBe("value-overflow");
  });

  it("expires entries after a short TTL", () => {
    vi.useFakeTimers();

    const cache = createMimirResultCache<string, string>();
    cache.set("result", "cached");

    vi.advanceTimersByTime(cache.ttl + 1);

    expect(cache.get("result")).toBeUndefined();

    vi.useRealTimers();
  });
});
