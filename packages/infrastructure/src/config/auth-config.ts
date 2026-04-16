import { readFileSync } from "node:fs";
import type {
  ActorAuthorizationMode,
  ActorRegistryEntry
} from "@mimir/orchestration";
import type { AppEnvironment } from "./app-environment.js";
import { parseBoolean, resolveNodeEnv } from "./config-helpers.js";

export type AuthConfig = AppEnvironment["auth"];

export function loadAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
  nodeEnv: AppEnvironment["nodeEnv"] = resolveNodeEnv(env.MAB_NODE_ENV)
): AuthConfig {
  const actorRegistryPath = env.MAB_AUTH_ACTOR_REGISTRY_PATH?.trim() || undefined;
  const issuedTokenRevocationPath =
    env.MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_PATH?.trim() || undefined;

  return normalizeAuthConfig(
    {
      mode:
        (env.MAB_AUTH_MODE as ActorAuthorizationMode | undefined) ??
        (nodeEnv === "production" ? "enforced" : "permissive"),
      allowAnonymousInternal: parseBoolean(
        env.MAB_AUTH_ALLOW_ANONYMOUS_INTERNAL,
        true
      ),
      actorRegistryPath,
      actorRegistry: mergeActorRegistryEntries(
        loadActorRegistryFromPath(actorRegistryPath),
        parseActorRegistry(env.MAB_AUTH_ACTOR_REGISTRY_JSON)
      ),
      issuerSecret: env.MAB_AUTH_ISSUER_SECRET?.trim() || undefined,
      issuedTokenRequireRegistryMatch: parseBoolean(
        env.MAB_AUTH_ISSUED_TOKEN_REQUIRE_REGISTRY_MATCH,
        true
      ),
      issuedTokenRevocationPath,
      revokedIssuedTokenIds: mergeRevokedIssuedTokenIds(
        loadRevokedIssuedTokenIdsFromPath(issuedTokenRevocationPath),
        parseRevokedIssuedTokenIds(env.MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_JSON)
      )
    },
    nodeEnv
  );
}

export function normalizeAuthConfig(
  input: Partial<AuthConfig> | undefined,
  nodeEnv: AppEnvironment["nodeEnv"]
): AuthConfig {
  return {
    mode: input?.mode ?? (nodeEnv === "production" ? "enforced" : "permissive"),
    allowAnonymousInternal: input?.allowAnonymousInternal ?? true,
    actorRegistryPath: input?.actorRegistryPath?.trim() || undefined,
    actorRegistry: input?.actorRegistry ?? [],
    issuerSecret: input?.issuerSecret?.trim() || undefined,
    issuedTokenRequireRegistryMatch:
      input?.issuedTokenRequireRegistryMatch ?? true,
    issuedTokenRevocationPath:
      input?.issuedTokenRevocationPath?.trim() || undefined,
    revokedIssuedTokenIds: input?.revokedIssuedTokenIds ?? []
  };
}

function parseActorRegistry(value: string | undefined): ActorRegistryEntry[] {
  if (!value?.trim()) {
    return [];
  }

  const parsed = JSON.parse(value) as unknown;
  return parseActorRegistryValue(parsed, "MAB_AUTH_ACTOR_REGISTRY_JSON");
}

function parseRevokedIssuedTokenIds(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }

  const parsed = JSON.parse(value) as unknown;
  return parseRevokedIssuedTokenIdValue(
    parsed,
    "MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_JSON"
  );
}

function normalizeActorRegistryEntry(
  value: unknown,
  index: number
): ActorRegistryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `MAB_AUTH_ACTOR_REGISTRY_JSON entry at index ${index} must be an object.`
    );
  }

  const entry = value as Partial<ActorRegistryEntry>;
  if (!entry.actorId?.trim()) {
    throw new Error(
      `MAB_AUTH_ACTOR_REGISTRY_JSON entry at index ${index} is missing actorId.`
    );
  }

  if (!entry.actorRole) {
    throw new Error(
      `MAB_AUTH_ACTOR_REGISTRY_JSON entry '${entry.actorId}' is missing actorRole.`
    );
  }

  return {
    actorId: entry.actorId.trim(),
    actorRole: entry.actorRole,
    authToken: entry.authToken?.trim() || undefined,
    authTokens: normalizeActorTokenCredentials(entry.authTokens, entry.actorId),
    source: entry.source?.trim() || undefined,
    enabled: entry.enabled ?? true,
    allowedTransports: entry.allowedTransports,
    allowedCommands: entry.allowedCommands,
    allowedAdminActions: entry.allowedAdminActions,
    validFrom: entry.validFrom?.trim() || undefined,
    validUntil: entry.validUntil?.trim() || undefined
  };
}

function loadActorRegistryFromPath(filePath: string | undefined): ActorRegistryEntry[] {
  if (!filePath) {
    return [];
  }

  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return parseActorRegistryValue(
    parsed,
    `MAB_AUTH_ACTOR_REGISTRY_PATH (${filePath})`
  );
}

function loadRevokedIssuedTokenIdsFromPath(filePath: string | undefined): string[] {
  if (!filePath) {
    return [];
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parseRevokedIssuedTokenIdValue(
      parsed,
      `MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_PATH (${filePath})`
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function parseActorRegistryValue(
  parsed: unknown,
  sourceLabel: string
): ActorRegistryEntry[] {
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        "actors" in parsed &&
        Array.isArray((parsed as { actors?: unknown }).actors)
      ? ((parsed as { actors: unknown[] }).actors)
      : undefined;

  if (!entries) {
    throw new Error(
      `${sourceLabel} must be either a JSON array or an object with an 'actors' array.`
    );
  }

  return entries.map((entry, index) => normalizeActorRegistryEntry(entry, index));
}

function parseRevokedIssuedTokenIdValue(
  parsed: unknown,
  sourceLabel: string
): string[] {
  const tokenIds = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        "tokenIds" in parsed &&
        Array.isArray((parsed as { tokenIds?: unknown }).tokenIds)
      ? ((parsed as { tokenIds: unknown[] }).tokenIds)
      : undefined;

  if (!tokenIds) {
    throw new Error(
      `${sourceLabel} must be either a JSON array or an object with a 'tokenIds' array.`
    );
  }

  return tokenIds.map((tokenId, index) => {
    if (typeof tokenId !== "string" || tokenId.trim() === "") {
      throw new Error(
        `${sourceLabel} tokenIds[${index}] must be a non-empty string.`
      );
    }

    return tokenId.trim();
  });
}

function mergeActorRegistryEntries(
  baseEntries: ReadonlyArray<ActorRegistryEntry>,
  overrideEntries: ReadonlyArray<ActorRegistryEntry>
): ActorRegistryEntry[] {
  const merged = new Map<string, ActorRegistryEntry>();

  for (const entry of baseEntries) {
    merged.set(entry.actorId, entry);
  }

  for (const entry of overrideEntries) {
    merged.set(entry.actorId, entry);
  }

  return [...merged.values()];
}

function mergeRevokedIssuedTokenIds(
  baseTokenIds: ReadonlyArray<string>,
  overrideTokenIds: ReadonlyArray<string>
): string[] {
  return [...new Set([...baseTokenIds, ...overrideTokenIds])];
}

function normalizeActorTokenCredentials(
  value: unknown,
  actorId: string
): ActorRegistryEntry["authTokens"] {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  return value.map((credential, index) => {
    if (typeof credential === "string") {
      const token = credential.trim();
      if (!token) {
        throw new Error(
          `Actor registry entry '${actorId}' has an empty auth token at index ${index}.`
        );
      }
      return token;
    }

    if (!credential || typeof credential !== "object" || Array.isArray(credential)) {
      throw new Error(
        `Actor registry entry '${actorId}' authTokens[${index}] must be a string or object.`
      );
    }

    const normalized = credential as {
      token?: string;
      label?: string;
      validFrom?: string;
      validUntil?: string;
    };

    if (!normalized.token?.trim()) {
      throw new Error(
        `Actor registry entry '${actorId}' authTokens[${index}] is missing token.`
      );
    }

    return {
      token: normalized.token.trim(),
      label: normalized.label?.trim() || undefined,
      validFrom: normalized.validFrom?.trim() || undefined,
      validUntil: normalized.validUntil?.trim() || undefined
    };
  });
}