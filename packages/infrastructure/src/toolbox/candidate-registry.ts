import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { CompiledToolboxPolicy, ToolboxMutationLevel } from "@mimir/contracts";

type JsonRecord = Record<string, unknown>;
type CandidateDecision = "accepted" | "deferred" | "rejected";

const MUTATION_LEVELS = new Set<ToolboxMutationLevel>(["read", "write", "admin"]);
const CANDIDATE_DECISIONS = new Set<CandidateDecision>(["accepted", "deferred", "rejected"]);

interface ToolboxCandidateManifest {
  candidateId: string;
  displayName: string;
  upstreamUrl: string;
  targetProfile?: string;
  category?: string;
  trustClass?: string;
  mutationLevel?: ToolboxMutationLevel;
  overlapsWith: string[];
  decision: CandidateDecision;
  vettingNotes: string;
}

interface ToolboxCandidateRegistryManifest {
  id: string;
  displayName: string;
  sourceUrl: string;
  candidates: ToolboxCandidateManifest[];
}

export interface CompiledToolboxCandidate extends ToolboxCandidateManifest {}

export interface CompiledToolboxCandidateRegistry {
  id: string;
  displayName: string;
  sourceUrl: string;
  candidates: CompiledToolboxCandidate[];
  registryRevision: string;
}

export interface CompiledToolboxCandidateCatalog {
  sourceDirectory: string;
  candidateCount: number;
  registries: CompiledToolboxCandidateRegistry[];
  registryRevision: string;
}

export function compileToolboxCandidateCatalogFromDirectory(
  sourceDirectory: string,
  policy?: CompiledToolboxPolicy
): CompiledToolboxCandidateCatalog {
  const normalizedDirectory = path.resolve(sourceDirectory);
  const registryManifests = loadOptionalManifestDirectory(
    normalizedDirectory,
    "registry",
    readRegistry
  );
  validateRegistrySet(registryManifests, policy);

  const registries = Object.values(registryManifests)
    .map((registry) => {
      const normalized = {
        id: registry.id,
        displayName: registry.displayName,
        sourceUrl: registry.sourceUrl,
        candidates: sortBy(
          registry.candidates.map((candidate) => ({
            candidateId: candidate.candidateId,
            displayName: candidate.displayName,
            upstreamUrl: candidate.upstreamUrl,
            ...(candidate.targetProfile !== undefined
              ? { targetProfile: candidate.targetProfile }
              : {}),
            ...(candidate.category !== undefined ? { category: candidate.category } : {}),
            ...(candidate.trustClass !== undefined ? { trustClass: candidate.trustClass } : {}),
            ...(candidate.mutationLevel !== undefined
              ? { mutationLevel: candidate.mutationLevel }
              : {}),
            overlapsWith: uniqueSorted(candidate.overlapsWith),
            decision: candidate.decision,
            vettingNotes: candidate.vettingNotes
          })),
          (candidate) => candidate.candidateId
        )
      };

      return {
        ...normalized,
        registryRevision: hashStable(normalized)
      } satisfies CompiledToolboxCandidateRegistry;
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const normalized = {
    sourceDirectory: normalizedDirectory,
    candidateCount: registries.reduce((total, registry) => total + registry.candidates.length, 0),
    registries
  };

  return {
    ...normalized,
    registryRevision: hashStable(normalized)
  };
}

function loadOptionalManifestDirectory<T>(
  directoryPath: string,
  field: string,
  reader: (document: JsonRecord, field: string) => T
): Record<string, T & { id: string }> {
  try {
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
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function readRegistry(document: JsonRecord, field: string): ToolboxCandidateRegistryManifest {
  const registry = requireRecord(document[field], field);
  return {
    id: requireString(registry.id, `${field}.id`),
    displayName: requireString(registry.displayName, `${field}.displayName`),
    sourceUrl: requireString(registry.sourceUrl, `${field}.sourceUrl`),
    candidates: requireArray(registry.candidates, `${field}.candidates`).map((value, index) => {
      const candidate = requireRecord(value, `${field}.candidates[${index}]`);
      return {
        candidateId: requireString(candidate.candidateId, `${field}.candidates[${index}].candidateId`),
        displayName: requireString(candidate.displayName, `${field}.candidates[${index}].displayName`),
        upstreamUrl: requireString(candidate.upstreamUrl, `${field}.candidates[${index}].upstreamUrl`),
        targetProfile: optionalString(
          candidate.targetProfile,
          `${field}.candidates[${index}].targetProfile`
        ),
        category: optionalString(candidate.category, `${field}.candidates[${index}].category`),
        trustClass: optionalString(candidate.trustClass, `${field}.candidates[${index}].trustClass`),
        mutationLevel: optionalMutationLevel(
          candidate.mutationLevel,
          `${field}.candidates[${index}].mutationLevel`
        ),
        overlapsWith: optionalStringArray(
          candidate.overlapsWith,
          `${field}.candidates[${index}].overlapsWith`
        ) ?? [],
        decision: requireStringEnum(
          candidate.decision,
          `${field}.candidates[${index}].decision`,
          CANDIDATE_DECISIONS
        ),
        vettingNotes: requireString(candidate.vettingNotes, `${field}.candidates[${index}].vettingNotes`)
      } satisfies ToolboxCandidateManifest;
    })
  };
}

function validateRegistrySet(
  registries: Record<string, ToolboxCandidateRegistryManifest>,
  policy?: CompiledToolboxPolicy
): void {
  const seenCandidateIds = new Map<string, string>();

  for (const [registryId, registry] of Object.entries(registries)) {
    if (registry.candidates.length === 0) {
      throw new Error(`Candidate registry '${registryId}' must contain at least one candidate.`);
    }

    for (const candidate of registry.candidates) {
      const duplicateRegistryId = seenCandidateIds.get(candidate.candidateId);
      if (duplicateRegistryId) {
        throw new Error(
          `Candidate '${candidate.candidateId}' is declared in both '${duplicateRegistryId}' and '${registryId}'.`
        );
      }
      seenCandidateIds.set(candidate.candidateId, registryId);

      const isMappedDecision = candidate.decision === "accepted" || candidate.decision === "deferred";
      if (isMappedDecision) {
        if (!candidate.targetProfile || !candidate.category || !candidate.trustClass || !candidate.mutationLevel) {
          throw new Error(
            `Candidate '${candidate.candidateId}' in registry '${registryId}' must declare targetProfile, category, trustClass, and mutationLevel for decision '${candidate.decision}'.`
          );
        }
      }

      if (!policy) {
        continue;
      }

      if (candidate.targetProfile && !policy.profiles[candidate.targetProfile]) {
        throw new Error(
          `Candidate '${candidate.candidateId}' in registry '${registryId}' references unknown targetProfile '${candidate.targetProfile}'.`
        );
      }

      if (candidate.category) {
        const category = policy.categories[candidate.category];
        if (!category) {
          throw new Error(
            `Candidate '${candidate.candidateId}' in registry '${registryId}' references unknown category '${candidate.category}'.`
          );
        }
        if (candidate.trustClass && candidate.trustClass !== category.trustClass) {
          throw new Error(
            `Candidate '${candidate.candidateId}' in registry '${registryId}' trustClass '${candidate.trustClass}' does not match category '${candidate.category}' trustClass '${category.trustClass}'.`
          );
        }
        if (candidate.mutationLevel && candidate.mutationLevel !== category.mutationLevel) {
          throw new Error(
            `Candidate '${candidate.candidateId}' in registry '${registryId}' mutationLevel '${candidate.mutationLevel}' does not match category '${candidate.category}' mutationLevel '${category.mutationLevel}'.`
          );
        }
      }

      if (candidate.trustClass && !policy.trustClasses[candidate.trustClass]) {
        throw new Error(
          `Candidate '${candidate.candidateId}' in registry '${registryId}' references unknown trustClass '${candidate.trustClass}'.`
        );
      }
    }
  }
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

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireArray(value, field).map((entry, index) =>
    requireString(entry, `${field}[${index}]`)
  );
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

function optionalMutationLevel(
  value: unknown,
  field: string
): ToolboxMutationLevel | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = requireString(value, field);
  if (!MUTATION_LEVELS.has(normalized as ToolboxMutationLevel)) {
    throw new Error(`Field '${field}' must be one of ${[...MUTATION_LEVELS].join(", ")}.`);
  }
  return normalized as ToolboxMutationLevel;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sortBy<T>(values: T[], selector: (value: T) => string): T[] {
  return [...values].sort((left, right) => selector(left).localeCompare(selector(right)));
}

function hashStable(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}
