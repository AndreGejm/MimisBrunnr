import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRuntimeOwnership,
  type RuntimeOwnershipClock
} from "../../src/runtime/runtime-ownership.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const path = tempDirs.pop();

    if (path) {
      rmSync(path, { recursive: true, force: true });
    }
  }
});

function createTempStateRoot() {
  const stateRoot = mkdtempSync(join(tmpdir(), "runtime-ownership-"));
  tempDirs.push(stateRoot);
  return stateRoot;
}

function createClock(startIso: string): RuntimeOwnershipClock {
  let now = new Date(startIso);

  return {
    now: () => new Date(now),
    advanceByMs: (ms: number) => {
      now = new Date(now.getTime() + ms);
    }
  };
}

describe("createRuntimeOwnership", () => {
  it("acquires ownership when no workspace runtime record exists", () => {
    const ownership = createRuntimeOwnership({
      stateRoot: createTempStateRoot(),
      workspaceRoot: "F:/Dev/scripts/Mimir",
      ownerId: "owner-a",
      pid: 1001
    });

    const result = ownership.acquire();

    expect(result.status).toBe("acquired");
    expect(result.record.ownerId).toBe("owner-a");
    expect(ownership.readCurrent()?.ownerId).toBe("owner-a");
  });

  it("returns the existing live owner when another runtime already holds the workspace", () => {
    const stateRoot = createTempStateRoot();
    const first = createRuntimeOwnership({
      stateRoot,
      workspaceRoot: "F:/Dev/scripts/Mimir",
      ownerId: "owner-a",
      pid: 1001
    });
    const second = createRuntimeOwnership({
      stateRoot,
      workspaceRoot: "F:/Dev/scripts/Mimir",
      ownerId: "owner-b",
      pid: 1002
    });

    first.acquire();
    const result = second.acquire();

    expect(result.status).toBe("existing_healthy");
    expect(result.record.ownerId).toBe("owner-a");
  });

  it("reclaims a stale workspace runtime record", () => {
    const stateRoot = createTempStateRoot();
    const clock = createClock("2026-04-25T08:00:00.000Z");
    const first = createRuntimeOwnership({
      stateRoot,
      workspaceRoot: "F:/Dev/scripts/Mimir",
      ownerId: "owner-a",
      pid: 1001,
      staleAfterMs: 30_000,
      clock
    });
    const second = createRuntimeOwnership({
      stateRoot,
      workspaceRoot: "F:/Dev/scripts/Mimir",
      ownerId: "owner-b",
      pid: 1002,
      staleAfterMs: 30_000,
      clock
    });

    first.acquire();
    clock.advanceByMs?.(31_000);

    const result = second.acquire();

    expect(result.status).toBe("reclaimed_stale");
    expect(result.record.ownerId).toBe("owner-b");
  });

  it("refreshes heartbeat timestamps for the current owner", () => {
    const clock = createClock("2026-04-25T08:00:00.000Z");
    const ownership = createRuntimeOwnership({
      stateRoot: createTempStateRoot(),
      workspaceRoot: "F:/Dev/scripts/Mimir",
      ownerId: "owner-a",
      pid: 1001,
      staleAfterMs: 30_000,
      clock
    });

    ownership.acquire();
    clock.advanceByMs?.(5_000);
    const heartbeat = ownership.heartbeat();

    expect(heartbeat?.heartbeatAt).toBe("2026-04-25T08:00:05.000Z");
  });

  it("releases ownership only for the current owner", () => {
    const stateRoot = createTempStateRoot();
    const first = createRuntimeOwnership({
      stateRoot,
      workspaceRoot: "F:/Dev/scripts/Mimir",
      ownerId: "owner-a",
      pid: 1001
    });
    const second = createRuntimeOwnership({
      stateRoot,
      workspaceRoot: "F:/Dev/scripts/Mimir",
      ownerId: "owner-b",
      pid: 1002
    });

    first.acquire();

    expect(second.release()).toBe(false);
    expect(first.release()).toBe(true);
    expect(first.readCurrent()).toBeUndefined();
  });
});
