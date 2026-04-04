import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_WORKSPACE_ROOT = fileURLToPath(
  new URL("../../../../", import.meta.url)
);
const WORKSPACE_PACKAGE_JSON_PATH = path.join(DEFAULT_WORKSPACE_ROOT, "package.json");
const DEFAULT_APPLICATION_NAME = "multi-agent-brain";
const DEFAULT_VERSION = "0.0.0-dev";

export interface ReleaseMetadata {
  applicationName: string;
  version: string;
  gitTag?: string;
  gitCommit?: string;
  releaseChannel: string;
  source: "package_json" | "environment";
}

export function loadReleaseMetadata(
  env: NodeJS.ProcessEnv = process.env
): ReleaseMetadata {
  const workspacePackage = readWorkspacePackage();
  const versionOverride = trimToUndefined(env.MAB_RELEASE_VERSION);
  const gitTag = trimToUndefined(env.MAB_GIT_TAG);
  const gitCommit = trimToUndefined(env.MAB_GIT_COMMIT);

  return {
    applicationName: workspacePackage.name ?? DEFAULT_APPLICATION_NAME,
    version: versionOverride ?? workspacePackage.version ?? DEFAULT_VERSION,
    gitTag,
    gitCommit,
    releaseChannel:
      trimToUndefined(env.MAB_RELEASE_CHANNEL) ?? (gitTag ? "tagged" : "workspace"),
    source: versionOverride ? "environment" : "package_json"
  };
}

function readWorkspacePackage(): { name?: string; version?: string } {
  try {
    const raw = readFileSync(WORKSPACE_PACKAGE_JSON_PATH, "utf8");
    const parsed = JSON.parse(raw) as { name?: unknown; version?: unknown };

    return {
      name:
        typeof parsed.name === "string" && parsed.name.trim()
          ? parsed.name.trim()
          : DEFAULT_APPLICATION_NAME,
      version:
        typeof parsed.version === "string" && parsed.version.trim()
          ? parsed.version.trim()
          : DEFAULT_VERSION
    };
  } catch {
    return {
      name: DEFAULT_APPLICATION_NAME,
      version: DEFAULT_VERSION
    };
  }
}

function trimToUndefined(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
