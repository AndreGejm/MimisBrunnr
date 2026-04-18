import { DatabaseSync } from "node:sqlite";
import type { ActorRole, TransportKind } from "@mimir/contracts";
import {
  acquireSharedSqliteConnection,
  type SharedSqliteConnection
} from "./shared-sqlite-connection.js";

export interface AuthIssuerControlRecord {
  actorId: string;
  enabled: boolean;
  allowIssueAuthToken: boolean;
  allowRevokeAuthToken: boolean;
  validFrom?: string;
  validUntil?: string;
  reason?: string;
  updatedAt: string;
  updatedByActorId?: string;
  updatedByActorRole?: ActorRole;
  updatedBySource?: string;
  updatedByTransport?: TransportKind;
}

interface AuthIssuerControlRow {
  actor_id: string;
  enabled: number;
  allow_issue_auth_token: number;
  allow_revoke_auth_token: number;
  valid_from: string | null;
  valid_until: string | null;
  reason: string | null;
  updated_at: string;
  updated_by_actor_id: string | null;
  updated_by_actor_role: ActorRole | null;
  updated_by_source: string | null;
  updated_by_transport: TransportKind | null;
}

export class SqliteAuthIssuerControlStore {
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

  listIssuerControls(options: { actorId?: string } = {}): AuthIssuerControlRecord[] {
    const clauses: string[] = [];
    const values: string[] = [];

    if (options.actorId?.trim()) {
      clauses.push("actor_id = ?");
      values.push(options.actorId.trim());
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.database
      .prepare(
        `
          SELECT
            actor_id,
            enabled,
            allow_issue_auth_token,
            allow_revoke_auth_token,
            valid_from,
            valid_until,
            reason,
            updated_at,
            updated_by_actor_id,
            updated_by_actor_role,
            updated_by_source,
            updated_by_transport
          FROM auth_issuer_controls
          ${whereClause}
          ORDER BY actor_id ASC
        `
      )
      .all(...values) as unknown as AuthIssuerControlRow[];

    return rows.map(mapAuthIssuerControlRow);
  }

  upsertIssuerControl(record: AuthIssuerControlRecord): AuthIssuerControlRecord {
    const actorId = record.actorId.trim();
    if (!actorId) {
      throw new Error("Auth issuer control actorId is required.");
    }

    this.database
      .prepare(
        `
          INSERT INTO auth_issuer_controls (
            actor_id,
            enabled,
            allow_issue_auth_token,
            allow_revoke_auth_token,
            valid_from,
            valid_until,
            reason,
            updated_at,
            updated_by_actor_id,
            updated_by_actor_role,
            updated_by_source,
            updated_by_transport
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(actor_id) DO UPDATE SET
            enabled = excluded.enabled,
            allow_issue_auth_token = excluded.allow_issue_auth_token,
            allow_revoke_auth_token = excluded.allow_revoke_auth_token,
            valid_from = excluded.valid_from,
            valid_until = excluded.valid_until,
            reason = excluded.reason,
            updated_at = excluded.updated_at,
            updated_by_actor_id = excluded.updated_by_actor_id,
            updated_by_actor_role = excluded.updated_by_actor_role,
            updated_by_source = excluded.updated_by_source,
            updated_by_transport = excluded.updated_by_transport
        `
      )
      .run(
        actorId,
        record.enabled ? 1 : 0,
        record.allowIssueAuthToken ? 1 : 0,
        record.allowRevokeAuthToken ? 1 : 0,
        record.validFrom ?? null,
        record.validUntil ?? null,
        record.reason ?? null,
        record.updatedAt,
        record.updatedByActorId ?? null,
        record.updatedByActorRole ?? null,
        record.updatedBySource ?? null,
        record.updatedByTransport ?? null
      );

    return {
      actorId,
      enabled: record.enabled,
      allowIssueAuthToken: record.allowIssueAuthToken,
      allowRevokeAuthToken: record.allowRevokeAuthToken,
      validFrom: record.validFrom,
      validUntil: record.validUntil,
      reason: record.reason,
      updatedAt: record.updatedAt,
      updatedByActorId: record.updatedByActorId,
      updatedByActorRole: record.updatedByActorRole,
      updatedBySource: record.updatedBySource,
      updatedByTransport: record.updatedByTransport
    };
  }

  private initialize(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS auth_issuer_controls (
        actor_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL,
        allow_issue_auth_token INTEGER NOT NULL,
        allow_revoke_auth_token INTEGER NOT NULL,
        valid_from TEXT,
        valid_until TEXT,
        reason TEXT,
        updated_at TEXT NOT NULL,
        updated_by_actor_id TEXT,
        updated_by_actor_role TEXT,
        updated_by_source TEXT,
        updated_by_transport TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_auth_issuer_controls_updated_at
      ON auth_issuer_controls (updated_at DESC);
    `);
  }
}

function mapAuthIssuerControlRow(
  row: AuthIssuerControlRow
): AuthIssuerControlRecord {
  return {
    actorId: row.actor_id,
    enabled: row.enabled === 1,
    allowIssueAuthToken: row.allow_issue_auth_token === 1,
    allowRevokeAuthToken: row.allow_revoke_auth_token === 1,
    validFrom: row.valid_from ?? undefined,
    validUntil: row.valid_until ?? undefined,
    reason: row.reason ?? undefined,
    updatedAt: row.updated_at,
    updatedByActorId: row.updated_by_actor_id ?? undefined,
    updatedByActorRole: row.updated_by_actor_role ?? undefined,
    updatedBySource: row.updated_by_source ?? undefined,
    updatedByTransport: row.updated_by_transport ?? undefined
  };
}
