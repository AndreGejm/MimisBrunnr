export interface ToolOutputSpilloverRecord {
  outputId: string;
  requestId: string;
  actorId: string;
  toolName: string;
  storagePath: string;
  byteLength: number;
  preview: string;
  createdAt: string;
}

export interface StoredToolOutput {
  record: ToolOutputSpilloverRecord;
  content: string;
}

export interface ToolOutputStore {
  save(
    record: ToolOutputSpilloverRecord,
    content: string
  ): Promise<ToolOutputSpilloverRecord>;
  findById(outputId: string): Promise<StoredToolOutput | undefined>;
}
