import { CLI_RUNTIME_COMMAND_NAMES, type ActorRole, type RuntimeCliCommandName } from "@mimir/contracts";

export type ToolKind = "cli" | "coding_agent" | "repo_indexer" | "mcp_server";
export type ToolMountAccess = "none" | "read_only" | "read_write";
export type ToolMemoryWritePolicy = "none" | "session_only" | "draft_note_only";

export interface ToolManifest {
  id: string;
  displayName: string;
  kind: ToolKind;
  image: string;
  dockerProfile: string;
  entrypoint: string[];
  capabilities: string[];
  mounts: {
    workspace: ToolMountAccess;
    cache: ToolMountAccess;
    mimisbrunnr: ToolMountAccess;
  };
  memoryWritePolicy: ToolMemoryWritePolicy;
  allowedMimirCommands: RuntimeCliCommandName[];
  authRole: ActorRole;
  requiresOperatorReview: boolean;
  healthcheck: {
    command: string[];
  };
  environment?: Record<string, string>;
}

const TOOL_KINDS = new Set<ToolKind>(["cli", "coding_agent", "repo_indexer", "mcp_server"]);
const MOUNT_ACCESSES = new Set<ToolMountAccess>(["none", "read_only", "read_write"]);
const MEMORY_WRITE_POLICIES = new Set<ToolMemoryWritePolicy>([
  "none",
  "session_only",
  "draft_note_only"
]);
const ACTOR_ROLES = new Set<ActorRole>([
  "retrieval",
  "writer",
  "orchestrator",
  "system",
  "operator"
]);
const RUNTIME_CLI_COMMANDS = new Set<string>(CLI_RUNTIME_COMMAND_NAMES);
const TOOL_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export function validateToolManifest(value: unknown, source = "tool manifest"): ToolManifest {
  const manifest = requireObject(value, source);
  const id = requirePattern(manifest.id, "id", TOOL_ID_PATTERN);
  const mounts = validateMounts(manifest.mounts);
  if (mounts.mimisbrunnr !== "none") {
    throw new Error("mimisbrunnr mount must be none; tools must use governed Mimir commands instead");
  }

  return {
    id,
    displayName: requireString(manifest.displayName, "displayName"),
    kind: requireEnum(manifest.kind, "kind", TOOL_KINDS),
    image: requireString(manifest.image, "image"),
    dockerProfile: requirePattern(manifest.dockerProfile, "dockerProfile", TOOL_ID_PATTERN),
    entrypoint: requireStringArray(manifest.entrypoint, "entrypoint", { minItems: 1 }),
    capabilities: requireStringArray(manifest.capabilities, "capabilities", { minItems: 1 }),
    mounts,
    memoryWritePolicy: requireEnum(
      manifest.memoryWritePolicy,
      "memoryWritePolicy",
      MEMORY_WRITE_POLICIES
    ),
    allowedMimirCommands: requireRuntimeCliCommandArray(
      manifest.allowedMimirCommands,
      "allowedMimirCommands"
    ),
    authRole: requireEnum(manifest.authRole, "authRole", ACTOR_ROLES),
    requiresOperatorReview: requireBoolean(manifest.requiresOperatorReview, "requiresOperatorReview"),
    healthcheck: validateHealthcheck(manifest.healthcheck),
    environment: optionalStringRecord(manifest.environment, "environment")
  };
}

export function manifestCandidateIds(candidate: {
  fileName: string;
  toolId?: string;
}): string[] {
  const fileStem = candidate.fileName.endsWith(".json")
    ? candidate.fileName.slice(0, -".json".length)
    : candidate.fileName;
  return [...new Set([candidate.toolId, fileStem].filter(isNonEmptyString))];
}

export function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function validateMounts(value: unknown): ToolManifest["mounts"] {
  const mounts = requireObject(value, "mounts");
  return {
    workspace: requireEnum(mounts.workspace, "mounts.workspace", MOUNT_ACCESSES),
    cache: requireEnum(mounts.cache, "mounts.cache", MOUNT_ACCESSES),
    mimisbrunnr: requireEnum(mounts.mimisbrunnr, "mounts.mimisbrunnr", MOUNT_ACCESSES)
  };
}

function validateHealthcheck(value: unknown): ToolManifest["healthcheck"] {
  const healthcheck = requireObject(value, "healthcheck");
  return {
    command: requireStringArray(healthcheck.command, "healthcheck.command", { minItems: 1 })
  };
}

function requireRuntimeCliCommandArray(value: unknown, field: string): RuntimeCliCommandName[] {
  const commands = requireStringArray(value, field);
  return commands.map((command, index) => {
    if (!RUNTIME_CLI_COMMANDS.has(command)) {
      throw new Error(`${field}[${index}] must be a runtime CLI command`);
    }

    return command as RuntimeCliCommandName;
  });
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be a JSON object`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }

  return value;
}

function requirePattern(value: unknown, field: string, pattern: RegExp): string {
  const stringValue = requireString(value, field);
  if (!pattern.test(stringValue)) {
    throw new Error(`${field} must match ${pattern}`);
  }

  return stringValue;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }

  return value;
}

function requireEnum<T extends string>(
  value: unknown,
  field: string,
  allowedValues: ReadonlySet<T>
): T {
  const stringValue = requireString(value, field);
  if (!allowedValues.has(stringValue as T)) {
    throw new Error(`${field} must be one of ${[...allowedValues].join(", ")}`);
  }

  return stringValue as T;
}

function requireStringArray(
  value: unknown,
  field: string,
  options: { minItems?: number } = {}
): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  if (options.minItems !== undefined && value.length < options.minItems) {
    throw new Error(`${field} must contain at least ${options.minItems} item(s)`);
  }

  return value.map((item, index) => requireString(item, `${field}[${index}]`));
}

function optionalStringRecord(
  value: unknown,
  field: string
): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = requireObject(value, field);
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, requireString(item, `${field}.${key}`)])
  );
}