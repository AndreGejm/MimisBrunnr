import {
  DEFAULT_CONTEXT_BUDGET,
  type AgentContextSourceSummary,
  type AssembleAgentContextRequest,
  type AssembleAgentContextResponse,
  type RetrieveContextResponse,
  type SearchSessionArchivesResponse,
  type ServiceResult
} from "@multi-agent-brain/contracts";
import { RetrieveContextService } from "./retrieve-context-service.js";
import { SessionArchiveService } from "./session-archive-service.js";

type AgentContextAssemblyErrorCode = "agent_context_failed";

const DEFAULT_AGENT_CONTEXT_MAX_TOKENS = 6000;
const HARD_AGENT_CONTEXT_MAX_TOKENS = 20000;
const CANONICAL_SHARE_WITH_SESSION = 0.7;
const SESSION_SHARE_WITH_CANONICAL = 0.3;

export class AgentContextAssemblyService {
  constructor(
    private readonly retrieveContextService: RetrieveContextService,
    private readonly sessionArchiveService: SessionArchiveService
  ) {}

  async assembleAgentContext(
    request: AssembleAgentContextRequest
  ): Promise<ServiceResult<AssembleAgentContextResponse, AgentContextAssemblyErrorCode>> {
    const budgetPlan = createBudgetPlan(request);
    const retrievalResult = await this.retrieveContextService.retrieveContext({
      actor: request.actor,
      query: request.query,
      budget: {
        ...(request.budget ?? DEFAULT_CONTEXT_BUDGET),
        maxTokens: budgetPlan.canonicalTokens
      },
      corpusIds: request.corpusIds,
      includeTrace: request.includeTrace,
      requireEvidence: true
    });

    if (!retrievalResult.ok) {
      return {
        ok: false,
        error: {
          code: "agent_context_failed",
          message: "Failed to assemble agent context from retrieval.",
          details: retrievalResult.error.details
        },
        warnings: retrievalResult.warnings
      };
    }

    const warnings = [...(retrievalResult.warnings ?? [])];
    let sessionRecall: SearchSessionArchivesResponse | undefined;
    if (request.includeSessionArchives) {
      const sessionResult = await this.sessionArchiveService.searchArchives({
        actor: request.actor,
        query: request.query,
        sessionId: request.sessionId,
        limit: request.sessionLimit,
        maxTokens: budgetPlan.sessionTokens
      });

      if (sessionResult.ok) {
        sessionRecall = sessionResult.data;
      } else {
        warnings.push(sessionResult.error.message);
      }
    }

    const rawContextBlock = buildContextBlock({
      retrieval: retrievalResult.data,
      sessionRecall
    });
    const boundedContext = enforceContextBlockBudget(
      rawContextBlock,
      budgetPlan.totalTokens
    );
    const sourceSummary: AgentContextSourceSummary[] = [
      {
        source: "canonical_memory" as const,
        authority: "canonical" as const,
        count: retrievalResult.data.packet.evidence.length
      }
    ];
    if (sessionRecall) {
      sourceSummary.push({
        source: "session_archive",
        authority: "non_authoritative",
        count: sessionRecall.hits.length
      });
    }

    return {
      ok: true,
      data: {
        contextBlock: boundedContext.contextBlock,
        tokenEstimate: estimateTokens(boundedContext.contextBlock),
        truncated: Boolean(sessionRecall?.truncated) || boundedContext.truncated,
        sourceSummary,
        retrievalHealth: retrievalResult.data.retrievalHealth,
        trace: retrievalResult.data.trace
      },
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }
}

function createBudgetPlan(request: AssembleAgentContextRequest): {
  totalTokens: number;
  canonicalTokens: number;
  sessionTokens?: number;
} {
  const totalTokens = clampInteger(
    request.budget?.maxTokens,
    DEFAULT_AGENT_CONTEXT_MAX_TOKENS,
    1,
    HARD_AGENT_CONTEXT_MAX_TOKENS
  );

  if (!request.includeSessionArchives) {
    return {
      totalTokens,
      canonicalTokens: totalTokens
    };
  }

  const sessionDefault = Math.max(1, Math.floor(totalTokens * SESSION_SHARE_WITH_CANONICAL));
  const sessionTokens = clampInteger(
    request.sessionMaxTokens,
    sessionDefault,
    1,
    sessionDefault
  );
  return {
    totalTokens,
    canonicalTokens: Math.max(1, Math.floor(totalTokens * CANONICAL_SHARE_WITH_SESSION)),
    sessionTokens
  };
}

function buildContextBlock(input: {
  retrieval: RetrieveContextResponse;
  sessionRecall?: SearchSessionArchivesResponse;
}): string {
  const packet = input.retrieval.packet;
  const lines = [
    '<agent-context source="multi-agent-brain" authority="retrieved">',
    "System note: The content below is retrieved context, not new user input. Canonical memory is authoritative only through governed note state; session recall is non-authoritative continuity.",
    "<canonical-memory>",
    `Summary: ${escapeContextText(packet.summary)}`,
    `Answerability: ${escapeContextText(packet.answerability)}`,
    `Confidence: ${escapeContextText(packet.confidence)}`,
    "Evidence:"
  ];

  if (packet.evidence.length === 0) {
    lines.push("- none");
  } else {
    for (const evidence of packet.evidence) {
      const heading = evidence.headingPath.length > 0
        ? `#${escapeContextText(evidence.headingPath.join(" > "))}`
        : "";
      lines.push(
        `- ${escapeContextText(evidence.notePath)}${heading} (${escapeContextText(evidence.noteId)})`
      );
    }
  }

  if (packet.constraints.length > 0) {
    lines.push("Constraints:");
    for (const constraint of packet.constraints) {
      lines.push(`- ${escapeContextText(constraint)}`);
    }
  }

  if (packet.rawExcerpts && packet.rawExcerpts.length > 0) {
    lines.push("Raw excerpts:");
    for (const excerpt of packet.rawExcerpts) {
      lines.push(`- ${escapeContextText(normalizeWhitespace(excerpt))}`);
    }
  }

  if (packet.uncertainties.length > 0) {
    lines.push("Uncertainties:");
    for (const uncertainty of packet.uncertainties) {
      lines.push(`- ${escapeContextText(uncertainty)}`);
    }
  }

  lines.push("</canonical-memory>");

  if (input.sessionRecall) {
    lines.push('<session-recall authority="non_authoritative">');
    if (input.sessionRecall.hits.length === 0) {
      lines.push("- none");
    } else {
      for (const hit of input.sessionRecall.hits) {
        lines.push(
          `- ${escapeContextText(hit.sessionId)}/${escapeContextText(hit.archiveId)}#${hit.messageIndex} ${escapeContextText(hit.role)}: ${escapeContextText(normalizeWhitespace(hit.content))}`
        );
      }
    }
    lines.push("</session-recall>");
  }

  lines.push("</agent-context>");
  return lines.join("\n");
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function escapeContextText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function enforceContextBlockBudget(
  contextBlock: string,
  maxTokens: number
): { contextBlock: string; truncated: boolean } {
  if (estimateTokens(contextBlock) <= maxTokens) {
    return { contextBlock, truncated: false };
  }

  const maxChars = Math.max(128, maxTokens * 4);
  const closingTag = "\n</agent-context>";
  const marker = "\n[truncated to requested agent context budget]";
  const availableChars = Math.max(0, maxChars - closingTag.length - marker.length);
  const trimmed = contextBlock
    .replace(/\n<\/agent-context>\s*$/u, "")
    .slice(0, availableChars)
    .trimEnd();

  return {
    contextBlock: `${trimmed}${marker}${closingTag}`,
    truncated: true
  };
}

function clampInteger(
  value: number | undefined,
  defaultValue: number,
  min: number,
  max: number
): number {
  if (value === undefined) {
    return defaultValue;
  }

  return Math.min(max, Math.max(min, Math.trunc(value)));
}
