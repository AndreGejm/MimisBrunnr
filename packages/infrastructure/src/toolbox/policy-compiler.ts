import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type {
  ActorRole,
  CompiledToolboxBand,
  CompiledToolboxClientOverlay,
  CompiledToolboxPolicy,
  CompiledToolboxProfile,
  CompiledToolboxServer,
  CompiledToolboxToolDescriptor,
  CompiledToolboxIntent,
  CompiledToolboxWorkflow,
  ToolboxBandContractionManifest,
  ToolboxBandCompatibilityProfileManifest,
  ToolboxBandManifest,
  ToolboxCategoryManifest,
  ToolboxClientOverlayManifest,
  ToolboxDockerRuntimeManifest,
  ToolboxIntentManifest,
  ToolboxMutationLevel,
  ToolboxProfileManifest,
  ToolboxRuntimeBindingManifest,
  ToolboxServerUsageClass,
  ToolboxServerManifest,
  ToolboxWorkflowManifest,
  ToolboxTrustClassManifest
} from "@mimir/contracts";

type JsonRecord = Record<string, unknown>;

interface ToolboxManifestSet {
  categories: Record<string, ToolboxCategoryManifest>;
  trustClasses: Record<string, ToolboxTrustClassManifest>;
  servers: Record<string, ToolboxServerManifest>;
  bands: Record<string, ToolboxBandManifest>;
  workflows: Record<string, ToolboxWorkflowManifest>;
  profiles: Record<string, ToolboxProfileManifest>;
  intents: Record<string, ToolboxIntentManifest>;
  clients: Record<string, ToolboxClientOverlayManifest>;
}

const MUTATION_LEVELS = new Set<ToolboxMutationLevel>(["read", "write", "admin"]);
const PROFILE_SESSION_MODES = new Set(["toolbox-bootstrap", "toolbox-activated"]);
const SERVER_KINDS = new Set(["control", "semantic", "peer"]);
const SERVER_SOURCES = new Set(["owned", "peer"]);
const SERVER_USAGE_CLASSES = new Set(["general", "docs-only"]);
const DOCKER_APPLY_MODES = new Set(["catalog", "descriptor-only"]);
const RUNTIME_BINDING_KINDS = new Set(["docker-catalog", "descriptor-only", "local-stdio"]);
const ACTOR_ROLES = new Set(["retrieval", "writer", "orchestrator", "system", "operator"]);

export function compileToolboxPolicyFromDirectory(
  sourceDirectory: string
): CompiledToolboxPolicy {
  const manifests = loadToolboxManifestSet(sourceDirectory);
  validateToolboxManifestSet(manifests);

  const bands = compileBands(manifests);
  const workflows = compileWorkflows(manifests);
  const profiles = compileProfiles(manifests, bands);
  const clients = compileClients(manifests);
  const normalized = {
    sourceDirectory: path.resolve(sourceDirectory),
    categories: sortRecord(manifests.categories),
    trustClasses: sortRecord(manifests.trustClasses),
    servers: sortRecord(
      Object.fromEntries(
        Object.entries(manifests.servers).map(([serverId, server]) => [
          serverId,
          {
            ...server,
            tools: sortBy(
              server.tools.map((tool) => ({
                ...tool,
                serverId,
                source: server.source,
                availabilityState: "declared" as const
              })),
              (tool) => tool.toolId
            )
          } satisfies CompiledToolboxServer
        ])
      )
    ),
    bands: sortRecord(bands),
    workflows: sortRecord(workflows),
    profiles: sortRecord(profiles),
    intents: sortRecord(
      Object.fromEntries(
        Object.entries(manifests.intents).map(([intentId, intent]) => [
          intentId,
          { id: intentId, ...intent } satisfies CompiledToolboxIntent
        ])
      )
    ),
    clients: sortRecord(clients)
  };

  return {
    ...normalized,
    manifestRevision: hashStable(normalized)
  };
}

function loadToolboxManifestSet(sourceDirectory: string): ToolboxManifestSet {
  const root = path.resolve(sourceDirectory);
  const categoriesDocument = loadYamlDocument(path.join(root, "categories.yaml"));
  const trustClassesDocument = loadYamlDocument(path.join(root, "trust-classes.yaml"));
  const intentsDocument = loadYamlDocument(path.join(root, "intents.yaml"));
  const bands = loadOptionalManifestDirectory(path.join(root, "bands"), "band", readBand);
  const workflows = loadOptionalManifestDirectory(path.join(root, "workflows"), "workflow", readWorkflow);
  const authoredProfiles = loadManifestDirectory(path.join(root, "profiles"), "profile", readProfile);

  return {
    categories: readCategories(categoriesDocument),
    trustClasses: readTrustClasses(trustClassesDocument),
    servers: loadManifestDirectory(path.join(root, "servers"), "server", readServer),
    bands,
    workflows,
    profiles: mergeAuthoredAndDerivedProfiles(
      authoredProfiles,
      deriveProfilesFromBandsAndWorkflows(bands, workflows)
    ),
    intents: readIntents(intentsDocument),
    clients: loadManifestDirectory(path.join(root, "clients"), "client", readClient)
  };
}

function validateToolboxManifestSet(manifests: ToolboxManifestSet): void {
  const trustClassIds = new Set(Object.keys(manifests.trustClasses));
  const categoryIds = new Set(Object.keys(manifests.categories));
  const serverIds = new Set(Object.keys(manifests.servers));
  const bandIds = new Set(Object.keys(manifests.bands));
  const profileIds = new Set(Object.keys(manifests.profiles));

  for (const [categoryId, category] of Object.entries(manifests.categories)) {
    if (!trustClassIds.has(category.trustClass)) {
      throw new Error(`Category '${categoryId}' references unknown trust class '${category.trustClass}'.`);
    }
  }

  for (const [serverId, server] of Object.entries(manifests.servers)) {
    requireTrustClass(server.trustClass, trustClassIds, `server '${serverId}'`);
    requireMutationLevel(server.mutationLevel, `server '${serverId}'`);
    if (server.source === "peer" && server.kind !== "peer") {
      throw new Error(
        `Server '${serverId}' with source: peer must have kind: peer, found kind: ${server.kind}.`
      );
    }
    if (server.kind === "peer" && server.source !== "peer") {
      throw new Error(
        `Server '${serverId}' with kind: peer must have source: peer, found source: ${server.source}.`
      );
    }
    if (server.source === "peer" && !server.runtimeBinding && !server.dockerRuntime) {
      throw new Error(
        `Peer server '${serverId}' must declare runtimeBinding or dockerRuntime apply metadata.`
      );
    }
    if (server.usageClass === "docs-only") {
      if (server.source !== "peer") {
        throw new Error(`Server '${serverId}' with usageClass: docs-only must have source: peer.`);
      }
      if (server.mutationLevel !== "read") {
        throw new Error(`Server '${serverId}' with usageClass: docs-only must have mutationLevel: read.`);
      }
    }

    for (const tool of server.tools) {
      requireCategory(tool.category, categoryIds, `tool '${tool.toolId}'`);
      requireTrustClass(tool.trustClass, trustClassIds, `tool '${tool.toolId}'`);
      requireMutationLevel(tool.mutationLevel, `tool '${tool.toolId}'`);
    }
  }

  for (const [bandId, band] of Object.entries(manifests.bands)) {
    requireTrustClass(band.trustClass, trustClassIds, `band '${bandId}'`);
    requireMutationLevel(band.mutationLevel, `band '${bandId}'`);

    for (const serverId of band.includeServers) {
      if (!serverIds.has(serverId)) {
        throw new Error(`Band '${bandId}' references unknown server '${serverId}'.`);
      }
      const server = manifests.servers[serverId];
      assertTrustClassNotBroaderThan(
        server.trustClass,
        band.trustClass,
        manifests.trustClasses,
        `band '${bandId}' included server '${serverId}'`
      );
      assertMutationLevelNotBroaderThan(
        server.mutationLevel,
        band.mutationLevel,
        `band '${bandId}' included server '${serverId}'`
      );
    }

    for (const categoryId of band.allowedCategories) {
      requireCategory(categoryId, categoryIds, `band '${bandId}' allowedCategories`);
      const category = manifests.categories[categoryId];
      assertTrustClassNotBroaderThan(
        category.trustClass,
        band.trustClass,
        manifests.trustClasses,
        `band '${bandId}' allowed category '${categoryId}'`
      );
      assertMutationLevelNotBroaderThan(
        category.mutationLevel,
        band.mutationLevel,
        `band '${bandId}' allowed category '${categoryId}'`
      );
    }

    for (const categoryId of band.deniedCategories) {
      requireCategory(categoryId, categoryIds, `band '${bandId}' deniedCategories`);
    }
  }

  for (const [workflowId, workflow] of Object.entries(manifests.workflows)) {
    if (workflow.includeBands.length === 0) {
      throw new Error(`Workflow '${workflowId}' must include at least one band.`);
    }

    for (const bandId of workflow.includeBands) {
      if (!bandIds.has(bandId)) {
        throw new Error(`Workflow '${workflowId}' references unknown band '${bandId}'.`);
      }
    }

    if (workflow.fallbackProfile && !profileIds.has(workflow.fallbackProfile)) {
      throw new Error(
        `Workflow '${workflowId}' references unknown fallback profile '${workflow.fallbackProfile}'.`
      );
    }
  }

  for (const [profileId, profile] of Object.entries(manifests.profiles)) {
    const baseProfileCount = profile.baseProfiles?.length ?? 0;
    const bandCount = profile.includeBands?.length ?? 0;
    if ((baseProfileCount + bandCount > 1) && !profile.compositeReason?.trim()) {
      throw new Error(
        `Profile '${profileId}' is a composite profile and composite profiles require an explicit repeated workflow reason.`
      );
    }

    for (const baseProfileId of profile.baseProfiles ?? []) {
      if (!profileIds.has(baseProfileId)) {
        throw new Error(`Profile '${profileId}' references unknown base profile '${baseProfileId}'.`);
      }
    }

    for (const bandId of profile.includeBands ?? []) {
      if (!bandIds.has(bandId)) {
        throw new Error(`Profile '${profileId}' references unknown band '${bandId}'.`);
      }
    }

    for (const serverId of profile.includeServers ?? []) {
      if (!serverIds.has(serverId)) {
        throw new Error(`Profile '${profileId}' references unknown server '${serverId}'.`);
      }
    }

    for (const categoryId of profile.allowedCategories ?? []) {
      requireCategory(categoryId, categoryIds, `profile '${profileId}' allowedCategories`);
    }

    for (const categoryId of profile.deniedCategories ?? []) {
      requireCategory(categoryId, categoryIds, `profile '${profileId}' deniedCategories`);
    }

    if (profile.fallbackProfile && !profileIds.has(profile.fallbackProfile)) {
      throw new Error(
        `Profile '${profileId}' references unknown fallback profile '${profile.fallbackProfile}'.`
      );
    }
  }

  for (const [intentId, intent] of Object.entries(manifests.intents)) {
    if (!profileIds.has(intent.targetProfile)) {
      throw new Error(`Intent '${intentId}' references unknown profile '${intent.targetProfile}'.`);
    }
    requireTrustClass(intent.trustClass, trustClassIds, `intent '${intentId}'`);
    for (const categoryId of intent.allowedCategories) {
      requireCategory(categoryId, categoryIds, `intent '${intentId}' allowedCategories`);
    }
    for (const categoryId of intent.deniedCategories) {
      requireCategory(categoryId, categoryIds, `intent '${intentId}' deniedCategories`);
    }
    if (intent.fallbackProfile && !profileIds.has(intent.fallbackProfile)) {
      throw new Error(
        `Intent '${intentId}' references unknown fallback profile '${intent.fallbackProfile}'.`
      );
    }
  }

  for (const [clientId, client] of Object.entries(manifests.clients)) {
    if ((client.additionalServerIds?.length ?? 0) > 0) {
      throw new Error(
        `Client overlay '${clientId}' cannot widen trust boundaries with additionalServerIds in v1.`
      );
    }
    for (const serverId of client.suppressServerIds ?? []) {
      if (!serverIds.has(serverId)) {
        throw new Error(`Client overlay '${clientId}' references unknown server '${serverId}'.`);
      }
    }
  }
}

function compileBands(manifests: ToolboxManifestSet): Record<string, CompiledToolboxBand> {
  return Object.fromEntries(
    Object.entries(manifests.bands)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([bandId, band]) => {
        const includeServers = uniqueSorted(band.includeServers);
        const allowedCategories = uniqueSorted(band.allowedCategories);
        const deniedCategories = uniqueSorted(band.deniedCategories);
        const tools = buildCompiledToolDescriptors(
          manifests,
          includeServers,
          allowedCategories,
          deniedCategories
        );
        const semanticCapabilities = validateNoDuplicateTooling(
          `Band '${bandId}'`,
          tools
        );
        const normalized = {
          id: band.id,
          displayName: band.displayName,
          trustClass: band.trustClass,
          mutationLevel: band.mutationLevel,
          autoExpand: band.autoExpand,
          requiresApproval: band.requiresApproval,
          preferredActorRoles: uniqueSorted(band.preferredActorRoles ?? []),
          includeServers,
          allowedCategories,
          deniedCategories,
          contraction: band.contraction,
          tools,
          semanticCapabilities,
          bandRevision: ""
        } satisfies CompiledToolboxBand;
        return [
          bandId,
          {
            ...normalized,
            bandRevision: hashStable(normalized)
          } satisfies CompiledToolboxBand
        ];
      })
  );
}

function compileWorkflows(
  manifests: ToolboxManifestSet
): Record<string, CompiledToolboxWorkflow> {
  return Object.fromEntries(
    Object.entries(manifests.workflows)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([workflowId, workflow]) => {
        const normalized = {
          id: workflow.id,
          displayName: workflow.displayName,
          includeBands: uniqueSorted(workflow.includeBands),
          compositeReason: workflow.compositeReason,
          fallbackProfile: workflow.fallbackProfile,
          sessionMode: workflow.sessionMode ?? "toolbox-activated",
          preferredActorRoles: uniqueSorted(workflow.preferredActorRoles ?? []),
          autoExpand: workflow.autoExpand ?? false,
          requiresApproval: workflow.requiresApproval ?? false,
          summary: workflow.summary,
          exampleTasks: uniqueSorted(workflow.exampleTasks ?? [])
        } satisfies Omit<CompiledToolboxWorkflow, "workflowRevision">;

        return [
          workflowId,
          {
            ...normalized,
            workflowRevision: hashStable(normalized)
          } satisfies CompiledToolboxWorkflow
        ];
      })
  );
}

function compileProfiles(
  manifests: ToolboxManifestSet,
  compiledBands: Record<string, CompiledToolboxBand>
): Record<string, CompiledToolboxProfile> {
  const compiled = new Map<string, CompiledToolboxProfile>();
  const stack = new Set<string>();

  const compileProfile = (profileId: string): CompiledToolboxProfile => {
    const existing = compiled.get(profileId);
    if (existing) {
      return existing;
    }

    if (stack.has(profileId)) {
      throw new Error(`Profile '${profileId}' contains a circular base profile reference.`);
    }

    const profile = manifests.profiles[profileId];
    if (!profile) {
      throw new Error(`Profile '${profileId}' is not defined.`);
    }

    stack.add(profileId);
    const baseProfiles = (profile.baseProfiles ?? []).map((baseProfileId) =>
      compileProfile(baseProfileId)
    );
    stack.delete(profileId);

    const includeBands = uniqueSorted(profile.includeBands ?? []);
    const bandInputs = includeBands.map((bandId) => compiledBands[bandId]);
    const includeServers = uniqueSorted([
      ...baseProfiles.flatMap((baseProfile) => baseProfile.includeServers),
      ...bandInputs.flatMap((band) => band.includeServers),
      ...(profile.includeServers ?? [])
    ]);
    const allowedCategories = uniqueSorted([
      ...baseProfiles.flatMap((baseProfile) => baseProfile.allowedCategories),
      ...bandInputs.flatMap((band) => band.allowedCategories),
      ...(profile.allowedCategories ?? [])
    ]);
    const deniedCategories = uniqueSorted([
      ...baseProfiles.flatMap((baseProfile) => baseProfile.deniedCategories),
      ...bandInputs.flatMap((band) => band.deniedCategories),
      ...(profile.deniedCategories ?? [])
    ]);

    const tools = buildCompiledToolDescriptors(
      manifests,
      includeServers,
      allowedCategories,
      deniedCategories
    );
    const semanticCapabilities = validateNoDuplicateTooling(
      `Profile '${profileId}'`,
      tools
    );

    const normalized = {
      id: profile.id,
      displayName: profile.displayName,
      sessionMode: profile.sessionMode,
      composite: baseProfiles.length > 0 || includeBands.length > 1,
      compositeReason: profile.compositeReason?.trim() || undefined,
      baseProfiles: sortBy(baseProfiles.map((baseProfile) => baseProfile.id), (value) => value),
      includeBands,
      includeServers,
      allowedCategories,
      deniedCategories,
      fallbackProfile: profile.fallbackProfile,
      tools,
      semanticCapabilities,
      profileRevision: ""
    } satisfies CompiledToolboxProfile;

    const finalized = {
      ...normalized,
      profileRevision: hashStable(normalized)
    } satisfies CompiledToolboxProfile;
    compiled.set(profileId, finalized);
    return finalized;
  };

  for (const profileId of Object.keys(manifests.profiles).sort()) {
    compileProfile(profileId);
  }

  return Object.fromEntries(compiled.entries());
}

function compileClients(
  manifests: ToolboxManifestSet
): Record<string, CompiledToolboxClientOverlay> {
  return Object.fromEntries(
    Object.entries(manifests.clients)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([clientId, client]) => [
        clientId,
        {
          id: client.id,
          displayName: client.displayName,
          handoffStrategy: client.handoffStrategy ?? "env-reconnect",
          handoffPresetRef: client.handoffPresetRef?.trim() || undefined,
          suppressServerIds: uniqueSorted(client.suppressServerIds ?? []),
          suppressToolIds: uniqueSorted(client.suppressToolIds ?? []),
          suppressCategories: uniqueSorted(client.suppressCategories ?? []),
          suppressedSemanticCapabilities: uniqueSorted(client.suppressSemanticCapabilities ?? [])
        } satisfies CompiledToolboxClientOverlay
      ])
  );
}

function readCategories(document: JsonRecord): Record<string, ToolboxCategoryManifest> {
  const categories = requireRecord(document.categories, "categories");
  return Object.fromEntries(
    Object.entries(categories)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([categoryId, value]) => {
        const record = requireRecord(value, `categories.${categoryId}`);
        return [
          categoryId,
          {
            description: requireString(record.description, `categories.${categoryId}.description`),
            trustClass: requireString(record.trustClass, `categories.${categoryId}.trustClass`),
            mutationLevel: requireMutationLevel(
              requireString(record.mutationLevel, `categories.${categoryId}.mutationLevel`),
              `categories.${categoryId}.mutationLevel`
            )
          } satisfies ToolboxCategoryManifest
        ];
      })
  );
}

function readTrustClasses(document: JsonRecord): Record<string, ToolboxTrustClassManifest> {
  const trustClasses = requireRecord(document.trustClasses, "trustClasses");
  return Object.fromEntries(
    Object.entries(trustClasses)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([trustClassId, value]) => {
        const record = requireRecord(value, `trustClasses.${trustClassId}`);
        return [
          trustClassId,
          {
            level: requireNumber(record.level, `trustClasses.${trustClassId}.level`),
            description: requireString(record.description, `trustClasses.${trustClassId}.description`)
          } satisfies ToolboxTrustClassManifest
        ];
      })
  );
}

function readServer(document: JsonRecord, field: string): ToolboxServerManifest {
  const server = requireRecord(document[field], field);
  const runtimeBindingRaw = server.runtimeBinding;
  const dockerRuntimeRaw = server.dockerRuntime;
  let runtimeBinding: ToolboxRuntimeBindingManifest | undefined;
  let dockerRuntime: ToolboxDockerRuntimeManifest | undefined;
  if (runtimeBindingRaw !== undefined) {
    runtimeBinding = readRuntimeBinding(
      requireRecord(runtimeBindingRaw, `${field}.runtimeBinding`),
      `${field}.runtimeBinding`
    );
  }
  if (dockerRuntimeRaw !== undefined) {
    dockerRuntime = readDockerRuntime(
      requireRecord(dockerRuntimeRaw, `${field}.dockerRuntime`),
      `${field}.dockerRuntime`
    );
  }
  if (!runtimeBinding && dockerRuntime) {
    runtimeBinding = normalizeRuntimeBindingFromDockerRuntime(dockerRuntime);
  }
  if (runtimeBinding && !dockerRuntime) {
    dockerRuntime = synthesizeLegacyDockerRuntime(runtimeBinding);
  }
  if (runtimeBinding && dockerRuntime) {
    const normalizedDockerBinding = normalizeRuntimeBindingFromDockerRuntime(dockerRuntime);
    if (
      JSON.stringify(runtimeBinding) !== JSON.stringify(normalizedDockerBinding) &&
      runtimeBinding.kind !== "local-stdio"
    ) {
      throw new Error(
        `${field}.runtimeBinding must match ${field}.dockerRuntime when both are declared.`
      );
    }
  }
  return {
    id: requireString(server.id, `${field}.id`),
    displayName: requireString(server.displayName, `${field}.displayName`),
    source: requireStringEnum(server.source, `${field}.source`, SERVER_SOURCES) as "owned" | "peer",
    kind: requireStringEnum(server.kind, `${field}.kind`, SERVER_KINDS) as "control" | "semantic" | "peer",
    usageClass: optionalStringEnum(
      server.usageClass,
      `${field}.usageClass`,
      SERVER_USAGE_CLASSES
    ) as ToolboxServerUsageClass | undefined,
    trustClass: requireString(server.trustClass, `${field}.trustClass`),
    mutationLevel: requireMutationLevel(
      requireString(server.mutationLevel, `${field}.mutationLevel`),
      `${field}.mutationLevel`
    ),
    tools: requireArray(server.tools, `${field}.tools`).map((toolValue, index) => {
      const tool = requireRecord(toolValue, `${field}.tools[${index}]`);
      return {
        toolId: requireString(tool.toolId, `${field}.tools[${index}].toolId`),
        displayName: requireString(tool.displayName, `${field}.tools[${index}].displayName`),
        category: requireString(tool.category, `${field}.tools[${index}].category`),
        trustClass: requireString(tool.trustClass, `${field}.tools[${index}].trustClass`),
        mutationLevel: requireMutationLevel(
          requireString(tool.mutationLevel, `${field}.tools[${index}].mutationLevel`),
          `${field}.tools[${index}].mutationLevel`
        ),
        semanticCapabilityId: requireString(
          tool.semanticCapabilityId,
          `${field}.tools[${index}].semanticCapabilityId`
        )
      };
    }),
    ...(runtimeBinding !== undefined ? { runtimeBinding } : {}),
    ...(dockerRuntime !== undefined ? { dockerRuntime } : {})
  };
}

function readRuntimeBinding(
  runtimeBinding: JsonRecord,
  field: string
): ToolboxRuntimeBindingManifest {
  const kind = requireStringEnum(
    runtimeBinding.kind,
    `${field}.kind`,
    RUNTIME_BINDING_KINDS
  ) as ToolboxRuntimeBindingManifest["kind"];

  if (kind === "docker-catalog") {
    return {
      kind,
      catalogServerId: requireString(runtimeBinding.catalogServerId, `${field}.catalogServerId`)
    };
  }

  if (kind === "descriptor-only") {
    const unsafeCatalogServerIds = optionalStringArray(
      runtimeBinding.unsafeCatalogServerIds,
      `${field}.unsafeCatalogServerIds`
    );
    return {
      kind,
      blockedReason: requireString(runtimeBinding.blockedReason, `${field}.blockedReason`),
      ...(unsafeCatalogServerIds !== undefined
        ? { unsafeCatalogServerIds: uniqueSorted(unsafeCatalogServerIds) }
        : {})
    };
  }

  const envRecord = runtimeBinding.env === undefined
    ? undefined
    : requireStringRecord(runtimeBinding.env, `${field}.env`);
  const workingDirectory = optionalString(
    runtimeBinding.workingDirectory,
    `${field}.workingDirectory`
  );
  const configTarget = optionalStringEnum(
    runtimeBinding.configTarget,
    `${field}.configTarget`,
    new Set(["codex-mcp-json"])
  ) as "codex-mcp-json" | undefined;
  return {
    kind,
    command: requireString(runtimeBinding.command, `${field}.command`),
    args: optionalStringArray(runtimeBinding.args, `${field}.args`),
    ...(envRecord !== undefined ? { env: envRecord } : {}),
    ...(workingDirectory !== undefined ? { workingDirectory } : {}),
    ...(configTarget !== undefined ? { configTarget } : {})
  };
}

function readDockerRuntime(
  dockerRuntime: JsonRecord,
  field: string
): ToolboxDockerRuntimeManifest {
  const applyMode = requireStringEnum(
    dockerRuntime.applyMode,
    `${field}.applyMode`,
    DOCKER_APPLY_MODES
  ) as "catalog" | "descriptor-only";
  if (applyMode === "catalog") {
    if (dockerRuntime.blockedReason !== undefined) {
      throw new Error(`${field}.blockedReason is only valid for descriptor-only mode.`);
    }
    if (dockerRuntime.unsafeCatalogServerIds !== undefined) {
      throw new Error(`${field}.unsafeCatalogServerIds is only valid for descriptor-only mode.`);
    }
    return {
      applyMode,
      catalogServerId: requireString(dockerRuntime.catalogServerId, `${field}.catalogServerId`)
    };
  }

  if (dockerRuntime.catalogServerId !== undefined) {
    throw new Error(`${field}.catalogServerId is only valid for catalog mode.`);
  }
  const unsafeCatalogServerIds = optionalStringArray(
    dockerRuntime.unsafeCatalogServerIds,
    `${field}.unsafeCatalogServerIds`
  );
  return {
    applyMode,
    blockedReason: requireString(dockerRuntime.blockedReason, `${field}.blockedReason`),
    ...(unsafeCatalogServerIds !== undefined
      ? { unsafeCatalogServerIds: uniqueSorted(unsafeCatalogServerIds) }
      : {})
  };
}

function normalizeRuntimeBindingFromDockerRuntime(
  dockerRuntime: ToolboxDockerRuntimeManifest
): ToolboxRuntimeBindingManifest {
  if (dockerRuntime.applyMode === "catalog") {
    return {
      kind: "docker-catalog",
      catalogServerId: dockerRuntime.catalogServerId
    };
  }

  return {
    kind: "descriptor-only",
    blockedReason: dockerRuntime.blockedReason,
    ...(dockerRuntime.unsafeCatalogServerIds !== undefined
      ? { unsafeCatalogServerIds: [...dockerRuntime.unsafeCatalogServerIds] }
      : {})
  };
}

function synthesizeLegacyDockerRuntime(
  runtimeBinding: ToolboxRuntimeBindingManifest
): ToolboxDockerRuntimeManifest | undefined {
  if (runtimeBinding.kind === "docker-catalog") {
    return {
      applyMode: "catalog",
      catalogServerId: runtimeBinding.catalogServerId
    };
  }

  if (runtimeBinding.kind === "descriptor-only") {
    return {
      applyMode: "descriptor-only",
      blockedReason: runtimeBinding.blockedReason,
      ...(runtimeBinding.unsafeCatalogServerIds !== undefined
        ? { unsafeCatalogServerIds: [...runtimeBinding.unsafeCatalogServerIds] }
        : {})
    };
  }

  return undefined;
}

function readBand(document: JsonRecord, field: string): ToolboxBandManifest {
  const band = requireRecord(document[field], field);
  return {
    id: requireString(band.id, `${field}.id`),
    displayName: requireString(band.displayName, `${field}.displayName`),
    trustClass: requireString(band.trustClass, `${field}.trustClass`),
    mutationLevel: requireMutationLevel(
      requireString(band.mutationLevel, `${field}.mutationLevel`),
      `${field}.mutationLevel`
    ),
    autoExpand: requireBoolean(band.autoExpand, `${field}.autoExpand`),
    requiresApproval: requireBoolean(band.requiresApproval, `${field}.requiresApproval`),
    preferredActorRoles: optionalStringEnumArray(
      band.preferredActorRoles,
      `${field}.preferredActorRoles`,
      ACTOR_ROLES
    ) as ActorRole[] | undefined,
    includeServers: requireStringArray(band.includeServers, `${field}.includeServers`),
    allowedCategories: requireStringArray(band.allowedCategories, `${field}.allowedCategories`),
    deniedCategories: requireStringArray(band.deniedCategories, `${field}.deniedCategories`),
    contraction: readBandContraction(
      requireRecord(band.contraction, `${field}.contraction`),
      `${field}.contraction`
    ),
    compatibilityProfiles: optionalCompatibilityProfiles(
      band.compatibilityProfiles,
      `${field}.compatibilityProfiles`
    )
  };
}

function readBandContraction(
  contraction: JsonRecord,
  field: string
): ToolboxBandContractionManifest {
  return {
    taskAware: requireBoolean(contraction.taskAware, `${field}.taskAware`),
    idleTimeoutSeconds: optionalPositiveInteger(
      contraction.idleTimeoutSeconds,
      `${field}.idleTimeoutSeconds`
    ),
    onLeaseExpiry: requireBoolean(contraction.onLeaseExpiry, `${field}.onLeaseExpiry`)
  };
}

function optionalCompatibilityProfiles(
  value: unknown,
  field: string
): ToolboxBandCompatibilityProfileManifest[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireArray(value, field).map((entry, index) => {
    const profile = requireRecord(entry, `${field}[${index}]`);
    return {
      id: requireString(profile.id, `${field}[${index}].id`),
      displayName: requireString(profile.displayName, `${field}[${index}].displayName`),
      additionalBands: optionalStringArray(
        profile.additionalBands,
        `${field}[${index}].additionalBands`
      ),
      sessionMode: optionalStringEnum(
        profile.sessionMode,
        `${field}[${index}].sessionMode`,
        PROFILE_SESSION_MODES
      ) as ToolboxProfileManifest["sessionMode"] | undefined,
      compositeReason: optionalString(
        profile.compositeReason,
        `${field}[${index}].compositeReason`
      ),
      fallbackProfile: optionalString(
        profile.fallbackProfile,
        `${field}[${index}].fallbackProfile`
      )
    } satisfies ToolboxBandCompatibilityProfileManifest;
  });
}

function readProfile(document: JsonRecord, field: string): ToolboxProfileManifest {
  const profile = requireRecord(document[field], field);
  return {
    id: requireString(profile.id, `${field}.id`),
    displayName: requireString(profile.displayName, `${field}.displayName`),
    sessionMode: requireStringEnum(profile.sessionMode, `${field}.sessionMode`, PROFILE_SESSION_MODES) as
      | "toolbox-bootstrap"
      | "toolbox-activated",
    baseProfiles: optionalStringArray(profile.baseProfiles, `${field}.baseProfiles`),
    compositeReason: optionalString(profile.compositeReason, `${field}.compositeReason`),
    includeBands: optionalStringArray(profile.includeBands, `${field}.includeBands`),
    includeServers: optionalStringArray(profile.includeServers, `${field}.includeServers`),
    allowedCategories: optionalStringArray(profile.allowedCategories, `${field}.allowedCategories`),
    deniedCategories: optionalStringArray(profile.deniedCategories, `${field}.deniedCategories`),
    fallbackProfile: optionalString(profile.fallbackProfile, `${field}.fallbackProfile`)
  };
}

function readWorkflow(document: JsonRecord, field: string): ToolboxWorkflowManifest {
  const workflow = requireRecord(document[field], field);
  return {
    id: requireString(workflow.id, `${field}.id`),
    displayName: requireString(workflow.displayName, `${field}.displayName`),
    includeBands: requireStringArray(workflow.includeBands, `${field}.includeBands`),
    compositeReason: requireString(workflow.compositeReason, `${field}.compositeReason`),
    fallbackProfile: optionalString(workflow.fallbackProfile, `${field}.fallbackProfile`),
    sessionMode: optionalStringEnum(
      workflow.sessionMode,
      `${field}.sessionMode`,
      PROFILE_SESSION_MODES
    ) as ToolboxProfileManifest["sessionMode"] | undefined,
    preferredActorRoles: optionalStringEnumArray(
      workflow.preferredActorRoles,
      `${field}.preferredActorRoles`,
      ACTOR_ROLES
    ) as ActorRole[] | undefined,
    autoExpand: workflow.autoExpand === undefined
      ? undefined
      : requireBoolean(workflow.autoExpand, `${field}.autoExpand`),
    requiresApproval: workflow.requiresApproval === undefined
      ? undefined
      : requireBoolean(workflow.requiresApproval, `${field}.requiresApproval`),
    summary: optionalString(workflow.summary, `${field}.summary`),
    exampleTasks: optionalStringArray(workflow.exampleTasks, `${field}.exampleTasks`)
  };
}

function deriveProfilesFromBandsAndWorkflows(
  bands: Record<string, ToolboxBandManifest>,
  workflows: Record<string, ToolboxWorkflowManifest>
): Record<string, ToolboxProfileManifest> {
  const derivedProfiles = new Map<string, ToolboxProfileManifest>();

  for (const [bandId, band] of Object.entries(bands).sort(([left], [right]) => left.localeCompare(right))) {
    for (const compatibilityProfile of band.compatibilityProfiles ?? []) {
      if (derivedProfiles.has(compatibilityProfile.id)) {
        throw new Error(
          `Band-derived compatibility profile '${compatibilityProfile.id}' is defined more than once.`
        );
      }

      const includeBands = uniqueSorted([bandId, ...(compatibilityProfile.additionalBands ?? [])]);
      derivedProfiles.set(compatibilityProfile.id, {
        id: compatibilityProfile.id,
        displayName: compatibilityProfile.displayName,
        sessionMode: compatibilityProfile.sessionMode ?? "toolbox-activated",
        compositeReason: compatibilityProfile.compositeReason,
        includeBands,
        fallbackProfile: compatibilityProfile.fallbackProfile
      });
    }
  }

  for (const workflow of Object.values(workflows).sort((left, right) => left.id.localeCompare(right.id))) {
    if (derivedProfiles.has(workflow.id)) {
      throw new Error(
        `Workflow-derived compatibility profile '${workflow.id}' is defined more than once.`
      );
    }

    derivedProfiles.set(workflow.id, {
      id: workflow.id,
      displayName: workflow.displayName,
      sessionMode: workflow.sessionMode ?? "toolbox-activated",
      compositeReason: workflow.compositeReason,
      includeBands: uniqueSorted(workflow.includeBands),
      fallbackProfile: workflow.fallbackProfile
    });
  }

  return Object.fromEntries(derivedProfiles.entries());
}

function mergeAuthoredAndDerivedProfiles(
  authoredProfiles: Record<string, ToolboxProfileManifest>,
  derivedProfiles: Record<string, ToolboxProfileManifest>
): Record<string, ToolboxProfileManifest> {
  for (const profileId of Object.keys(derivedProfiles)) {
    if (authoredProfiles[profileId]) {
      throw new Error(
        `Profile '${profileId}' is defined both as an authored manifest and a band-derived compatibility profile.`
      );
    }
  }

  return {
    ...authoredProfiles,
    ...derivedProfiles
  };
}

function readIntents(document: JsonRecord): Record<string, ToolboxIntentManifest> {
  const intents = requireRecord(document.intents, "intents");
  return Object.fromEntries(
    Object.entries(intents)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([intentId, value]) => {
        const intent = requireRecord(value, `intents.${intentId}`);
        return [
          intentId,
          {
            displayName: requireString(intent.displayName, `intents.${intentId}.displayName`),
            summary: requireString(intent.summary, `intents.${intentId}.summary`),
            exampleTasks: requireStringArray(
              intent.exampleTasks,
              `intents.${intentId}.exampleTasks`
            ),
            targetProfile: requireString(intent.targetProfile, `intents.${intentId}.targetProfile`),
            trustClass: requireString(intent.trustClass, `intents.${intentId}.trustClass`),
            requiresApproval: requireBoolean(intent.requiresApproval, `intents.${intentId}.requiresApproval`),
            activationMode: requireString(intent.activationMode, `intents.${intentId}.activationMode`) as "session-switch",
            allowedCategories: requireStringArray(
              intent.allowedCategories,
              `intents.${intentId}.allowedCategories`
            ),
            deniedCategories: requireStringArray(
              intent.deniedCategories,
              `intents.${intentId}.deniedCategories`
            ),
            fallbackProfile: optionalString(intent.fallbackProfile, `intents.${intentId}.fallbackProfile`)
          } satisfies ToolboxIntentManifest
        ];
      })
  );
}

function readClient(document: JsonRecord, field: string): ToolboxClientOverlayManifest {
  const client = requireRecord(document[field], field);
  return {
    id: requireString(client.id, `${field}.id`),
    displayName: requireString(client.displayName, `${field}.displayName`),
    handoffStrategy: optionalStringEnum(
      client.handoffStrategy,
      `${field}.handoffStrategy`,
      new Set(["env-reconnect", "manual-env-reconnect"])
    ) as ToolboxClientOverlayManifest["handoffStrategy"],
    handoffPresetRef: optionalString(client.handoffPresetRef, `${field}.handoffPresetRef`),
    suppressServerIds: optionalStringArray(client.suppressServerIds, `${field}.suppressServerIds`),
    suppressToolIds: optionalStringArray(client.suppressToolIds, `${field}.suppressToolIds`),
    suppressCategories: optionalStringArray(client.suppressCategories, `${field}.suppressCategories`),
    suppressSemanticCapabilities: optionalStringArray(
      client.suppressSemanticCapabilities,
      `${field}.suppressSemanticCapabilities`
    ),
    additionalServerIds: optionalStringArray(client.additionalServerIds, `${field}.additionalServerIds`)
  };
}

function loadManifestDirectory<T>(
  directoryPath: string,
  field: string,
  reader: (document: JsonRecord, field: string) => T
): Record<string, T & { id: string }> {
  const entries = readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
    .sort((left, right) => left.name.localeCompare(right.name));

  return Object.fromEntries(
    entries.map((entry) => {
      const document = loadYamlDocument(path.join(directoryPath, entry.name));
      const manifest = reader(document, field) as T & { id: string };
      return [manifest.id, manifest];
    })
  );
}

function loadOptionalManifestDirectory<T>(
  directoryPath: string,
  field: string,
  reader: (document: JsonRecord, field: string) => T
): Record<string, T & { id: string }> {
  if (!existsSync(directoryPath)) {
    return {};
  }
  return loadManifestDirectory(directoryPath, field, reader);
}

function loadYamlDocument(filePath: string): JsonRecord {
  const parsed = parse(readFileSync(filePath, "utf8")) as unknown;
  return requireRecord(parsed, filePath);
}

function requireRecord(value: unknown, field: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Field '${field}' must be an object.`);
  }
  return value as JsonRecord;
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Field '${field}' must be an array.`);
  }
  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Field '${field}' must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireString(value, field);
}

function requireStringArray(value: unknown, field: string): string[] {
  return requireArray(value, field).map((entry, index) =>
    requireString(entry, `${field}[${index}]`)
  );
}

function requireStringRecord(value: unknown, field: string): Record<string, string> {
  const record = requireRecord(value, field);
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [
      key,
      requireString(entry, `${field}.${key}`)
    ])
  );
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireStringArray(value, field);
}

function optionalStringEnum<T extends string>(
  value: unknown,
  field: string,
  allowedValues: ReadonlySet<T>
): T | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireStringEnum(value, field, allowedValues);
}

function optionalStringEnumArray<T extends string>(
  value: unknown,
  field: string,
  allowedValues: ReadonlySet<T>
): T[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`Field '${field}' must be an array.`);
  }

  return value.map((entry, index) =>
    requireStringEnum(entry, `${field}[${index}]`, allowedValues)
  );
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Field '${field}' must be a boolean.`);
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Field '${field}' must be a number.`);
  }
  return value;
}

function optionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = requireNumber(value, field);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Field '${field}' must be a positive integer.`);
  }
  return parsed;
}

function requireStringEnum<T extends string>(
  value: unknown,
  field: string,
  allowedValues: ReadonlySet<T>
): T {
  const normalized = requireString(value, field);
  if (!allowedValues.has(normalized as T)) {
    throw new Error(`Field '${field}' must be one of ${[...allowedValues].join(", ")}.`);
  }
  return normalized as T;
}

function requireMutationLevel(value: string, field: string): ToolboxMutationLevel {
  if (!MUTATION_LEVELS.has(value as ToolboxMutationLevel)) {
    throw new Error(`Field '${field}' must be one of ${[...MUTATION_LEVELS].join(", ")}.`);
  }
  return value as ToolboxMutationLevel;
}

function requireCategory(categoryId: string, categoryIds: Set<string>, field: string): void {
  if (!categoryIds.has(categoryId)) {
    throw new Error(`Unknown category '${categoryId}' referenced by ${field}.`);
  }
}

function requireTrustClass(trustClassId: string, trustClassIds: Set<string>, field: string): void {
  if (!trustClassIds.has(trustClassId)) {
    throw new Error(`Unknown trust class '${trustClassId}' referenced by ${field}.`);
  }
}

function assertTrustClassNotBroaderThan(
  actualTrustClass: string,
  maximumTrustClass: string,
  trustClasses: Record<string, ToolboxTrustClassManifest>,
  field: string
): void {
  if (trustClasses[actualTrustClass].level > trustClasses[maximumTrustClass].level) {
    throw new Error(
      `${field} exceeds trust class ceiling '${maximumTrustClass}' with '${actualTrustClass}'.`
    );
  }
}

function assertMutationLevelNotBroaderThan(
  actualMutationLevel: ToolboxMutationLevel,
  maximumMutationLevel: ToolboxMutationLevel,
  field: string
): void {
  if (mutationRank(actualMutationLevel) > mutationRank(maximumMutationLevel)) {
    throw new Error(
      `${field} exceeds mutation level ceiling '${maximumMutationLevel}' with '${actualMutationLevel}'.`
    );
  }
}

function mutationRank(mutationLevel: ToolboxMutationLevel): number {
  return mutationLevel === "read" ? 10 : mutationLevel === "write" ? 20 : 30;
}

function buildCompiledToolDescriptors(
  manifests: ToolboxManifestSet,
  includeServers: string[],
  allowedCategories: string[],
  deniedCategories: string[]
): CompiledToolboxToolDescriptor[] {
  return sortBy(
    includeServers.flatMap((serverId) =>
      manifests.servers[serverId].tools
        .filter(
          (tool) =>
            allowedCategories.includes(tool.category) &&
            !deniedCategories.includes(tool.category)
        )
        .map((tool) => ({
          ...tool,
          serverId,
          source: manifests.servers[serverId].source,
          availabilityState: "declared" as const
        } satisfies CompiledToolboxToolDescriptor))
    ),
    (tool) => `${tool.serverId}:${tool.toolId}`
  );
}

function validateNoDuplicateTooling(
  scopeLabel: string,
  tools: CompiledToolboxToolDescriptor[]
): string[] {
  const seenSemanticCapabilities = new Map<string, string>();
  const seenToolIds = new Map<string, string>();
  for (const tool of tools) {
    const previousToolServerId = seenToolIds.get(tool.toolId);
    if (previousToolServerId) {
      throw new Error(
        `${scopeLabel} has duplicate toolId '${tool.toolId}' from '${previousToolServerId}' and '${tool.serverId}'.`
      );
    }
    seenToolIds.set(tool.toolId, tool.serverId);

    const previous = seenSemanticCapabilities.get(tool.semanticCapabilityId);
    if (previous) {
      throw new Error(
        `${scopeLabel} has duplicate semantic capability '${tool.semanticCapabilityId}' from '${previous}' and '${tool.serverId}'.`
      );
    }
    seenSemanticCapabilities.set(tool.semanticCapabilityId, tool.serverId);
  }

  return sortBy([...seenSemanticCapabilities.keys()], (value) => value);
}

function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sortRecord<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  );
}

function sortBy<T>(values: T[], selector: (value: T) => string): T[] {
  return [...values].sort((left, right) => selector(left).localeCompare(selector(right)));
}

function hashStable(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}
