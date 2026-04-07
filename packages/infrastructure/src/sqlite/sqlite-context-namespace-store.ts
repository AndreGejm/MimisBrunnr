import { DatabaseSync } from "node:sqlite";
import type {
  ContextNamespaceStore
} from "@multi-agent-brain/application";
import type {
  ContextAuthorityState,
  ContextKind,
  ContextNode,
  ContextOwnerScope,
  ContextPromotionStatus,
  ContextSourceType,
  ContextSupersessionStatus
} from "@multi-agent-brain/domain";
import {
  acquireSharedSqliteConnection,
  type SharedSqliteConnection
} from "./shared-sqlite-connection.js";
import type { SqliteNoteRow } from "./sqlite-metadata-control-store.js";

const NOTE_BACKED_LIFECYCLE_STATES = ["promoted", "draft", "staged"] as const;
const NOTE_CONTEXT_KIND: ContextKind = "note";

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
    const lifecycleStates = mapAuthorityStatesToLifecycleStates(input.authorityStates);
    if (input.authorityStates && lifecycleStates.length === 0) {
      return [];
    }

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

    return rows
      .map((row) => mapSqliteNoteRowToContextNode(row))
      .filter((node): node is ContextNode => Boolean(node));
  }

  async getNodeByUri(uri: string): Promise<ContextNode | undefined> {
    const parsed = parseNamespaceUri(uri);
    if (!parsed) {
      return undefined;
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
    `).get(parsed.noteId) as SqliteNoteRow | undefined;

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

  return {
    uri: `mab://${row.corpus_id}/${NOTE_CONTEXT_KIND}/${row.note_id}`,
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


function parseNamespaceUri(
  uri: string
): { ownerScope: ContextOwnerScope; contextKind: ContextKind; noteId: string } | undefined {
  const match = /^mab:\/\/([^/]+)\/([^/]+)\/([^/?#]+)$/.exec(uri);
  if (!match) {
    return undefined;
  }

  const ownerScope = match[1] as ContextOwnerScope;
  const contextKind = match[2] as ContextKind;
  const noteId = match[3];

  return {
    ownerScope,
    contextKind,
    noteId
  };
}
