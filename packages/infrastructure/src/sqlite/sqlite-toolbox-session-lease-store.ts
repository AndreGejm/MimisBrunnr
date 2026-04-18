import { DatabaseSync } from "node:sqlite";
import {
  acquireSharedSqliteConnection,
  type SharedSqliteConnection
} from "./shared-sqlite-connection.js";

export class SqliteToolboxSessionLeaseStore {
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

  revokeLeaseId(leaseId: string, reason?: string): { leaseId: string; alreadyRevoked: boolean } {
    const normalized = leaseId.trim();
    if (!normalized) {
      throw new Error("Lease ID is required.");
    }

    const existing = this.database
      .prepare("SELECT lease_id FROM toolbox_session_lease_revocations WHERE lease_id = ?")
      .get(normalized);
    if (existing) {
      return {
        leaseId: normalized,
        alreadyRevoked: true
      };
    }

    this.database
      .prepare(
        `
          INSERT INTO toolbox_session_lease_revocations (
            lease_id,
            revoked_at,
            reason
          )
          VALUES (?, ?, ?)
        `
      )
      .run(normalized, new Date().toISOString(), reason ?? null);

    return {
      leaseId: normalized,
      alreadyRevoked: false
    };
  }

  isLeaseRevoked(leaseId: string): boolean {
    const normalized = leaseId.trim();
    if (!normalized) {
      return false;
    }

    return Boolean(
      this.database
        .prepare("SELECT 1 FROM toolbox_session_lease_revocations WHERE lease_id = ?")
        .get(normalized)
    );
  }

  private initialize(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS toolbox_session_lease_revocations (
        lease_id TEXT PRIMARY KEY,
        revoked_at TEXT NOT NULL,
        reason TEXT
      );
    `);
  }
}
