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
  sessionPolicyToken?: string;
  toolboxSessionMode?: "legacy-direct" | "toolbox-bootstrap" | "toolbox-activated";
  toolboxClientId?: string;
  toolboxProfileId?: string;
}

export interface ContextBudget {
  maxTokens: number;
  maxSources: number;
  maxRawExcerpts: number;
  maxSummarySentences: number;
}

export type CorpusId = "mimisbrunnr" | "general_notes";
export type NoteId = string;
export type ChunkId = string;
export type ControlledTag =
  | `domain/${string}`
  | `artifact/${string}`
  | `risk/${string}`
  | `project/${string}`
  | `topic/${string}`
  | `status/${string}`;

export type QueryIntent =
  | "fact_lookup"
  | "decision_lookup"
  | "implementation_guidance"
  | "status_timeline"
  | "debugging"
  | "architecture_recall";

export type NoteType =
  | "decision"
  | "constraint"
  | "bug"
  | "investigation"
  | "runbook"
  | "architecture"
  | "glossary"
  | "handoff"
  | "reference"
  | "policy";

export type NoteLifecycleState =
  | "draft"
  | "staged"
  | "validated"
  | "promoted"
  | "superseded"
  | "rejected"
  | "archived";

export interface ProvenanceRef {
  noteId: NoteId;
  chunkId?: ChunkId;
  notePath: string;
  headingPath: string[];
  excerpt?: string;
}

export interface NoteFrontmatter {
  noteId: NoteId;
  title: string;
  project: string;
  type: NoteType;
  status: NoteLifecycleState;
  updated: string;
  summary: string;
  tags: ControlledTag[];
  scope: string;
  corpusId: CorpusId;
  currentState: boolean;
  validFrom?: string;
  validUntil?: string;
  supersedes?: NoteId[];
  supersededBy?: NoteId;
}

export interface ContextCandidate {
  noteType: NoteType;
  score: number;
  summary: string;
  rawText?: string;
  scope: string;
  qualifiers: string[];
  tags: ControlledTag[];
  stalenessClass: "current" | "stale" | "superseded";
  validFrom?: string;
  validUntil?: string;
  provenance: ProvenanceRef;
}

export interface AssembleAgentContextRequest {
  actor: ActorContext;
  query: string;
  budget: ContextBudget;
  corpusIds: CorpusId[];
  includeTrace?: boolean;
  includeSessionArchives?: boolean;
  sessionId?: string;
  sessionLimit?: number;
  sessionMaxTokens?: number;
}

export interface AssembleContextPacketRequest {
  actor: ActorContext;
  intent: QueryIntent;
  budget: ContextBudget;
  candidates: ContextCandidate[];
  includeRawExcerpts: boolean;
}

export type CodingTaskType =
  | "triage"
  | "review"
  | "draft_patch"
  | "generate_tests"
  | "summarize_diff"
  | "propose_fix";

export interface CodingMemoryContextRequest {
  query?: string;
  corpusIds?: CorpusId[];
  budget?: ContextBudget;
  includeSessionArchives?: boolean;
  sessionId?: string;
  includeTrace?: boolean;
}

export interface CodingMemoryContextStatus {
  requested: boolean;
  included: boolean;
  retrievalHealth?: {
    status?: string;
  };
  traceIncluded?: boolean;
  tokenEstimate?: number;
  truncated?: boolean;
  errorMessage?: string;
}

export interface ExecuteCodingTaskRequest {
  actor: ActorContext;
  taskType: CodingTaskType;
  task: string;
  context?: string;
  memoryContext?: CodingMemoryContextRequest;
  memoryContextStatus?: CodingMemoryContextStatus;
  repoRoot?: string;
  filePath?: string;
  symbolName?: string;
  diffText?: string;
  pytestTarget?: string;
  lintTarget?: string;
}

export interface ListAgentTracesRequest {
  actor: ActorContext;
  requestId: string;
}

export interface DraftNoteRequest {
  actor: ActorContext;
  targetCorpus: CorpusId;
  noteType: NoteType;
  title: string;
  sourcePrompt: string;
  supportingSources: ProvenanceRef[];
  frontmatterOverrides?: Partial<NoteFrontmatter>;
  bodyHints?: string[];
}

export type MimirCommandRequest =
  | AssembleAgentContextRequest
  | AssembleContextPacketRequest
  | ExecuteCodingTaskRequest
  | ListAgentTracesRequest
  | DraftNoteRequest;

export type MimirToolCaller = <TArgs extends MimirCommandRequest>(
  toolName: string,
  args: TArgs
) => Promise<unknown>;
