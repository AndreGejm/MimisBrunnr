import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  StoredToolOutput,
  ToolOutputSpilloverRecord,
  ToolOutputStore
} from "@mimir/domain";
import {
  acquireSharedSqliteConnection,
  type SharedSqliteConnection
} from "./shared-sqlite-connection.js";

interface SqliteToolOutputRow {
  output_id: string;
  request_id: string;
  actor_id: string;
  tool_name: string;
  storage_path: string;
  byte_length: number;
  preview: string;
  created_at: string;
}

const SAFE_OUTPUT_ID = /^[A-Za-z0-9._-]+$/;

export class SqliteToolOutputStore implements ToolOutputStore {
  private readonly database: DatabaseSync;
  private readonly sharedConnection: SharedSqliteConnection;
  private readonly outputRoot: string;
  private closed = false;

  constructor(
    databasePath: string,
    outputRoot: string = path.join(path.dirname(path.resolve(databasePath)), "tool-output")
  ) {
    this.sharedConnection = acquireSharedSqliteConnection(databasePath);
    this.database = this.sharedConnection.database;
    this.outputRoot = path.resolve(outputRoot);
    this.initialize();
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.sharedConnection.release();
    this.closed = true;
  }

  async save(
    record: ToolOutputSpilloverRecord,
    content: string
  ): Promise<ToolOutputSpilloverRecord> {
    assertSafeOutputId(record.outputId);
    const storagePath = path.join(
      sanitizePathSegment(record.requestId),
      `${record.outputId}.txt`
    );
    const absolutePath = this.resolveInsideOutputRoot(storagePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");

    const storedRecord = {
      ...record,
      storagePath
    };

    this.database.prepare(`
      INSERT INTO tool_output_spillover (
        output_id,
        request_id,
        actor_id,
        tool_name,
        storage_path,
        byte_length,
        preview,
        created_at
      ) VALUES (
        :outputId,
        :requestId,
        :actorId,
        :toolName,
        :storagePath,
        :byteLength,
        :preview,
        :createdAt
      )
    `).run({
      outputId: storedRecord.outputId,
      requestId: storedRecord.requestId,
      actorId: storedRecord.actorId,
      toolName: storedRecord.toolName,
      storagePath: storedRecord.storagePath,
      byteLength: storedRecord.byteLength,
      preview: storedRecord.preview,
      createdAt: storedRecord.createdAt
    });

    return storedRecord;
  }

  async findById(outputId: string): Promise<StoredToolOutput | undefined> {
    if (!SAFE_OUTPUT_ID.test(outputId)) {
      return undefined;
    }

    const row = this.database.prepare(`
      SELECT
        output_id,
        request_id,
        actor_id,
        tool_name,
        storage_path,
        byte_length,
        preview,
        created_at
      FROM tool_output_spillover
      WHERE output_id = ?
      LIMIT 1
    `).get(outputId) as SqliteToolOutputRow | undefined;

    if (!row) {
      return undefined;
    }

    const content = await readFile(
      this.resolveInsideOutputRoot(row.storage_path),
      "utf8"
    );
    return {
      record: {
        outputId: row.output_id,
        requestId: row.request_id,
        actorId: row.actor_id,
        toolName: row.tool_name,
        storagePath: row.storage_path,
        byteLength: row.byte_length,
        preview: row.preview,
        createdAt: row.created_at
      },
      content
    };
  }

  private resolveInsideOutputRoot(storagePath: string): string {
    const absolutePath = path.resolve(this.outputRoot, storagePath);
    const relative = path.relative(this.outputRoot, absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Resolved tool output path is outside tool-output root.");
    }

    return absolutePath;
  }

  private initialize(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS tool_output_spillover (
        output_id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        byte_length INTEGER NOT NULL,
        preview TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tool_output_spillover_request_id
      ON tool_output_spillover (request_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_tool_output_spillover_actor_id
      ON tool_output_spillover (actor_id, created_at);
    `);
  }
}

function assertSafeOutputId(outputId: string): void {
  if (!SAFE_OUTPUT_ID.test(outputId)) {
    throw new Error("Invalid output id for tool output spillover.");
  }
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128);
  return sanitized || "unknown-request";
}
