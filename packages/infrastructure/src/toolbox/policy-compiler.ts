import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type {
  CompiledToolboxClientOverlay,
  CompiledToolboxPolicy,
  CompiledToolboxProfile,
  CompiledToolboxServer,
  CompiledToolboxToolDescriptor,
  CompiledToolboxIntent,
  ToolboxCategoryManifest,
  ToolboxClientOverlayManifest,
  ToolboxDockerRuntimeManifest,
  ToolboxIntentManifest,
  ToolboxMutationLevel,
  ToolboxProfileManifest,
  ToolboxServerManifest,
  ToolboxTrustClassManifest
} from "@mimir/contracts";

type JsonRecord = Record<string, unknown>;

interface ToolboxManifestSet {
  categories: Record<string, ToolboxCategoryManifest>;
  trustClasses: Record<string, ToolboxTrustClassManifest>;
  servers: Record<string, ToolboxServerManifest>;
  profiles: Record<string, ToolboxProfileManifest>;
  intents: Record<string, ToolboxIntentManifest>;
  clients: Record<string, ToolboxClientOverlayManifest>;
}

const MUTATION_LEVELS = new Set<ToolboxMutationLevel>(["read", "write", "admin"]);
const PROFILE_SESSION_MODES = new Set(["toolbox-bootstrap", "toolbox-activated"]);
const SERVER_KINDS = new Set(["control", "semantic", "peer"]);
const SERVER_SOURCES = new Set(["owned", "peer"]);
const DOCKER_APPLY_MODES = new Set(["catalog", "descriptor-only"]);

export function compileToolboxPolicyFromDirectory(
  sourceDirectory: string
): CompiledToolboxPolicy {
  const manifests = loadToolboxManifestSet(sourceDirectory);
  validateToolboxManifestSet(manifests);

  const profiles = compileProfiles(manifests);
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

  return {
    categories: readCategories(categoriesDocument),
    trustClasses: readTrustClasses(trustClassesDocument),
    servers: loadManifestDirectory(path.join(root, "servers"), "server", readServer),
    profiles: loadManifestDirectory(path.join(root, "profiles"), "profile", readProfile),
    intents: readIntents(intentsDocument),
    clients: loadManifestDirectory(path.join(root, "clients"), "client", readClient)
  };
}

function validateToolboxManifestSet(manifests: ToolboxManifestSet): void {
  const trustClassIds = new Set(Object.keys(manifests.trustClasses));
  const categoryIds = new Set(Object.keys(manifests.categories));
  const serverIds = new Set(Object.keys(manifests.servers));
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
    if (server.source === "peer" && !server.dockerRuntime) {
      throw new Error(
        `Peer server '${serverId}' must declare dockerRuntime apply metadata.`
      );
    }

    for (const tool of server.tools) {
      requireCategory(tool.category, categoryIds, `tool '${tool.toolId}'`);
      requireTrustClass(tool.trustClass, trustClassIds, `tool '${tool.toolId}'`);
      requireMutationLevel(tool.mutationLevel, `tool '${tool.toolId}'`);
    }
  }

  for (const [profileId, profile] of Object.entries(manifests.profiles)) {
    if ((profile.baseProfiles?.length ?? 0) > 0 && !profile.compositeReason?.trim()) {
      throw new Error(
        `Profile '${profileId}' is a composite profile and composite profiles require an explicit repeated workflow reason.`
      );
    }

    for (const baseProfileId of profile.baseProfiles ?? []) {
      if (!profileIds.has(baseProfileId)) {
        throw new Error(`Profile '${profileId}' references unknown base profile '${baseProfileId}'.`);
      }
    }

    for (const serverId of profile.includeServers) {
      if (!serverIds.has(serverId)) {
        throw new Error(`Profile '${profileId}' references unknown server '${serverId}'.`);
      }
    }

    for (const categoryId of profile.allowedCategories) {
      requireCategory(categoryId, categoryIds, `profile '${profileId}' allowedCategories`);
    }

    for (const categoryId of profile.deniedCategories) {
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

function compileProfiles(manifests: ToolboxManifestSet): Record<string, CompiledToolboxProfile> {
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

    const includeServers = uniqueSorted([
      ...baseProfiles.flatMap((baseProfile) => baseProfile.includeServers),
      ...profile.includeServers
    ]);
    const allowedCategories = uniqueSorted([
      ...baseProfiles.flatMap((baseProfile) => baseProfile.allowedCategories),
      ...profile.allowedCategories
    ]);
    const deniedCategories = uniqueSorted([
      ...baseProfiles.flatMap((baseProfile) => baseProfile.deniedCategories),
      ...profile.deniedCategories
    ]);

    const tools = sortBy(
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

    const seenSemanticCapabilities = new Map<string, string>();
    const seenToolIds = new Map<string, string>();
    for (const tool of tools) {
      const previousToolServerId = seenToolIds.get(tool.toolId);
      if (previousToolServerId) {
        throw new Error(
          `Profile '${profileId}' has duplicate toolId '${tool.toolId}' from '${previousToolServerId}' and '${tool.serverId}'.`
        );
      }
      seenToolIds.set(tool.toolId, tool.serverId);

      const previous = seenSemanticCapabilities.get(tool.semanticCapabilityId);
      if (previous) {
        throw new Error(
          `Profile '${profileId}' has duplicate semantic capability '${tool.semanticCapabilityId}' from '${previous}' and '${tool.serverId}'.`
        );
      }
      seenSemanticCapabilities.set(tool.semanticCapabilityId, tool.serverId);
    }

    const normalized = {
      id: profile.id,
      displayName: profile.displayName,
      sessionMode: profile.sessionMode,
      composite: baseProfiles.length > 0,
      compositeReason: profile.compositeReason?.trim() || undefined,
      baseProfiles: sortBy(baseProfiles.map((baseProfile) => baseProfile.id), (value) => value),
      includeServers,
      allowedCategories,
      deniedCategories,
      fallbackProfile: profile.fallbackProfile,
      tools,
      semanticCapabilities: sortBy([...seenSemanticCapabilities.keys()], (value) => value),
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
  const dockerRuntimeRaw = server.dockerRuntime;
  let dockerRuntime: ToolboxDockerRuntimeManifest | undefined;
  if (dockerRuntimeRaw !== undefined) {
    const dr = requireRecord(dockerRuntimeRaw, `${field}.dockerRuntime`);
    const applyMode = requireStringEnum(dr.applyMode, `${field}.dockerRuntime.applyMode`, DOCKER_APPLY_MODES) as "catalog" | "descriptor-only";
    if (applyMode === "catalog") {
      if (dr.blockedReason !== undefined) {
        throw new Error(`${field}.dockerRuntime.blockedReason is only valid for descriptor-only mode.`);
      }
      if (dr.unsafeCatalogServerIds !== undefined) {
        throw new Error(`${field}.dockerRuntime.unsafeCatalogServerIds is only valid for descriptor-only mode.`);
      }
      dockerRuntime = {
        applyMode,
        catalogServerId: requireString(dr.catalogServerId, `${field}.dockerRuntime.catalogServerId`)
      };
    } else {
      if (dr.catalogServerId !== undefined) {
        throw new Error(`${field}.dockerRuntime.catalogServerId is only valid for catalog mode.`);
      }
      const unsafeCatalogServerIds = optionalStringArray(
        dr.unsafeCatalogServerIds,
        `${field}.dockerRuntime.unsafeCatalogServerIds`
      );
      dockerRuntime = {
        applyMode,
        blockedReason: requireString(dr.blockedReason, `${field}.dockerRuntime.blockedReason`),
        ...(unsafeCatalogServerIds !== undefined
          ? { unsafeCatalogServerIds: uniqueSorted(unsafeCatalogServerIds) }
          : {})
      };
    }
  }
  return {
    id: requireString(server.id, `${field}.id`),
    displayName: requireString(server.displayName, `${field}.displayName`),
    source: requireStringEnum(server.source, `${field}.source`, SERVER_SOURCES) as "owned" | "peer",
    kind: requireStringEnum(server.kind, `${field}.kind`, SERVER_KINDS) as "control" | "semantic" | "peer",
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
    ...(dockerRuntime !== undefined ? { dockerRuntime } : {})
  };
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
    includeServers: requireStringArray(profile.includeServers, `${field}.includeServers`),
    allowedCategories: requireStringArray(profile.allowedCategories, `${field}.allowedCategories`),
    deniedCategories: requireStringArray(profile.deniedCategories, `${field}.deniedCategories`),
    fallbackProfile: optionalString(profile.fallbackProfile, `${field}.fallbackProfile`)
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

function uniqueSorted(values: string[]): string[] {
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
