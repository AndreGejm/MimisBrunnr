import { DatabaseSync } from "node:sqlite";
import type { ActorRole, TransportKind } from "@multi-agent-brain/contracts";
import type {
  AdministrativeAction,
  IssuedActorTokenClaims,
  OrchestratorCommand
} from "@multi-agent-brain/orchestration";
import {
  acquireSharedSqliteConnection,
  type SharedSqliteConnection
} from "./shared-sqlite-connection.js";

export interface RecordIssuedTokenResult {
  tokenId: string;
  alreadyRecorded: boolean;
  persisted: boolean;
}

export interface MarkIssuedTokenRevokedResult {
  tokenId: string;
  found: boolean;
  alreadyRevoked: boolean;
  persisted: boolean;
}

export interface IssuedTokenLifecycleRecord {
  tokenId: string;
  actorId: string;
  actorRole: ActorRole;
  source?: string;
  allowedTransports?: TransportKind[];
  allowedCommands?: OrchestratorCommand[];
  allowedAdminActions?: AdministrativeAction[];
  allowedCorpora?: string[];
  issuedAt: string;
  validFrom?: string;
  validUntil?: string;
  revokedAt?: string;
  revokedReason?: string;
  lifecycleStatus: "active" | "future" | "expired" | "revoked";
}

export interface ListIssuedTokenOptions {
  asOf?: string;
  actorId?: string;
  includeRevoked?: boolean;
  limit?: number;
}

export interface IssuedTokenLifecycleSummary {
  asOf: string;
  total: number;
  active: number;
  future: number;
  expired: number;
  revoked: number;
}

interface IssuedTokenRow {
  token_id: string;
  actor_id: string;
  actor_role: ActorRole;
  source: string | null;
  allowed_transports_json: string | null;
  allowed_commands_json: string | null;
  allowed_admin_actions_json: string | null;
  allowed_corpora_json: string | null;
  issued_at: string;
  valid_from: string | null;
  valid_until: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
}

export class SqliteIssuedTokenStore {
  private readonly database: DatabaseSync;
  private readonly sharedConnection: SharedSqliteConnection;
  private closed = false;

  constructor(databasePath: string) {
    this.sharedConnection = acquireSharedSqliteConnection(databasePath);
    this.database = this.sharedConnection.database;
    this.initialize();
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.sharedConnection.release();
    this.closed = true;
  }

  recordIssuedToken(
    claims: IssuedActorTokenClaims
  ): RecordIssuedTokenResult {
    const tokenId = claims.tokenId?.trim();
    if (!tokenId) {
      throw new Error("Issued token ID is required.");
    }

    const existing = this.database
      .prepare("SELECT 1 FROM issued_actor_tokens WHERE token_id = ?")
      .get(tokenId);
    if (existing) {
      return {
        tokenId,
        alreadyRecorded: true,
        persisted: true
      };
    }

    this.database
      .prepare(
        `
          INSERT INTO issued_actor_tokens (
            token_id,
            actor_id,
            actor_role,
            source,
            allowed_transports_json,
            allowed_commands_json,
            allowed_admin_actions_json,
            allowed_corpora_json,
            issued_at,
            valid_from,
            valid_until,
            revoked_at,
            revoked_reason
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
        `
      )
      .run(
        tokenId,
        claims.actorId,
        claims.actorRole,
        claims.source ?? null,
        serializeJsonArray(claims.allowedTransports),
        serializeJsonArray(claims.allowedCommands),
        serializeJsonArray(claims.allowedAdminActions),
        serializeJsonArray(claims.allowedCorpora),
        claims.issuedAt,
        claims.validFrom ?? null,
        claims.validUntil ?? null
      );

    return {
      tokenId,
      alreadyRecorded: false,
      persisted: true
    };
  }

  markTokenRevoked(
    tokenId: string,
    reason?: string,
    revokedAt: string = new Date().toISOString()
  ): MarkIssuedTokenRevokedResult {
    const normalized = tokenId.trim();
    if (!normalized) {
      throw new Error("Issued token ID is required.");
    }

    const existing = this.database
      .prepare(
        "SELECT revoked_at FROM issued_actor_tokens WHERE token_id = ?"
      )
      .get(normalized) as { revoked_at: string | null } | undefined;

    if (!existing) {
      return {
        tokenId: normalized,
        found: false,
        alreadyRevoked: false,
        persisted: false
      };
    }

    if (existing.revoked_at) {
      return {
        tokenId: normalized,
        found: true,
        alreadyRevoked: true,
        persisted: true
      };
    }

    this.database
      .prepare(
        `
          UPDATE issued_actor_tokens
          SET revoked_at = ?, revoked_reason = ?
          WHERE token_id = ?
        `
      )
      .run(revokedAt, reason ?? null, normalized);

    return {
      tokenId: normalized,
      found: true,
      alreadyRevoked: false,
      persisted: true
    };
  }

  listIssuedTokens(
    options: ListIssuedTokenOptions = {}
  ): IssuedTokenLifecycleRecord[] {
    const asOf = options.asOf ?? new Date().toISOString();
    const evaluationTimeMs = normalizeEvaluationTime(asOf);
    const clauses: string[] = [];
    const values: string[] = [];

    if (options.actorId?.trim()) {
      clauses.push("actor_id = ?");
      values.push(options.actorId.trim());
    }

    if (!options.includeRevoked) {
      clauses.push("revoked_at IS NULL");
    }

    const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limitClause =
      options.limit && Number.isInteger(options.limit) && options.limit > 0
        ? ` LIMIT ${options.limit}`
        : "";

    const rows = this.database
      .prepare(
        `
          SELECT
            token_id,
            actor_id,
            actor_role,
            source,
            allowed_transports_json,
            allowed_commands_json,
            allowed_admin_actions_json,
            allowed_corpora_json,
            issued_at,
            valid_from,
            valid_until,
            revoked_at,
            revoked_reason
          FROM issued_actor_tokens
          ${whereClause}
          ORDER BY issued_at DESC, token_id ASC
          ${limitClause}
        `
      )
      .all(...values) as unknown as IssuedTokenRow[];

    return rows.map((row) => mapIssuedTokenRow(row, evaluationTimeMs));
  }

  getIssuedTokenSummary(
    asOf: string = new Date().toISOString()
  ): IssuedTokenLifecycleSummary {
    const evaluationTimeMs = normalizeEvaluationTime(asOf);
    const rows = this.database
      .prepare(
        `
          SELECT
            token_id,
            actor_id,
            actor_role,
            source,
            allowed_transports_json,
            allowed_commands_json,
            allowed_admin_actions_json,
            allowed_corpora_json,
            issued_at,
            valid_from,
            valid_until,
            revoked_at,
            revoked_reason
          FROM issued_actor_tokens
        `
      )
      .all() as unknown as IssuedTokenRow[];

    const records = rows.map((row) => mapIssuedTokenRow(row, evaluationTimeMs));

    return {
      asOf,
      total: records.length,
      active: records.filter((record) => record.lifecycleStatus === "active").length,
      future: records.filter((record) => record.lifecycleStatus === "future").length,
      expired: records.filter((record) => record.lifecycleStatus === "expired").length,
      revoked: records.filter((record) => record.lifecycleStatus === "revoked").length
    };
  }

  private initialize(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS issued_actor_tokens (
        token_id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        source TEXT,
        allowed_transports_json TEXT,
        allowed_commands_json TEXT,
        allowed_admin_actions_json TEXT,
        allowed_corpora_json TEXT,
        issued_at TEXT NOT NULL,
        valid_from TEXT,
        valid_until TEXT,
        revoked_at TEXT,
        revoked_reason TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_issued_actor_tokens_actor_id
      ON issued_actor_tokens (actor_id);

      CREATE INDEX IF NOT EXISTS idx_issued_actor_tokens_issued_at
      ON issued_actor_tokens (issued_at DESC);
    `);
  }
}

function serializeJsonArray(values: ReadonlyArray<string> | undefined): string | null {
  if (!values?.length) {
    return null;
  }

  return JSON.stringify(values);
}

function parseJsonArray<T extends string>(value: string | null): T[] | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    return undefined;
  }

  return parsed.filter((entry): entry is T => typeof entry === "string");
}

function mapIssuedTokenRow(
  row: IssuedTokenRow,
  evaluationTimeMs: number
): IssuedTokenLifecycleRecord {
  return {
    tokenId: row.token_id,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    source: row.source ?? undefined,
    allowedTransports: parseJsonArray<TransportKind>(row.allowed_transports_json),
    allowedCommands: parseJsonArray<OrchestratorCommand>(row.allowed_commands_json),
    allowedAdminActions: parseJsonArray<AdministrativeAction>(row.allowed_admin_actions_json),
    allowedCorpora: parseJsonArray<string>(row.allowed_corpora_json),
    issuedAt: row.issued_at,
    validFrom: row.valid_from ?? undefined,
    validUntil: row.valid_until ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
    revokedReason: row.revoked_reason ?? undefined,
    lifecycleStatus: deriveLifecycleStatus(row, evaluationTimeMs)
  };
}

function deriveLifecycleStatus(
  row: Pick<IssuedTokenRow, "valid_from" | "valid_until" | "revoked_at">,
  evaluationTimeMs: number
): IssuedTokenLifecycleRecord["lifecycleStatus"] {
  if (row.revoked_at) {
    return "revoked";
  }

  const validFromMs = row.valid_from ? normalizeEvaluationTime(row.valid_from) : undefined;
  const validUntilMs = row.valid_until ? normalizeEvaluationTime(row.valid_until) : undefined;

  if (validFromMs !== undefined && evaluationTimeMs < validFromMs) {
    return "future";
  }

  if (validUntilMs !== undefined && evaluationTimeMs > validUntilMs) {
    return "expired";
  }

  return "active";
}

function normalizeEvaluationTime(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid evaluation time '${value}'.`);
  }

  return parsed;
}
