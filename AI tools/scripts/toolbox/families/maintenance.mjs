import { stat } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_MAX_ITEMS, numberFlag, resolveRoot } from "../shared/args.mjs";
import { assertReadableDirectory, walk } from "../shared/filesystem.mjs";
import { baseEnvelope } from "../shared/output.mjs";

function classifyCleanupCandidate(relativePath, fileSizeBytes) {
  const normalized = relativePath.replace(/\\/gu, "/");
  const fileName = path.basename(normalized).toLowerCase();
  const extension = path.extname(fileName).toLowerCase();
  if (/^(tmp|temp|cache)\//iu.test(normalized) || [".tmp", ".temp", ".bak"].includes(extension)) {
    return {
      group: "safe_candidates",
      reason: "temporary_or_cache_file",
      path: normalized,
      size_bytes: fileSizeBytes
    };
  }
  if ([".log", ".old", ".orig"].includes(extension)) {
    return {
      group: "review_required",
      reason: "review_before_cleanup",
      path: normalized,
      size_bytes: fileSizeBytes
    };
  }
  return null;
}

export async function cleanupCandidates(flags) {
  const root = resolveRoot(flags);
  await assertReadableDirectory(root);
  const maxItems = numberFlag(flags, "max-items", DEFAULT_MAX_ITEMS);
  const safeCandidates = [];
  const reviewRequired = [];

  await walk(root, flags, async ({ fullPath, relativePath, entry }) => {
    if (!entry.isFile()) {
      return;
    }
    const fileStat = await stat(fullPath);
    const candidate = classifyCleanupCandidate(relativePath, fileStat.size);
    if (!candidate) {
      return;
    }
    if (candidate.group === "safe_candidates") {
      safeCandidates.push(candidate);
    } else {
      reviewRequired.push(candidate);
    }
  });

  const byPath = (left, right) => left.path.localeCompare(right.path);
  return baseEnvelope("cleanup-candidates", root, {
    dry_run: true,
    deleted_files: 0,
    safe_candidates: safeCandidates.sort(byPath).slice(0, maxItems).map(({ group, ...candidate }) => candidate),
    review_required: reviewRequired.sort(byPath).slice(0, maxItems).map(({ group, ...candidate }) => candidate),
    never_delete: [".git", "node_modules", "state", "vault"]
  });
}

export const maintenanceCommands = {
  "cleanup-candidates": cleanupCandidates
};
