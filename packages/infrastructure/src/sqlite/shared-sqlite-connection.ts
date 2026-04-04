import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

interface SharedSqliteEntry {
  database: DatabaseSync;
  refCount: number;
}

export interface SharedSqliteConnection {
  database: DatabaseSync;
  release(): void;
}

const SHARED_CONNECTIONS = new Map<string, SharedSqliteEntry>();

export function acquireSharedSqliteConnection(
  databasePath: string
): SharedSqliteConnection {
  const resolvedPath = path.resolve(databasePath);
  mkdirSync(path.dirname(resolvedPath), { recursive: true });

  let entry = SHARED_CONNECTIONS.get(resolvedPath);
  if (!entry) {
    const database = new DatabaseSync(resolvedPath);
    configureConnection(database);
    entry = {
      database,
      refCount: 0
    };
    SHARED_CONNECTIONS.set(resolvedPath, entry);
  }

  entry.refCount += 1;

  return {
    database: entry.database,
    release() {
      const current = SHARED_CONNECTIONS.get(resolvedPath);
      if (!current) {
        return;
      }

      current.refCount -= 1;
      if (current.refCount <= 0) {
        current.database.close();
        SHARED_CONNECTIONS.delete(resolvedPath);
      }
    }
  };
}

function configureConnection(database: DatabaseSync): void {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
}
