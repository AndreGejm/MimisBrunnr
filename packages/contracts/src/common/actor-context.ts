export type ActorRole =
  | "retrieval"
  | "writer"
  | "orchestrator"
  | "system"
  | "operator";

export type TransportKind = "internal" | "cli" | "http" | "mcp" | "automation";

export interface ActorContext {
  actorId: string;
  actorRole: ActorRole;
  transport: TransportKind;
  source: string;
  requestId: string;
  initiatedAt: string;
  toolName?: string;
  authToken?: string;
  allowedCorpora?: string[];
}
