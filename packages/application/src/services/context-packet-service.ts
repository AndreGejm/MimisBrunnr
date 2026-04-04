import type { MetadataControlStore } from "../ports/metadata-control-store.js";
import type {
  AssembleContextPacketRequest,
  AssembleContextPacketResponse,
  ContextCandidate
} from "@multi-agent-brain/contracts";
import type {
  AnswerConfidence,
  AnswerabilityDisposition,
  ContextPacket,
  QueryIntent
} from "@multi-agent-brain/domain";
import { packetTypeForIntent } from "./retrieval-candidate.js";

export class ContextPacketService {
  constructor(private readonly metadataControlStore: MetadataControlStore) {}

  async assemblePacket(
    request: AssembleContextPacketRequest,
    answerability: AnswerabilityDisposition
  ): Promise<AssembleContextPacketResponse> {
    const candidateWindowSize = Math.max(
      8,
      request.budget.maxSources * 3,
      request.budget.maxRawExcerpts * 3,
      request.budget.maxSummarySentences * 3
    );
    const selected = selectCandidates(request.candidates);
    const expanded = await this.expandNeighborhood(selected, candidateWindowSize);
    const includeRawExcerpts = shouldIncludeRawExcerpts(
      request.includeRawExcerpts,
      answerability
    );
    const budgetedPacket = enforceContextBudget({
      candidates: expanded,
      intent: request.intent,
      answerability,
      budget: request.budget,
      includeRawExcerpts
    });
    const confidence = determineConfidence(answerability, budgetedPacket.selectedCandidates);

    const packet: ContextPacket = {
      packetType: packetTypeForIntent(request.intent),
      intent: request.intent,
      confidence,
      answerability,
      summary: budgetedPacket.summary,
      constraints: budgetedPacket.constraints,
      evidence: budgetedPacket.sources,
      rawExcerpts: budgetedPacket.rawExcerpts,
      uncertainties: budgetedPacket.uncertainties,
      budgetUsage: {
        tokenEstimate: budgetedPacket.tokenEstimate,
        sourceCount: budgetedPacket.sources.length,
        rawExcerptCount: budgetedPacket.rawExcerpts?.length ?? 0
      }
    };

    return { packet };
  }

  private async expandNeighborhood(
    candidates: ContextCandidate[],
    maxCandidates: number
  ): Promise<ContextCandidate[]> {
    const output: ContextCandidate[] = [];
    const seen = new Set<string>();

    for (const candidate of candidates) {
      const chunkId = candidate.provenance.chunkId;
      if (!chunkId || seen.has(chunkId)) {
        const fallbackKey = chunkId ?? candidate.provenance.noteId;
        if (!seen.has(fallbackKey) && output.length < maxCandidates) {
          seen.add(fallbackKey);
          output.push(candidate);
        }
        continue;
      }

      const neighborhood = await this.metadataControlStore.getChunkNeighborhood(
        chunkId,
        1
      );

      if (neighborhood.length === 0) {
        if (output.length < maxCandidates) {
          seen.add(chunkId);
          output.push(candidate);
        }
        continue;
      }

      for (const chunk of neighborhood) {
        if (seen.has(chunk.chunkId) || output.length >= maxCandidates) {
          continue;
        }

        seen.add(chunk.chunkId);
        output.push({
          noteType: chunk.noteType,
          score: candidate.score,
          summary: chunk.summary,
          rawText: chunk.rawText,
          scope: chunk.scope,
          qualifiers: chunk.qualifiers,
          tags: chunk.tags,
          stalenessClass: chunk.stalenessClass,
          provenance: {
            noteId: chunk.noteId,
            chunkId: chunk.chunkId,
            notePath: chunk.notePath,
            headingPath: chunk.headingPath
          }
        });
      }
    }

    return output.slice(0, maxCandidates);
  }
}

function selectCandidates(
  candidates: ContextCandidate[]
): ContextCandidate[] {
  const deduped = new Map<string, ContextCandidate>();

  for (const candidate of candidates) {
    const key = `${candidate.provenance.noteId}:${candidate.provenance.chunkId ?? "note"}`;
    if (!deduped.has(key)) {
      deduped.set(key, candidate);
    }
  }

  return [...deduped.values()];
}

function dedupeSources(candidates: ContextCandidate[]) {
  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    const key = `${candidate.provenance.noteId}:${candidate.provenance.chunkId ?? "note"}`;
    if (seen.has(key)) {
      return [];
    }

    seen.add(key);
    return [candidate.provenance];
  });
}

function summarizeCandidates(
  candidates: ContextCandidate[],
  intent: QueryIntent,
  maxSummarySentences: number
): string {
  const prefix = summaryPrefix(intent);
  const sentences = dedupeStrings(
    candidates.flatMap((candidate) => splitSummarySentences(candidate.summary))
  ).slice(0, Math.max(0, maxSummarySentences));

  return sentences.length > 0
    ? `${prefix} ${sentences.join(" ")}`
    : `${prefix} No high-confidence local context was found.`;
}

function summaryPrefix(intent: QueryIntent): string {
  switch (intent) {
    case "decision_lookup":
      return "Relevant decision context:";
    case "implementation_guidance":
    case "debugging":
      return "Implementation-relevant context:";
    case "status_timeline":
      return "Current timeline and status context:";
    case "architecture_recall":
      return "Architecture context:";
    case "fact_lookup":
    default:
      return "Relevant local context:";
  }
}

function shouldIncludeRawExcerpts(
  includeRawExcerpts: boolean,
  answerability: AnswerabilityDisposition
): boolean {
  return includeRawExcerpts || answerability !== "local_answer";
}

function excerptText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 3)}...`;
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function determineConfidence(
  answerability: AnswerabilityDisposition,
  candidates: ContextCandidate[]
): AnswerConfidence {
  if (answerability === "needs_escalation") {
    return "low";
  }

  const topScore = candidates[0]?.score ?? 0;
  if (answerability === "local_answer" && topScore >= 0.72) {
    return "high";
  }

  return "medium";
}

function buildUncertainties(
  answerability: AnswerabilityDisposition,
  candidates: ContextCandidate[]
): string[] {
  if (answerability === "local_answer") {
    return [];
  }

  if (candidates.length === 0) {
    return ["No local evidence met the minimum ranking threshold."];
  }

  if (answerability === "needs_escalation") {
    return ["Local context is insufficient and should be supplemented with code or external search."];
  }

  return ["Local context is partial; exact implementation details may need deeper code search."];
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function splitSummarySentences(value: string): string[] {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function estimateProvenanceTokens(
  sources: ReturnType<typeof dedupeSources>
): number {
  return sources.reduce((total, source) => {
    const headingPath = source.headingPath.join(" > ");
    return total + estimateTokens(
      [source.noteId, source.notePath, headingPath].filter(Boolean).join("\n")
    );
  }, 0);
}

function estimatePacketTokens(input: {
  summary: string;
  constraints: string[];
  uncertainties: string[];
  sources: ReturnType<typeof dedupeSources>;
  rawExcerpts?: string[];
}): number {
  return (
    estimateTokens(input.summary) +
    estimateTokens(input.constraints.join("\n")) +
    estimateTokens(input.uncertainties.join("\n")) +
    estimateProvenanceTokens(input.sources) +
    (input.rawExcerpts ?? []).reduce(
      (total, rawExcerpt) => total + estimateTokens(rawExcerpt),
      0
    )
  );
}

function enforceContextBudget(input: {
  candidates: ContextCandidate[];
  intent: QueryIntent;
  answerability: AnswerabilityDisposition;
  budget: AssembleContextPacketRequest["budget"];
  includeRawExcerpts: boolean;
}): {
  selectedCandidates: ContextCandidate[];
  summary: string;
  constraints: string[];
  uncertainties: string[];
  sources: ReturnType<typeof dedupeSources>;
  rawExcerpts?: string[];
  tokenEstimate: number;
} {
  let sourceLimit = Math.min(input.budget.maxSources, input.candidates.length);
  let rawExcerptLimit = input.includeRawExcerpts
    ? Math.min(input.budget.maxRawExcerpts, input.candidates.length)
    : 0;
  let summarySentenceLimit = Math.max(0, input.budget.maxSummarySentences);
  let constraintLimit = 8;
  let includeUncertainties = true;

  while (true) {
    const selectedCandidates = input.candidates.slice(0, Math.max(0, sourceLimit));
    const sources = dedupeSources(selectedCandidates);
    const rawExcerpts =
      rawExcerptLimit > 0
        ? selectedCandidates
            .slice(0, rawExcerptLimit)
            .map((candidate) => excerptText(candidate.rawText ?? "", 320))
            .filter(Boolean)
        : undefined;
    const constraints = dedupeStrings(
      selectedCandidates.flatMap((candidate) => candidate.qualifiers)
    ).slice(0, Math.max(0, constraintLimit));
    const uncertainties = includeUncertainties
      ? buildUncertainties(input.answerability, selectedCandidates)
      : [];
    const summary = summarizeCandidates(
      selectedCandidates,
      input.intent,
      summarySentenceLimit
    );
    const tokenEstimate = estimatePacketTokens({
      summary,
      constraints,
      uncertainties,
      sources,
      rawExcerpts
    });

    if (tokenEstimate <= input.budget.maxTokens) {
      return {
        selectedCandidates,
        summary,
        constraints,
        uncertainties,
        sources,
        rawExcerpts,
        tokenEstimate
      };
    }

    if (rawExcerptLimit > 0) {
      rawExcerptLimit -= 1;
      continue;
    }

    if (summarySentenceLimit > 0) {
      summarySentenceLimit -= 1;
      continue;
    }

    if (sourceLimit > 1) {
      sourceLimit -= 1;
      continue;
    }

    if (constraintLimit > 0) {
      constraintLimit -= 1;
      continue;
    }

    if (includeUncertainties) {
      includeUncertainties = false;
      continue;
    }

    const clippedSummary = clipTextToTokenBudget(summary, input.budget.maxTokens);
    const clippedTokenEstimate = estimatePacketTokens({
      summary: clippedSummary,
      constraints: [],
      uncertainties: [],
      sources: [],
      rawExcerpts: []
    });

    return {
      selectedCandidates: [],
      summary: clippedSummary,
      constraints: [],
      uncertainties: [],
      sources: [],
      rawExcerpts: undefined,
      tokenEstimate: Math.min(clippedTokenEstimate, input.budget.maxTokens)
    };
  }
}

function clipTextToTokenBudget(value: string, maxTokens: number): string {
  const maxLength = Math.max(1, maxTokens * 4);
  return excerptText(value, maxLength);
}
