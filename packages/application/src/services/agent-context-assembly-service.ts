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

export class AgentContextAssemblyService {
  constructor(
    private readonly retrieveContextService: RetrieveContextService,
    private readonly sessionArchiveService: SessionArchiveService
  ) {}

  async assembleAgentContext(
    request: AssembleAgentContextRequest
  ): Promise<ServiceResult<AssembleAgentContextResponse, AgentContextAssemblyErrorCode>> {
    const retrievalResult = await this.retrieveContextService.retrieveContext({
      actor: request.actor,
      query: request.query,
      budget: request.budget ?? DEFAULT_CONTEXT_BUDGET,
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
        maxTokens: request.sessionMaxTokens
      });

      if (sessionResult.ok) {
        sessionRecall = sessionResult.data;
      } else {
        warnings.push(sessionResult.error.message);
      }
    }

    const contextBlock = buildContextBlock({
      retrieval: retrievalResult.data,
      sessionRecall
    });
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
        contextBlock,
        tokenEstimate: estimateTokens(contextBlock),
        truncated: Boolean(sessionRecall?.truncated),
        sourceSummary,
        retrievalHealth: retrievalResult.data.retrievalHealth,
        trace: retrievalResult.data.trace
      },
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }
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
    `Summary: ${packet.summary}`,
    `Answerability: ${packet.answerability}`,
    `Confidence: ${packet.confidence}`,
    "Evidence:"
  ];

  if (packet.evidence.length === 0) {
    lines.push("- none");
  } else {
    for (const evidence of packet.evidence) {
      const heading = evidence.headingPath.length > 0
        ? `#${evidence.headingPath.join(" > ")}`
        : "";
      lines.push(`- ${evidence.notePath}${heading} (${evidence.noteId})`);
    }
  }

  if (packet.constraints.length > 0) {
    lines.push("Constraints:");
    for (const constraint of packet.constraints) {
      lines.push(`- ${constraint}`);
    }
  }

  if (packet.rawExcerpts && packet.rawExcerpts.length > 0) {
    lines.push("Raw excerpts:");
    for (const excerpt of packet.rawExcerpts) {
      lines.push(`- ${normalizeWhitespace(excerpt)}`);
    }
  }

  if (packet.uncertainties.length > 0) {
    lines.push("Uncertainties:");
    for (const uncertainty of packet.uncertainties) {
      lines.push(`- ${uncertainty}`);
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
          `- ${hit.sessionId}/${hit.archiveId}#${hit.messageIndex} ${hit.role}: ${normalizeWhitespace(hit.content)}`
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

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
