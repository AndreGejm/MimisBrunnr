import { resolve } from "node:path";
import type { ClientConfig } from "../config/schema.js";

export type ClientRuntimeHealth = "stopped" | "degraded" | "ready";
export type MimirConnectionState = "disconnected" | "degraded" | "connected";

export interface CreateClientStatusInput {
  workspaceRoot?: string;
  runtimeHealth?: ClientRuntimeHealth;
  mimirConnection?: MimirConnectionState;
}

export interface ClientStatus {
  configVersion: ClientConfig["configVersion"];
  mode: ClientConfig["runtime"]["mode"];
  workspaceTrusted: boolean;
  trustedWorkspaceRoots: string[];
  runtimeHealth: ClientRuntimeHealth;
  mimirConnection: MimirConnectionState;
  models: {
    primary: string;
    fallback: string[];
  };
  claude: {
    enabled: boolean;
    profileIds: string[];
    skillPackIds: string[];
  };
}

function normalizePathForComparison(pathValue: string): string {
  return resolve(pathValue).replace(/\\/g, "/").toLowerCase();
}

function isTrustedWorkspace(
  trustedWorkspaceRoots: string[],
  workspaceRoot?: string
): boolean {
  if (!workspaceRoot) {
    return false;
  }

  const normalizedWorkspaceRoot = normalizePathForComparison(workspaceRoot);

  return trustedWorkspaceRoots.some((trustedRoot) => {
    const normalizedTrustedRoot = normalizePathForComparison(trustedRoot);

    return (
      normalizedWorkspaceRoot === normalizedTrustedRoot ||
      normalizedWorkspaceRoot.startsWith(`${normalizedTrustedRoot}/`)
    );
  });
}

export function createClientStatus(
  config: ClientConfig,
  input: CreateClientStatusInput = {}
): ClientStatus {
  return {
    configVersion: config.configVersion,
    mode: config.runtime.mode,
    workspaceTrusted: isTrustedWorkspace(
      config.runtime.trustedWorkspaceRoots,
      input.workspaceRoot
    ),
    trustedWorkspaceRoots: config.runtime.trustedWorkspaceRoots,
    runtimeHealth: input.runtimeHealth ?? "stopped",
    mimirConnection: input.mimirConnection ?? "disconnected",
    models: {
      primary: config.models.primary,
      fallback: config.models.fallback
    },
    claude: {
      enabled: config.claude.enabled,
      profileIds: config.claude.profiles.map((profile) => profile.profileId),
      skillPackIds: config.claude.skillPacks.map(
        (skillPack) => skillPack.skillPackId
      )
    }
  };
}
