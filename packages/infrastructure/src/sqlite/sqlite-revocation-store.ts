import { DatabaseSync } from "node:sqlite";
import {
  acquireSharedSqliteConnection,
  type SharedSqliteConnection
} from "./shared-sqlite-connection.js";

export interface RevokeIssuedTokenResult {
  tokenId: string;
  alreadyRevoked: boolean;
  persisted: boolean;
}

export class SqliteRevocationStore {
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

  revokeTokenId(tokenId: string, reason?: string): RevokeIssuedTokenResult {
    const normalized = tokenId.trim();
    if (!normalized) {
      throw new Error("Issued token ID is required.");
    }

    const check = this.database
      .prepare("SELECT 1 FROM token_revocations WHERE token_id = ?")
      .get(normalized);
    if (check) {
      return { tokenId: normalized, alreadyRevoked: true, persisted: true };
    }

    this.database
      .prepare(
        `
          INSERT INTO token_revocations (token_id, revoked_at, reason)
          VALUES (?, ?, ?)
        `
      )
      .run(normalized, new Date().toISOString(), reason ?? null);

    return { tokenId: normalized, alreadyRevoked: false, persisted: true };
  }

  isTokenRevoked(tokenId: string): boolean {
    const normalized = tokenId.trim();
    if (!normalized) {
      return false;
    }

    const check = this.database
      .prepare("SELECT 1 FROM token_revocations WHERE token_id = ?")
      .get(normalized);
    return Boolean(check);
  }

  listRevokedTokenIds(): string[] {
    const rows = this.database
      .prepare("SELECT token_id FROM token_revocations ORDER BY token_id ASC")
      .all() as Array<{ token_id: string }>;
    return rows.map((row) => row.token_id);
  }

  private initialize(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS token_revocations (
        token_id TEXT PRIMARY KEY,
        revoked_at TEXT NOT NULL,
        reason TEXT
      );
    `);
  }
}
