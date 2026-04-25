import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { join, resolve } from "node:path";

export interface RuntimeOwnershipClock {
  now(): Date;
  advanceByMs?(ms: number): void;
}

export interface RuntimeOwnershipRecord {
  ownerId: string;
  pid: number;
  workspaceRoot: string;
  acquiredAt: string;
  heartbeatAt: string;
}

export interface RuntimeOwnershipOptions {
  stateRoot: string;
  workspaceRoot: string;
  ownerId: string;
  pid: number;
  staleAfterMs?: number;
  clock?: RuntimeOwnershipClock;
}

export interface RuntimeOwnershipAcquireResult {
  status: "acquired" | "existing_healthy" | "reclaimed_stale";
  record: RuntimeOwnershipRecord;
}

function createDefaultClock(): RuntimeOwnershipClock {
  return {
    now: () => new Date()
  };
}

function normalizeWorkspaceRoot(workspaceRoot: string): string {
  return resolve(workspaceRoot).replace(/\\/g, "/").toLowerCase();
}

function createStateFilePath(stateRoot: string, workspaceRoot: string): string {
  const stateId = createHash("sha256")
    .update(normalizeWorkspaceRoot(workspaceRoot))
    .digest("hex");

  return join(stateRoot, "runtime-ownership", `${stateId}.json`);
}

function readRecord(filePath: string): RuntimeOwnershipRecord | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }

  return JSON.parse(
    readFileSync(filePath, "utf8")
  ) as RuntimeOwnershipRecord;
}

function writeRecord(filePath: string, record: RuntimeOwnershipRecord): void {
  mkdirSync(resolve(filePath, ".."), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function isStale(
  record: RuntimeOwnershipRecord,
  clock: RuntimeOwnershipClock,
  staleAfterMs: number
): boolean {
  return clock.now().getTime() - new Date(record.heartbeatAt).getTime() >
    staleAfterMs;
}

function isOwnedByCurrentProcess(
  record: RuntimeOwnershipRecord,
  ownerId: string,
  pid: number
): boolean {
  return record.ownerId === ownerId && record.pid === pid;
}

export function createRuntimeOwnership(options: RuntimeOwnershipOptions) {
  const staleAfterMs = options.staleAfterMs ?? 60_000;
  const clock = options.clock ?? createDefaultClock();
  const workspaceRoot = resolve(options.workspaceRoot);
  const stateFilePath = createStateFilePath(options.stateRoot, workspaceRoot);

  function createRecord(): RuntimeOwnershipRecord {
    const nowIso = clock.now().toISOString();

    return {
      ownerId: options.ownerId,
      pid: options.pid,
      workspaceRoot,
      acquiredAt: nowIso,
      heartbeatAt: nowIso
    };
  }

  return {
    readCurrent(): RuntimeOwnershipRecord | undefined {
      return readRecord(stateFilePath);
    },

    acquire(): RuntimeOwnershipAcquireResult {
      const existing = readRecord(stateFilePath);

      if (!existing) {
        const record = createRecord();
        writeRecord(stateFilePath, record);
        return { status: "acquired", record };
      }

      if (isOwnedByCurrentProcess(existing, options.ownerId, options.pid)) {
        const record = {
          ...existing,
          heartbeatAt: clock.now().toISOString()
        };
        writeRecord(stateFilePath, record);
        return { status: "acquired", record };
      }

      if (isStale(existing, clock, staleAfterMs)) {
        const record = createRecord();
        writeRecord(stateFilePath, record);
        return { status: "reclaimed_stale", record };
      }

      return {
        status: "existing_healthy",
        record: existing
      };
    },

    heartbeat(): RuntimeOwnershipRecord | undefined {
      const existing = readRecord(stateFilePath);

      if (
        !existing ||
        !isOwnedByCurrentProcess(existing, options.ownerId, options.pid)
      ) {
        return undefined;
      }

      const record = {
        ...existing,
        heartbeatAt: clock.now().toISOString()
      };
      writeRecord(stateFilePath, record);
      return record;
    },

    release(): boolean {
      const existing = readRecord(stateFilePath);

      if (
        !existing ||
        !isOwnedByCurrentProcess(existing, options.ownerId, options.pid)
      ) {
        return false;
      }

      rmSync(stateFilePath, { force: true });
      return true;
    }
  };
}
