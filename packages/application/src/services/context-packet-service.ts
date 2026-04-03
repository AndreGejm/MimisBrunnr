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
    const selected = selectCandidates(request.candidates, request.budget.maxSources);
    const expanded = await this.expandNeighborhood(selected, request.budget.maxSources);
    const sources = dedupeSources(expanded);
    const rawExcerpts = shouldIncludeRawExcerpts(
      request.includeRawExcerpts,
      answerability
    )
      ? expanded
          .slice(0, request.budget.maxRawExcerpts)
          .map((candidate) => excerptText(candidate.rawText ?? "", 320))
          .filter(Boolean)
      : undefined;

    const summary = summarizeCandidates(expanded, request.intent);
    const constraints = dedupeStrings(
      expanded.flatMap((candidate) => candidate.qualifiers).slice(0, 8)
    );
    const confidence = determineConfidence(answerability, expanded);
    const uncertainties = buildUncertainties(answerability, expanded);

    const packet: ContextPacket = {
      packetType: packetTypeForIntent(request.intent),
      intent: request.intent,
      confidence,
      answerability,
      summary,
      constraints,
      evidence: sources,
      rawExcerpts,
      uncertainties,
      budgetUsage: {
        tokenEstimate: expanded.reduce((total, candidate) => total + estimateTokens(candidate.rawText ?? candidate.summary), 0),
        sourceCount: sources.length,
        rawExcerptCount: rawExcerpts?.length ?? 0
      }
    };

    return { packet };
  }

  private async expandNeighborhood(
    candidates: ContextCandidate[],
    maxSources: number
  ): Promise<ContextCandidate[]> {
    const output: ContextCandidate[] = [];
    const seen = new Set<string>();

    for (const candidate of candidates) {
      const chunkId = candidate.provenance.chunkId;
      if (!chunkId || seen.has(chunkId)) {
        const fallbackKey = chunkId ?? candidate.provenance.noteId;
        if (!seen.has(fallbackKey) && output.length < maxSources) {
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
        if (output.length < maxSources) {
          seen.add(chunkId);
          output.push(candidate);
        }
        continue;
      }

      for (const chunk of neighborhood) {
        if (seen.has(chunk.chunkId) || output.length >= maxSources) {
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

    return output.slice(0, maxSources);
  }
}

function selectCandidates(
  candidates: ContextCandidate[],
  maxSources: number
): ContextCandidate[] {
  const deduped = new Map<string, ContextCandidate>();

  for (const candidate of candidates) {
    const key = `${candidate.provenance.noteId}:${candidate.provenance.chunkId ?? "note"}`;
    if (!deduped.has(key)) {
      deduped.set(key, candidate);
    }
  }

  return [...deduped.values()].slice(0, maxSources);
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
  intent: QueryIntent
): string {
  const summaries = dedupeStrings(
    candidates.map((candidate) => candidate.summary).filter(Boolean)
  ).slice(0, 4);
  const prefix = summaryPrefix(intent);

  return summaries.length > 0
    ? `${prefix} ${summaries.join(" ")}`
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
