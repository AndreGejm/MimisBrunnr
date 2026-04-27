import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse, stringify } from "yaml";
import type {
  ActorRole,
  CompiledToolboxBand,
  CompiledToolboxPolicy,
  CompiledToolboxIntent,
  CompiledToolboxProfile,
  CompiledToolboxWorkflow,
  ToolboxBandCompatibilityProfileManifest,
  ToolboxBandManifest,
  ToolboxIntentManifest,
  ToolboxMutationLevel,
  ToolboxProfileManifest
} from "@mimir/contracts";
import { compileToolboxPolicyFromDirectory } from "./policy-compiler.js";

type JsonRecord = Record<string, unknown>;

const MUTATION_LEVEL_RANK: Record<ToolboxMutationLevel, number> = {
  read: 10,
  write: 20,
  admin: 30
};

export interface ScaffoldToolboxCompatibilityProfileInput {
  id: string;
  displayName: string;
  additionalBands: string[];
  compositeReason?: string;
  fallbackProfile?: string;
  summary?: string;
  exampleTasks?: string[];
}

export interface ScaffoldToolboxWorkflowInput {
  manifestDirectory: string;
  workflowId: string;
  displayName: string;
  includeBands: string[];
  summary?: string;
  exampleTasks?: string[];
  fallbackProfile?: string;
  sessionMode?: "toolbox-bootstrap" | "toolbox-activated";
  compositeReason?: string;
  preferredActorRoles?: ActorRole[];
  autoExpand?: boolean;
  requiresApproval?: boolean;
  overwrite?: boolean;
}

export interface ScaffoldToolboxBandInput {
  manifestDirectory: string;
  bandId: string;
  displayName: string;
  serverIds: string[];
  summary?: string;
  exampleTasks?: string[];
  trustClass?: string;
  mutationLevel?: ToolboxMutationLevel;
  autoExpand?: boolean;
  requiresApproval?: boolean;
  preferredActorRoles?: ActorRole[];
  allowedCategories?: string[];
  deniedCategories?: string[];
  fallbackProfile?: string;
  sessionMode?: "toolbox-bootstrap" | "toolbox-activated";
  taskAware?: boolean;
  idleTimeoutSeconds?: number;
  onLeaseExpiry?: boolean;
  compatibilityProfiles?: ScaffoldToolboxCompatibilityProfileInput[];
  overwrite?: boolean;
}

export interface ScaffoldToolboxBandResult {
  manifestDirectory: string;
  bandFile: string;
  profileFile: string;
  intentsFile: string;
  createdBandId: string;
  createdProfileId: string;
  createdIntentIds: string[];
  compatibilityProfileIds: string[];
  manifestRevision: string;
}

export interface ScaffoldToolboxWorkflowResult {
  manifestDirectory: string;
  workflowFile: string;
  intentsFile: string;
  createdWorkflowId: string;
  createdProfileId: string;
  createdIntentIds: string[];
  manifestRevision: string;
}

export type ScaffoldToolboxInput =
  | ({ mode: "toolbox" } & ScaffoldToolboxBandInput)
  | ({ mode: "workflow" } & ScaffoldToolboxWorkflowInput);

export type ScaffoldToolboxResult =
  | ({ mode: "toolbox" } & ScaffoldToolboxBandResult)
  | ({ mode: "workflow" } & ScaffoldToolboxWorkflowResult);

export interface ToolboxServerChoiceSummary {
  id: string;
  displayName: string;
  source: CompiledToolboxPolicy["servers"][string]["source"];
  kind: CompiledToolboxPolicy["servers"][string]["kind"];
  usageClass: CompiledToolboxPolicy["servers"][string]["usageClass"];
  trustClass: string;
  mutationLevel: ToolboxMutationLevel;
  runtimeBindingKind?: string;
  dockerApplyMode?: string;
  categories: string[];
  semanticCapabilities: string[];
  toolIds: string[];
  toolCount: number;
}

export interface PreviewScaffoldToolboxResult {
  manifestDirectory: string;
  mode: "toolbox" | "workflow";
  targetProfileId: string;
  manifestRevision: string;
  filesWouldWrite: string[];
  band?: CompiledToolboxBand;
  workflow?: CompiledToolboxWorkflow;
  profile: CompiledToolboxProfile;
  intent: CompiledToolboxIntent;
}

export async function scaffoldToolboxBand(
  input: ScaffoldToolboxBandInput
): Promise<ScaffoldToolboxBandResult> {
  const manifestDirectory = path.resolve(input.manifestDirectory);
  const policy = compileToolboxPolicyFromDirectory(manifestDirectory);
  const overwrite = input.overwrite === true;
  const bandId = normalizeId(input.bandId, "bandId");
  const displayName = requireNonEmpty(input.displayName, "displayName");
  const serverIds = uniqueSorted(input.serverIds.map((value) => normalizeId(value, "serverIds")));
  if (serverIds.length === 0) {
    throw new Error("At least one serverId is required to scaffold a toolbox band.");
  }

  const existingBandPath = path.join(manifestDirectory, "bands", `${bandId}.yaml`);
  const profileId = bandId;
  const profilePath = path.join(manifestDirectory, "profiles", `${profileId}.yaml`);
  if (!overwrite) {
    if (policy.bands[bandId]) {
      throw new Error(`Band '${bandId}' already exists.`);
    }
    if (policy.profiles[profileId]) {
      throw new Error(`Profile '${profileId}' already exists.`);
    }
  }

  const servers = serverIds.map((serverId) => {
    const server = policy.servers[serverId];
    if (!server) {
      throw new Error(`Unknown server '${serverId}' in scaffold request.`);
    }
    return server;
  });

  const allowedCategories = uniqueSorted(
    input.allowedCategories?.length
      ? input.allowedCategories.map((value) => normalizeId(value, "allowedCategories"))
      : servers.flatMap((server) => server.tools.map((tool) => tool.category))
  );
  const deniedCategories = uniqueSorted(
    (input.deniedCategories ?? []).map((value) => normalizeId(value, "deniedCategories"))
  );
  const trustClass = input.trustClass?.trim() || deriveTrustClass(policy, servers, allowedCategories);
  const mutationLevel = input.mutationLevel || deriveMutationLevel(policy, servers, allowedCategories);
  const preferredActorRoles = uniqueSorted(input.preferredActorRoles ?? []);
  const fallbackProfile = input.fallbackProfile?.trim() || "bootstrap";
  const compatibilityProfiles = (input.compatibilityProfiles ?? []).map((profile) => ({
    id: normalizeId(profile.id, "compatibilityProfiles.id"),
    displayName: requireNonEmpty(profile.displayName, "compatibilityProfiles.displayName"),
    additionalBands: uniqueSorted(
      profile.additionalBands.map((value) => normalizeId(value, "compatibilityProfiles.additionalBands"))
    ),
    compositeReason: profile.compositeReason?.trim() || "repeated_workflow",
    fallbackProfile: profile.fallbackProfile?.trim() || fallbackProfile,
    summary: profile.summary?.trim(),
    exampleTasks: profile.exampleTasks?.map((value) => value.trim()).filter(Boolean) ?? []
  }));
  for (const compatibilityProfile of compatibilityProfiles) {
    if (!overwrite && policy.profiles[compatibilityProfile.id]) {
      throw new Error(`Compatibility profile '${compatibilityProfile.id}' already exists.`);
    }
    for (const additionalBandId of compatibilityProfile.additionalBands) {
      if (!policy.bands[additionalBandId] && additionalBandId !== bandId) {
        throw new Error(
          `Compatibility profile '${compatibilityProfile.id}' references unknown additional band '${additionalBandId}'.`
        );
      }
    }
  }

  const bandManifest: { band: ToolboxBandManifest } = {
    band: {
      id: bandId,
      displayName,
      trustClass,
      mutationLevel,
      autoExpand: input.autoExpand === true,
      requiresApproval: input.requiresApproval === true,
      ...(preferredActorRoles.length > 0 ? { preferredActorRoles } : {}),
      includeServers: serverIds,
      allowedCategories,
      deniedCategories,
      contraction: {
        taskAware: input.taskAware ?? bandId !== "bootstrap",
        ...(input.idleTimeoutSeconds ? { idleTimeoutSeconds: input.idleTimeoutSeconds } : {}),
        onLeaseExpiry: input.onLeaseExpiry ?? true
      },
      ...(compatibilityProfiles.length > 0
        ? {
            compatibilityProfiles: compatibilityProfiles.map((profile): ToolboxBandCompatibilityProfileManifest => ({
              id: profile.id,
              displayName: profile.displayName,
              additionalBands: profile.additionalBands,
              compositeReason: profile.compositeReason,
              fallbackProfile: profile.fallbackProfile
            }))
          }
        : {})
    }
  };

  const profileManifest: { profile: ToolboxProfileManifest } = {
    profile: {
      id: profileId,
      displayName,
      sessionMode:
        input.sessionMode
        ?? (bandId === "bootstrap" ? "toolbox-bootstrap" : "toolbox-activated"),
      includeBands: [bandId],
      fallbackProfile
    }
  };

  const intentsPath = path.join(manifestDirectory, "intents.yaml");
  const intentsDocument = await readYamlFile(intentsPath);
  const intentsRoot = ensureRecord(intentsDocument, "intents.yaml");
  const intents = ensureRecord(intentsRoot.intents, "intents");
  assertIntentIdsAvailable(
    intents,
    [profileId, ...compatibilityProfiles.map((profile) => profile.id)],
    overwrite
  );

  await mkdir(path.dirname(existingBandPath), { recursive: true });
  await mkdir(path.dirname(profilePath), { recursive: true });
  await writeYamlFile(existingBandPath, bandManifest);
  await writeYamlFile(profilePath, profileManifest);

  const refreshedPolicy = compileToolboxPolicyFromDirectory(manifestDirectory);

  setIntentEntry(
    intents,
    profileId,
    buildIntentManifest({
      policy: refreshedPolicy,
      profileId,
      displayName,
      summary:
        input.summary?.trim()
        || `${displayName} toolbox for focused MCP access.`,
      exampleTasks:
        input.exampleTasks?.map((value) => value.trim()).filter(Boolean)
        || [`Use ${displayName} tools in a focused session.`],
      fallbackProfile,
      requiresApproval: input.requiresApproval === true
    }),
    overwrite
  );

  for (const compatibilityProfile of compatibilityProfiles) {
    setIntentEntry(
      intents,
      compatibilityProfile.id,
      buildIntentManifest({
        policy: refreshedPolicy,
        profileId: compatibilityProfile.id,
        displayName: compatibilityProfile.displayName,
        summary:
          compatibilityProfile.summary
          || `Composite toolbox combining ${displayName} with ${compatibilityProfile.additionalBands.join(", ")}.`,
        exampleTasks:
          compatibilityProfile.exampleTasks.length > 0
            ? compatibilityProfile.exampleTasks
            : [`Use ${compatibilityProfile.displayName} for a repeated multi-band workflow.`],
        fallbackProfile: compatibilityProfile.fallbackProfile,
        requiresApproval: undefined
      }),
      overwrite
    );
  }

  await writeYamlFile(intentsPath, { intents: sortRecord(intents) });
  const finalPolicy = compileToolboxPolicyFromDirectory(manifestDirectory);
  return {
    manifestDirectory,
    bandFile: existingBandPath,
    profileFile: profilePath,
    intentsFile: intentsPath,
    createdBandId: bandId,
    createdProfileId: profileId,
    createdIntentIds: [profileId, ...compatibilityProfiles.map((profile) => profile.id)],
    compatibilityProfileIds: compatibilityProfiles.map((profile) => profile.id),
    manifestRevision: finalPolicy.manifestRevision
  };
}

export async function scaffoldToolbox(
  input: ScaffoldToolboxInput
): Promise<ScaffoldToolboxResult> {
  if (input.mode === "workflow") {
    const result = await scaffoldToolboxWorkflow(input);
    return {
      mode: "workflow",
      ...result
    };
  }

  const result = await scaffoldToolboxBand(input);
  return {
    mode: "toolbox",
    ...result
  };
}

export function listToolboxServers(
  manifestDirectory: string
): {
  manifestDirectory: string;
  manifestRevision: string;
  servers: ToolboxServerChoiceSummary[];
} {
  const resolvedManifestDirectory = path.resolve(manifestDirectory);
  const policy = compileToolboxPolicyFromDirectory(resolvedManifestDirectory);
  return {
    manifestDirectory: resolvedManifestDirectory,
    manifestRevision: policy.manifestRevision,
    servers: Object.values(policy.servers)
      .map((server) => ({
        id: server.id,
        displayName: server.displayName,
        source: server.source,
        kind: server.kind,
        usageClass: server.usageClass ?? "general",
        trustClass: server.trustClass,
        mutationLevel: server.mutationLevel,
        runtimeBindingKind: server.runtimeBinding?.kind,
        dockerApplyMode: server.dockerRuntime?.applyMode,
        categories: uniqueSorted(server.tools.map((tool) => tool.category)),
        semanticCapabilities: uniqueSorted(
          server.tools.map((tool) => tool.semanticCapabilityId)
        ),
        toolIds: uniqueSorted(server.tools.map((tool) => tool.toolId)),
        toolCount: server.tools.length
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  };
}

export async function previewScaffoldToolbox(
  input: ScaffoldToolboxInput
): Promise<PreviewScaffoldToolboxResult> {
  const manifestDirectory = path.resolve(input.manifestDirectory);
  const previewRoot = await mkdtemp(path.join(os.tmpdir(), "mimir-toolbox-preview-"));
  const previewManifestDirectory = path.join(previewRoot, "manifests");
  await cp(manifestDirectory, previewManifestDirectory, { recursive: true });

  try {
    const previewInput = {
      ...input,
      manifestDirectory: previewManifestDirectory
    } as ScaffoldToolboxInput;
    const scaffoldResult = await scaffoldToolbox(previewInput);
    const policy = compileToolboxPolicyFromDirectory(previewManifestDirectory);
    const targetProfileId = scaffoldResult.createdProfileId;
    const profile = policy.profiles[targetProfileId];
    const intent = policy.intents[targetProfileId];
    if (!profile) {
      throw new Error(`Preview profile '${targetProfileId}' was not generated.`);
    }
    if (!intent) {
      throw new Error(`Preview intent '${targetProfileId}' was not generated.`);
    }

    return {
      manifestDirectory,
      mode: scaffoldResult.mode,
      targetProfileId,
      manifestRevision: policy.manifestRevision,
      filesWouldWrite:
        scaffoldResult.mode === "workflow"
          ? [
              path.join(manifestDirectory, "workflows", `${scaffoldResult.createdWorkflowId}.yaml`),
              path.join(manifestDirectory, "intents.yaml")
            ]
          : [
              path.join(manifestDirectory, "bands", `${scaffoldResult.createdBandId}.yaml`),
              path.join(manifestDirectory, "profiles", `${scaffoldResult.createdProfileId}.yaml`),
              path.join(manifestDirectory, "intents.yaml")
            ],
      ...(scaffoldResult.mode === "workflow"
        ? {
            workflow: policy.workflows[scaffoldResult.createdWorkflowId]
          }
        : {
            band: policy.bands[scaffoldResult.createdBandId]
          }),
      profile,
      intent
    };
  } finally {
    await rm(previewRoot, { recursive: true, force: true });
  }
}

export async function scaffoldToolboxWorkflow(
  input: ScaffoldToolboxWorkflowInput
): Promise<ScaffoldToolboxWorkflowResult> {
  const manifestDirectory = path.resolve(input.manifestDirectory);
  const policy = compileToolboxPolicyFromDirectory(manifestDirectory);
  const overwrite = input.overwrite === true;
  const workflowId = normalizeId(input.workflowId, "workflowId");
  const displayName = requireNonEmpty(input.displayName, "displayName");
  const includeBands = uniqueSorted(input.includeBands.map((value) => normalizeId(value, "includeBands")));
  if (includeBands.length === 0) {
    throw new Error("At least one band id is required to scaffold a toolbox workflow.");
  }

  for (const bandId of includeBands) {
    if (!policy.bands[bandId]) {
      throw new Error(`Unknown band '${bandId}' in workflow scaffold request.`);
    }
  }

  const workflowPath = path.join(manifestDirectory, "workflows", `${workflowId}.yaml`);
  if (!overwrite) {
    if (policy.workflows[workflowId]) {
      throw new Error(`Workflow '${workflowId}' already exists.`);
    }
    if (policy.profiles[workflowId]) {
      throw new Error(`Profile '${workflowId}' already exists.`);
    }
  }

  const fallbackProfile = input.fallbackProfile?.trim() || "bootstrap";
  const workflowManifest = {
    workflow: {
      id: workflowId,
      displayName,
      includeBands,
      compositeReason: input.compositeReason?.trim() || "repeated_workflow",
      fallbackProfile,
      ...(input.sessionMode ? { sessionMode: input.sessionMode } : {}),
      ...(input.preferredActorRoles?.length
        ? { preferredActorRoles: uniqueSorted(input.preferredActorRoles) }
        : {}),
      ...(input.autoExpand !== undefined ? { autoExpand: input.autoExpand } : {}),
      ...(input.requiresApproval !== undefined ? { requiresApproval: input.requiresApproval } : {})
    }
  };

  const intentsPath = path.join(manifestDirectory, "intents.yaml");
  const intentsDocument = await readYamlFile(intentsPath);
  const intentsRoot = ensureRecord(intentsDocument, "intents.yaml");
  const intents = ensureRecord(intentsRoot.intents, "intents");
  assertIntentIdsAvailable(intents, [workflowId], overwrite);

  await mkdir(path.dirname(workflowPath), { recursive: true });
  await writeYamlFile(workflowPath, workflowManifest);

  const refreshedPolicy = compileToolboxPolicyFromDirectory(manifestDirectory);
  setIntentEntry(
    intents,
    workflowId,
    buildIntentManifest({
      policy: refreshedPolicy,
      profileId: workflowId,
      displayName,
      summary:
        input.summary?.trim()
        || `${displayName} workflow for repeated multi-band MCP access.`,
      exampleTasks:
        input.exampleTasks?.map((value) => value.trim()).filter(Boolean)
        || [`Use ${displayName} for a repeated multi-band workflow.`],
      fallbackProfile,
      requiresApproval: input.requiresApproval
    }),
    overwrite
  );

  await writeYamlFile(intentsPath, { intents: sortRecord(intents) });
  const finalPolicy = compileToolboxPolicyFromDirectory(manifestDirectory);
  return {
    manifestDirectory,
    workflowFile: workflowPath,
    intentsFile: intentsPath,
    createdWorkflowId: workflowId,
    createdProfileId: workflowId,
    createdIntentIds: [workflowId],
    manifestRevision: finalPolicy.manifestRevision
  };
}

function buildIntentManifest(input: {
  policy: CompiledToolboxPolicy;
  profileId: string;
  displayName: string;
  summary: string;
  exampleTasks: string[];
  fallbackProfile: string;
  requiresApproval?: boolean;
}): ToolboxIntentManifest {
  const profile = input.policy.profiles[input.profileId];
  if (!profile) {
    throw new Error(`Profile '${input.profileId}' was not generated by the scaffolded toolbox manifest.`);
  }

  const trustClass = deriveTrustClassForProfile(input.policy, profile);
  const requiresApproval =
    input.requiresApproval
    ?? profile.includeBands.some((bandId) => input.policy.bands[bandId]?.requiresApproval);

  return {
    displayName: input.displayName,
    summary: input.summary,
    exampleTasks: input.exampleTasks,
    targetProfile: profile.id,
    trustClass,
    requiresApproval,
    activationMode: "session-switch",
    allowedCategories: profile.allowedCategories,
    deniedCategories: profile.deniedCategories,
    fallbackProfile: input.fallbackProfile
  };
}

function deriveTrustClass(
  policy: CompiledToolboxPolicy,
  servers: Array<CompiledToolboxPolicy["servers"][string]>,
  allowedCategories: string[]
): string {
  const candidateTrustClasses = [
    ...servers.map((server) => server.trustClass),
    ...allowedCategories.map((categoryId) => policy.categories[categoryId]?.trustClass).filter(Boolean)
  ];
  return candidateTrustClasses
    .slice()
    .sort((left, right) =>
      (policy.trustClasses[right]?.level ?? Number.MIN_SAFE_INTEGER)
      - (policy.trustClasses[left]?.level ?? Number.MIN_SAFE_INTEGER)
    )[0] ?? "local-read";
}

function deriveTrustClassForProfile(
  policy: CompiledToolboxPolicy,
  profile: CompiledToolboxPolicy["profiles"][string]
): string {
  return profile.allowedCategories
    .map((categoryId) => policy.categories[categoryId]?.trustClass)
    .filter(Boolean)
    .sort((left, right) =>
      (policy.trustClasses[right]?.level ?? Number.MIN_SAFE_INTEGER)
      - (policy.trustClasses[left]?.level ?? Number.MIN_SAFE_INTEGER)
    )[0] ?? "local-read";
}

function deriveMutationLevel(
  policy: CompiledToolboxPolicy,
  servers: Array<CompiledToolboxPolicy["servers"][string]>,
  allowedCategories: string[]
): ToolboxMutationLevel {
  return [
    ...servers.map((server) => server.mutationLevel),
    ...allowedCategories.map((categoryId) => policy.categories[categoryId]?.mutationLevel).filter(Boolean)
  ].sort((left, right) => MUTATION_LEVEL_RANK[right] - MUTATION_LEVEL_RANK[left])[0] ?? "read";
}

function setIntentEntry(
  intents: Record<string, unknown>,
  intentId: string,
  entry: ToolboxIntentManifest,
  overwrite: boolean
): void {
  if (!overwrite && intents[intentId] !== undefined) {
    throw new Error(`Intent '${intentId}' already exists.`);
  }
  intents[intentId] = entry;
}

function assertIntentIdsAvailable(
  intents: Record<string, unknown>,
  intentIds: string[],
  overwrite: boolean
): void {
  if (overwrite) {
    return;
  }
  for (const intentId of intentIds) {
    if (intents[intentId] !== undefined) {
      throw new Error(`Intent '${intentId}' already exists.`);
    }
  }
}

async function readYamlFile(filePath: string): Promise<JsonRecord> {
  const raw = await readFile(filePath, "utf8");
  const parsed = parse(raw) as unknown;
  return ensureRecord(parsed, filePath);
}

async function writeYamlFile(filePath: string, value: JsonRecord): Promise<void> {
  await writeFile(filePath, stringify(value), "utf8");
}

function ensureRecord(value: unknown, field: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected '${field}' to be a record.`);
  }
  return value as JsonRecord;
}

function normalizeId(value: string, field: string): string {
  const normalized = requireNonEmpty(value, field);
  if (!/^[A-Za-z0-9+._-]+$/.test(normalized)) {
    throw new Error(`Field '${field}' must contain only letters, numbers, '.', '+', '_' or '-'.`);
  }
  return normalized;
}

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Field '${field}' must be a non-empty string.`);
  }
  return normalized;
}

function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort();
}

function sortRecord<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  );
}
