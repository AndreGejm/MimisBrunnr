import type {
  ActorRole,
  TransportKind
} from "@mimir/contracts";
import type { OrchestratorCommand } from "../routing/task-family-router.js";
import type { AdministrativeAction } from "./administrative-action.js";
import type {
  ActorRegistryEntry,
  ActorRegistryEntryStatus
} from "./actor-authorization-policy.js";

export interface NormalizedActorRegistryEntry {
  actorId: string;
  actorRole: ActorRole;
  authTokens?: ReadonlyArray<NormalizedActorTokenCredential>;
  source?: string;
  enabled: boolean;
  allowedTransports?: ReadonlySet<TransportKind>;
  allowedCommands?: ReadonlySet<OrchestratorCommand>;
  allowedAdminActions?: ReadonlySet<AdministrativeAction>;
  validFromMs?: number;
  validUntilMs?: number;
}

export interface NormalizedActorTokenCredential {
  token: string;
  label?: string;
  validFromMs?: number;
  validUntilMs?: number;
}

export function buildActorRegistry(
  entries: ReadonlyArray<ActorRegistryEntry>
): ReadonlyMap<string, NormalizedActorRegistryEntry> {
  return new Map(entries.map((entry) => [entry.actorId, normalizeActorRegistryEntry(entry)]));
}

export function normalizeActorRegistryEntry(
  entry: ActorRegistryEntry
): NormalizedActorRegistryEntry {
  return {
    actorId: entry.actorId.trim(),
    actorRole: entry.actorRole,
    authTokens: normalizeTokenCredentials(entry),
    source: entry.source?.trim() || undefined,
    enabled: entry.enabled ?? true,
    allowedTransports:
      entry.allowedTransports && entry.allowedTransports.length > 0
        ? new Set(entry.allowedTransports)
        : undefined,
    allowedCommands:
      entry.allowedCommands && entry.allowedCommands.length > 0
        ? new Set(entry.allowedCommands)
        : undefined,
    allowedAdminActions:
      entry.allowedAdminActions && entry.allowedAdminActions.length > 0
        ? new Set(entry.allowedAdminActions)
        : undefined,
    validFromMs: parseValidityInstant(
      entry.validFrom,
      `actor '${entry.actorId}' validFrom`
    ),
    validUntilMs: parseValidityInstant(
      entry.validUntil,
      `actor '${entry.actorId}' validUntil`
    )
  };
}

export function normalizeTokenCredentials(
  entry: ActorRegistryEntry
): ReadonlyArray<NormalizedActorTokenCredential> | undefined {
  const credentials: NormalizedActorTokenCredential[] = [];

  if (entry.authToken?.trim()) {
    credentials.push({ token: entry.authToken.trim() });
  }

  for (const credential of entry.authTokens ?? []) {
    if (typeof credential === "string") {
      const token = credential.trim();
      if (token) {
        credentials.push({ token });
      }
      continue;
    }

    const token = credential.token?.trim();
    if (!token) {
      continue;
    }

    credentials.push({
      token,
      label: credential.label?.trim() || undefined,
      validFromMs: parseValidityInstant(
        credential.validFrom,
        `actor '${entry.actorId}' token '${credential.label ?? token}' validFrom`
      ),
      validUntilMs: parseValidityInstant(
        credential.validUntil,
        `actor '${entry.actorId}' token '${credential.label ?? token}' validUntil`
      )
    });
  }

  return credentials.length > 0 ? credentials : undefined;
}

export function parseValidityInstant(
  value: string | undefined,
  label: string
): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid ISO-8601 timestamp.`);
  }

  return parsed;
}

export function summarizeActorRegistryEntry(
  entry: NormalizedActorRegistryEntry,
  evaluationTimeMs: number
): ActorRegistryEntryStatus {
  const credentials = entry.authTokens ?? [];
  const activeCredentialCount = credentials.filter((credential) =>
    isWithinValidityWindow(
      evaluationTimeMs,
      credential.validFromMs,
      credential.validUntilMs
    )
  ).length;
  const futureCredentialCount = credentials.filter(
    (credential) =>
      credential.validFromMs !== undefined && evaluationTimeMs < credential.validFromMs
  ).length;
  const expiredCredentialCount = credentials.filter(
    (credential) =>
      credential.validUntilMs !== undefined && evaluationTimeMs > credential.validUntilMs
  ).length;

  return {
    actorId: entry.actorId,
    actorRole: entry.actorRole,
    source: entry.source,
    enabled: entry.enabled,
    lifecycleStatus: deriveActorLifecycleStatus(entry, evaluationTimeMs),
    allowedTransports: entry.allowedTransports
      ? [...entry.allowedTransports]
      : undefined,
    allowedCommands: entry.allowedCommands ? [...entry.allowedCommands] : undefined,
    allowedAdminActions: entry.allowedAdminActions
      ? [...entry.allowedAdminActions]
      : undefined,
    staticCredentialCount: credentials.length,
    activeCredentialCount,
    futureCredentialCount,
    expiredCredentialCount
  };
}

export function deriveActorLifecycleStatus(
  entry: NormalizedActorRegistryEntry,
  evaluationTimeMs: number
): ActorRegistryEntryStatus["lifecycleStatus"] {
  if (!entry.enabled) {
    return "disabled";
  }

  if (entry.validFromMs !== undefined && evaluationTimeMs < entry.validFromMs) {
    return "future";
  }

  if (entry.validUntilMs !== undefined && evaluationTimeMs > entry.validUntilMs) {
    return "expired";
  }

  return "active";
}

export function normalizeEvaluationTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export function isWithinValidityWindow(
  evaluationTimeMs: number,
  validFromMs?: number,
  validUntilMs?: number
): boolean {
  if (validFromMs !== undefined && evaluationTimeMs < validFromMs) {
    return false;
  }

  if (validUntilMs !== undefined && evaluationTimeMs > validUntilMs) {
    return false;
  }

  return true;
}

export function findStaticCredentialMatch(
  registry: ReadonlyMap<string, NormalizedActorRegistryEntry>,
  token: string
): {
  entry: NormalizedActorRegistryEntry;
  credential: NormalizedActorTokenCredential;
} | null {
  for (const entry of registry.values()) {
    for (const credential of entry.authTokens ?? []) {
      if (credential.token === token) {
        return { entry, credential };
      }
    }
  }

  return null;
}