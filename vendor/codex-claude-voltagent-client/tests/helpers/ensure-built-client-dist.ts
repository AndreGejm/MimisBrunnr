import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dirname, "..", "..");
const distRoot = join(repoRoot, "dist");
const buildLockDir = join(repoRoot, ".tmp-vitest-build-lock");
const buildTargets = [
  join(repoRoot, "src"),
  join(repoRoot, "package.json"),
  join(repoRoot, "tsconfig.json"),
  join(repoRoot, "tsconfig.build.json")
];

function sleep(milliseconds: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function newestMtimeMs(pathValue: string): number {
  if (!existsSync(pathValue)) {
    return 0;
  }

  const stats = statSync(pathValue);

  if (!stats.isDirectory()) {
    return stats.mtimeMs;
  }

  let latest = stats.mtimeMs;

  for (const entry of readdirSync(pathValue, { withFileTypes: true })) {
    latest = Math.max(latest, newestMtimeMs(join(pathValue, entry.name)));
  }

  return latest;
}

function distIsFreshEnough() {
  const distEntry = join(distRoot, "index.js");

  if (!existsSync(distEntry)) {
    return false;
  }

  const newestSource = Math.max(...buildTargets.map(newestMtimeMs));
  const distMtime = newestMtimeMs(distEntry);

  return distMtime >= newestSource;
}

function acquireBuildLock() {
  const deadline = Date.now() + 120_000;

  while (true) {
    try {
      mkdirSync(buildLockDir);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (!message.toLowerCase().includes("exist")) {
        throw error;
      }
    }

    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the test build lock");
    }

    sleep(100);
  }
}

function releaseBuildLock() {
  rmSync(buildLockDir, { recursive: true, force: true });
}

export function ensureBuiltClientDist() {
  if (distIsFreshEnough()) {
    return;
  }

  acquireBuildLock();

  try {
    if (distIsFreshEnough()) {
      return;
    }

    execSync("pnpm build", {
      cwd: repoRoot,
      stdio: "pipe"
    });
  } finally {
    releaseBuildLock();
  }
}
