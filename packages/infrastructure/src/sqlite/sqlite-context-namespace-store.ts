import { DatabaseSync } from "node:sqlite";
import type {
  ContextNamespaceStore
} from "@mimir/application";
import type {
  ContextAuthorityState,
  ContextKind,
  ContextNode,
  ContextOwnerScope,
  ContextPromotionStatus,
  ContextSourceType,
  ContextSupersessionStatus,
  SessionArchive
} from "@mimir/domain";
import {
  assertContextNodeAuthorityInvariants
} from "@mimir/domain";
import {
  acquireSharedSqliteConnection,
  type SharedSqliteConnection
} from "./shared-sqlite-connection.js";
import type { SqliteNoteRow } from "./sqlite-metadata-control-store.js";

const NOTE_BACKED_LIFECYCLE_STATES = ["promoted", "draft", "staged"] as const;
const NOTE_CONTEXT_KIND: ContextKind = "note";
const IMPORT_CONTEXT_KIND: ContextKind = "resource";
const IMPORT_OWNER_SCOPE: ContextOwnerScope = "imports";
const SESSION_CONTEXT_KIND: ContextKind = "session_archive";
const SESSION_OWNER_SCOPE: ContextOwnerScope = "sessions";

interface SqliteImportJobRow {
  import_job_id: string;
  authority_state: "imported";
  state: string;
  source_path: string;
  import_kind: string;
  source_name: string;
  source_digest: string;
  source_size_bytes: number;
  source_preview: string;
  draft_note_ids_json: string;
  canonical_outputs_json: string;
  created_at: string;
  updated_at: string;
}

interface SqliteSessionArchiveRow {
  archive_id: string;
  session_id: string;
  uri: string;
  authority_state: SessionArchive["authorityState"];
  promotion_status: SessionArchive["promotionStatus"];
  message_count: number;
  created_at: string;
}

export class SqliteContextNamespaceStore implements ContextNamespaceStore {
  private readonly database: DatabaseSync;
  private readonly sharedConnection: SharedSqliteConnection;
  private closed = false;

  constructor(databasePath: string) {
    this.sharedConnection = acquireSharedSqliteConnection(databasePath);
    this.database = this.sharedConnection.database;
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.sharedConnection.release();
    this.closed = true;
  }

  async listNodes(input: {
    ownerScope?: ContextOwnerScope;
    authorityStates?: ContextAuthorityState[];
  }): Promise<ContextNode[]> {
    const nodes: ContextNode[] = [];

    if (shouldIncludeNoteBackedNodes(input)) {
      const lifecycleStates = mapAuthorityStatesToLifecycleStates(input.authorityStates);
      if (!(input.authorityStates && lifecycleStates.length === 0)) {
        const whereClauses = [`lifecycle_state IN (${lifecycleStates.map(() => "?").join(", ")})`];
        const parameters: string[] = [...lifecycleStates];

        if (input.ownerScope) {
          whereClauses.push("corpus_id = ?");
          parameters.push(input.ownerScope);
        }

        const rows = this.database.prepare(`
          SELECT
            note_id,
            corpus_id,
            note_path,
            note_type,
            lifecycle_state,
            revision,
            updated_at,
            current_state,
            valid_from,
            valid_until,
            summary,
            scope,
            content_hash,
            semantic_signature
          FROM notes
          WHERE ${whereClauses.join(" AND ")}
          ORDER BY corpus_id ASC, lifecycle_state ASC, updated_at DESC, note_id ASC
        `).all(...parameters) as unknown as SqliteNoteRow[];

        nodes.push(
          ...rows
            .map((row) => mapSqliteNoteRowToContextNode(row))
            .filter((node): node is ContextNode => Boolean(node))
        );
      }
    }

    if (shouldIncludeSessionArchiveNodes(input)) {
      const rows = this.database.prepare(`
        SELECT
          archive_id,
          session_id,
          uri,
          authority_state,
          promotion_status,
          message_count,
          created_at
        FROM session_archives
        ORDER BY created_at DESC, archive_id ASC
      `).all() as unknown as SqliteSessionArchiveRow[];

      nodes.push(...rows.map((row) => mapSessionArchiveRowToContextNode(row)));
    }

    if (shouldIncludeImportArtifactNodes(input)) {
      const rows = this.database.prepare(`
        SELECT
          import_job_id,
          authority_state,
          state,
          source_path,
          import_kind,
          source_name,
          source_digest,
          source_size_bytes,
          source_preview,
          draft_note_ids_json,
          canonical_outputs_json,
          created_at,
          updated_at
        FROM import_jobs
        ORDER BY created_at DESC, import_job_id ASC
      `).all() as unknown as SqliteImportJobRow[];

      nodes.push(...rows.map((row) => mapImportJobRowToContextNode(row)));
    }

    return nodes.sort((left, right) => {
      if (left.ownerScope !== right.ownerScope) {
        return left.ownerScope.localeCompare(right.ownerScope);
      }
      if (left.contextKind !== right.contextKind) {
        return left.contextKind.localeCompare(right.contextKind);
      }
      if (left.updatedAt !== right.updatedAt) {
        return right.updatedAt.localeCompare(left.updatedAt);
      }
      return left.sourceRef.localeCompare(right.sourceRef);
    });
  }

  async getNodeByUri(uri: string): Promise<ContextNode | undefined> {
    const parsed = parseNamespaceUri(uri);
    if (!parsed) {
      return undefined;
    }

    if (parsed.ownerScope === SESSION_OWNER_SCOPE && parsed.contextKind === SESSION_CONTEXT_KIND) {
      const archive = this.database.prepare(`
        SELECT
          archive_id,
          session_id,
          uri,
          authority_state,
          promotion_status,
          message_count,
          created_at
        FROM session_archives
        WHERE archive_id = ?
        LIMIT 1
      `).get(parsed.recordId) as SqliteSessionArchiveRow | undefined;

      if (!archive) {
        return undefined;
      }

      const node = mapSessionArchiveRowToContextNode(archive);
      return node.uri === uri ? node : undefined;
    }

    if (parsed.ownerScope === IMPORT_OWNER_SCOPE && parsed.contextKind === IMPORT_CONTEXT_KIND) {
      const importJob = this.database.prepare(`
        SELECT
          import_job_id,
          authority_state,
          state,
          source_path,
          import_kind,
          source_name,
          source_digest,
          source_size_bytes,
          source_preview,
          draft_note_ids_json,
          canonical_outputs_json,
          created_at,
          updated_at
        FROM import_jobs
        WHERE import_job_id = ?
        LIMIT 1
      `).get(parsed.recordId) as SqliteImportJobRow | undefined;

      if (!importJob) {
        return undefined;
      }

      const node = mapImportJobRowToContextNode(importJob);
      return node.uri === uri ? node : undefined;
    }

    const row = this.database.prepare(`
      SELECT
        note_id,
        corpus_id,
        note_path,
        note_type,
        lifecycle_state,
        revision,
        updated_at,
        current_state,
        valid_from,
        valid_until,
        summary,
        scope,
        content_hash,
        semantic_signature
      FROM notes
      WHERE note_id = ?
      LIMIT 1
    `).get(parsed.recordId) as SqliteNoteRow | undefined;

    if (!row) {
      return undefined;
    }

    const node = mapSqliteNoteRowToContextNode(row);
    if (!node || node.uri !== uri) {
      return undefined;
    }

    return node;
  }
}

function mapSqliteNoteRowToContextNode(row: SqliteNoteRow): ContextNode | undefined {
  const authorityState = deriveAuthorityState(row.lifecycle_state);
  if (!authorityState) {
    return undefined;
  }

  const freshness = deriveFreshness(row);

  const node: ContextNode = {
    uri: `mimir://${row.corpus_id}/${NOTE_CONTEXT_KIND}/${row.note_id}`,
    ownerScope: row.corpus_id,
    contextKind: NOTE_CONTEXT_KIND,
    authorityState,
    sourceType: deriveSourceType(authorityState),
    sourceRef: row.note_id,
    freshness,
    representationAvailability: {
      L0: false,
      L1: false,
      L2: true
    },
    promotionStatus: derivePromotionStatus(row.lifecycle_state),
    supersessionStatus: deriveSupersessionStatus(row),
    createdAt: row.updated_at,
    updatedAt: row.updated_at
  };

  assertContextNodeAuthorityInvariants(node);
  return node;
}

function mapSessionArchiveRowToContextNode(row: SqliteSessionArchiveRow): ContextNode {
  const node: ContextNode = {
    uri: row.uri,
    ownerScope: SESSION_OWNER_SCOPE,
    contextKind: SESSION_CONTEXT_KIND,
    authorityState: row.authority_state,
    sourceType: "session_archive",
    sourceRef: row.archive_id,
    freshness: {
      validFrom: row.created_at,
      validUntil: row.created_at,
      freshnessClass: "current",
      freshnessReason: "Immutable session archive."
    },
    representationAvailability: {
      L0: false,
      L1: false,
      L2: true
    },
    promotionStatus: row.promotion_status,
    supersessionStatus: "archived",
    createdAt: row.created_at,
    updatedAt: row.created_at
  };

  assertContextNodeAuthorityInvariants(node);
  return node;
}

function mapImportJobRowToContextNode(row: SqliteImportJobRow): ContextNode {
  const node: ContextNode = {
    uri: `mimir://${IMPORT_OWNER_SCOPE}/${IMPORT_CONTEXT_KIND}/${row.import_job_id}`,
    ownerScope: IMPORT_OWNER_SCOPE,
    contextKind: IMPORT_CONTEXT_KIND,
    authorityState: row.authority_state,
    sourceType: "import_artifact",
    sourceRef: row.import_job_id,
    freshness: {
      validFrom: row.created_at,
      validUntil: row.updated_at,
      freshnessClass: "current",
      freshnessReason: "Imported artifacts remain read-only until reviewed."
    },
    representationAvailability: {
      L0: false,
      L1: false,
      L2: true
    },
    promotionStatus: "not_applicable",
    supersessionStatus: "not_applicable",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };

  assertContextNodeAuthorityInvariants(node);
  return node;
}

function deriveAuthorityState(
  lifecycleState: SqliteNoteRow["lifecycle_state"]
): ContextAuthorityState | undefined {
  switch (lifecycleState) {
    case "promoted":
      return "canonical";
    case "draft":
    case "staged":
      return "staging";
    default:
      return undefined;
  }
}

function deriveSourceType(authorityState: ContextAuthorityState): ContextSourceType {
  switch (authorityState) {
    case "canonical":
      return "canonical_note";
    case "staging":
      return "staging_draft";
    default:
      return "derived_projection";
  }
}

function derivePromotionStatus(
  lifecycleState: SqliteNoteRow["lifecycle_state"]
): ContextPromotionStatus {
  switch (lifecycleState) {
    case "promoted":
      return "promoted";
    case "draft":
    case "staged":
      return "pending_review";
    default:
      return "not_applicable";
  }
}

function deriveSupersessionStatus(
  row: Pick<SqliteNoteRow, "note_path" | "lifecycle_state" | "current_state">
): ContextSupersessionStatus {
  if (row.lifecycle_state !== "promoted") {
    return "not_applicable";
  }

  if (row.note_path.includes("/current-state/")) {
    return "snapshot";
  }

  return row.current_state === 1 ? "active" : "archived";
}

function deriveFreshness(
  row: Pick<SqliteNoteRow, "updated_at" | "valid_from" | "valid_until">,
): ContextNode["freshness"] {
  const validFrom = row.valid_from ?? row.updated_at;
  const validUntil = row.valid_until ?? row.updated_at;
  const hasExplicitWindow = Boolean(row.valid_from || row.valid_until);
  const freshnessClass = hasExplicitWindow
    ? determineFreshnessClass(validFrom, validUntil, new Date())
    : "current";
  const freshnessReason = buildFreshnessReason(
    row.valid_from,
    row.valid_until,
    freshnessClass
  );

  return {
    validFrom,
    validUntil,
    freshnessClass,
    freshnessReason
  };
}

function determineFreshnessClass(
  validFrom: string,
  validUntil: string,
  currentTimestamp: Date
): ContextNode["freshness"]["freshnessClass"] {
  const current = currentTimestamp.getTime();
  const validFromTime = Date.parse(validFrom);
  const validUntilTime = Date.parse(validUntil);

  if (!Number.isNaN(validFromTime) && current < validFromTime) {
    return "future_dated";
  }

  if (!Number.isNaN(validUntilTime) && current > validUntilTime) {
    return "expired";
  }

  if (!Number.isNaN(validUntilTime) && isWithinDays(validUntilTime, current, 14)) {
    return "expiring_soon";
  }

  return "current";
}

function buildFreshnessReason(
  validFrom: string | null | undefined,
  validUntil: string | null | undefined,
  freshnessClass: ContextNode["freshness"]["freshnessClass"]
): string {
  if (!validFrom && !validUntil) {
    return "Projected from a note without an explicit validity window.";
  }

  switch (freshnessClass) {
    case "future_dated":
      return "Projected validity window starts in the future.";
    case "expired":
      return "Projected validity window has expired.";
    case "expiring_soon":
      return "Projected validity window expires soon.";
    default:
      return "Projected from the current validity window.";
  }
}

function isWithinDays(targetTime: number, currentTime: number, days: number): boolean {
  const difference = targetTime - currentTime;
  return difference >= 0 && difference <= days * 86_400_000;
}

function mapAuthorityStatesToLifecycleStates(
  authorityStates?: ContextAuthorityState[]
): Array<SqliteNoteRow["lifecycle_state"]> {
  const mapped = new Set<SqliteNoteRow["lifecycle_state"]>();
  const selectedAuthorityStates = authorityStates ?? ["canonical", "staging"];

  for (const authorityState of selectedAuthorityStates) {
    switch (authorityState) {
      case "canonical":
        mapped.add("promoted");
        break;
      case "staging":
        mapped.add("draft");
        mapped.add("staged");
        break;
      default:
        break;
    }
  }

  return [...mapped].filter((state) => NOTE_BACKED_LIFECYCLE_STATES.includes(state as typeof NOTE_BACKED_LIFECYCLE_STATES[number]));
}

function shouldIncludeNoteBackedNodes(input: {
  ownerScope?: ContextOwnerScope;
  authorityStates?: ContextAuthorityState[];
}): boolean {
  if (input.ownerScope === SESSION_OWNER_SCOPE || input.ownerScope === IMPORT_OWNER_SCOPE) {
    return false;
  }

  return true;
}

function shouldIncludeSessionArchiveNodes(input: {
  ownerScope?: ContextOwnerScope;
  authorityStates?: ContextAuthorityState[];
}): boolean {
  if (input.ownerScope === SESSION_OWNER_SCOPE) {
    return !input.authorityStates || input.authorityStates.includes("session");
  }

  return input.authorityStates?.includes("session") ?? false;
}

function shouldIncludeImportArtifactNodes(input: {
  ownerScope?: ContextOwnerScope;
  authorityStates?: ContextAuthorityState[];
}): boolean {
  if (input.ownerScope === IMPORT_OWNER_SCOPE) {
    return !input.authorityStates || input.authorityStates.includes("imported");
  }

  return input.authorityStates?.includes("imported") ?? false;
}


function parseNamespaceUri(
  uri: string
): { ownerScope: ContextOwnerScope; contextKind: ContextKind; recordId: string } | undefined {
  const match = /^mimir:\/\/([^/]+)\/([^/]+)\/([^/?#]+)$/.exec(uri);
  if (!match) {
    return undefined;
  }

  const ownerScope = match[1] as ContextOwnerScope;
  const contextKind = match[2] as ContextKind;
  const noteId = match[3];

  return {
    ownerScope,
    contextKind,
    recordId: noteId
  };
}
