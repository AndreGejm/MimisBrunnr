import path from "node:path";
import type { AppEnvironment } from "./app-environment.js";
import { DEFAULT_WORKSPACE_ROOT } from "./config-helpers.js";

export type ToolConfig = Pick<
  AppEnvironment,
  | "toolRegistryDir"
  | "toolboxManifestDir"
  | "toolboxActiveProfile"
  | "toolboxClientId"
  | "toolboxSessionMode"
  | "toolboxSessionEnforcement"
  | "toolboxLeaseIssuer"
  | "toolboxLeaseAudience"
  | "toolboxLeaseIssuerSecret"
>;

export function loadToolConfig(env: NodeJS.ProcessEnv = process.env): ToolConfig {
  const activeProfile = env.MAB_TOOLBOX_ACTIVE_PROFILE?.trim() || undefined;
  return {
    toolRegistryDir:
      env.MAB_TOOL_REGISTRY_DIR?.trim() ||
      path.join(DEFAULT_WORKSPACE_ROOT, "docker", "tool-registry"),
    toolboxManifestDir:
      env.MAB_TOOLBOX_MANIFEST_DIR?.trim() ||
      path.join(DEFAULT_WORKSPACE_ROOT, "docker", "mcp"),
    toolboxActiveProfile: activeProfile,
    toolboxClientId: env.MAB_TOOLBOX_CLIENT_ID?.trim() || undefined,
    toolboxSessionMode:
      (env.MAB_TOOLBOX_SESSION_MODE?.trim() as ToolConfig["toolboxSessionMode"] | undefined)
      ?? (activeProfile ? (activeProfile === "bootstrap" ? "toolbox-bootstrap" : "toolbox-activated") : "legacy-direct"),
    toolboxSessionEnforcement:
      (env.MAB_TOOLBOX_SESSION_ENFORCEMENT?.trim() as ToolConfig["toolboxSessionEnforcement"] | undefined)
      ?? (activeProfile ? "enforced" : "off"),
    toolboxLeaseIssuer: env.MAB_TOOLBOX_LEASE_ISSUER?.trim() || "mimir-control",
    toolboxLeaseAudience: env.MAB_TOOLBOX_LEASE_AUDIENCE?.trim() || "mimir-core",
    toolboxLeaseIssuerSecret: env.MAB_TOOLBOX_LEASE_ISSUER_SECRET?.trim() || undefined
  };
}

export function normalizeToolConfig(input: Partial<AppEnvironment>): ToolConfig {
  const activeProfile = input.toolboxActiveProfile;
  return {
    toolRegistryDir:
      input.toolRegistryDir ??
      path.join(DEFAULT_WORKSPACE_ROOT, "docker", "tool-registry"),
    toolboxManifestDir:
      input.toolboxManifestDir ??
      path.join(DEFAULT_WORKSPACE_ROOT, "docker", "mcp"),
    toolboxActiveProfile: activeProfile,
    toolboxClientId: input.toolboxClientId,
    toolboxSessionMode:
      input.toolboxSessionMode
      ?? (activeProfile ? (activeProfile === "bootstrap" ? "toolbox-bootstrap" : "toolbox-activated") : "legacy-direct"),
    toolboxSessionEnforcement:
      input.toolboxSessionEnforcement ?? (activeProfile ? "enforced" : "off"),
    toolboxLeaseIssuer: input.toolboxLeaseIssuer ?? "mimir-control",
    toolboxLeaseAudience: input.toolboxLeaseAudience ?? "mimir-core",
    toolboxLeaseIssuerSecret: input.toolboxLeaseIssuerSecret
  };
}
