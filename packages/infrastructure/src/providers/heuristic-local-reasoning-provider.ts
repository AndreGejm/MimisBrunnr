import type { LocalReasoningProvider } from "@mimir/application";
import type {
  AnswerabilityDisposition,
  QueryIntent
} from "@mimir/domain";
import type { ContextCandidate } from "@mimir/contracts";

export class HeuristicLocalReasoningProvider implements LocalReasoningProvider {
  readonly providerId = "heuristic-local-v1";

  async classifyIntent(query: string): Promise<QueryIntent> {
    const normalized = query.toLowerCase();

    if (/\b(decision|why did we|why was|rationale|tradeoff|chose)\b/.test(normalized)) {
      return "decision_lookup";
    }

    if (/\b(debug|error|failing|failure|exception|stack|broken|bug)\b/.test(normalized)) {
      return "debugging";
    }

    if (/\b(status|timeline|when|recent|current state|changed|progress)\b/.test(normalized)) {
      return "status_timeline";
    }

    if (/\b(implement|code|module|file|service|api|build|how do i)\b/.test(normalized)) {
      return "implementation_guidance";
    }

    if (/\b(architecture|design|flow|system|component|boundary)\b/.test(normalized)) {
      return "architecture_recall";
    }

    return "fact_lookup";
  }

  async assessAnswerability(input: {
    query: string;
    intent: QueryIntent;
    candidates: ContextCandidate[];
  }): Promise<AnswerabilityDisposition> {
    const { candidates } = input;
    if (candidates.length === 0) {
      return "needs_escalation";
    }

    const topScore = candidates[0]?.score ?? 0;
    const usefulEvidence = candidates.filter((candidate) => candidate.score >= 0.52).length;
    const distinctNotes = new Set(candidates.map((candidate) => candidate.provenance.noteId)).size;

    if (topScore >= 0.72 && usefulEvidence >= 1) {
      return "local_answer";
    }

    if (topScore >= 0.4 || usefulEvidence >= 1 || distinctNotes >= 2) {
      return "partial";
    }

    return "needs_escalation";
  }

  async summarizeUncertainty(query: string, evidence: string[]): Promise<string> {
    if (evidence.length === 0) {
      return `Local context is insufficient to answer '${query}' confidently.`;
    }

    return `Local context for '${query}' is partial; verify against code or higher-confidence canonical notes.`;
  }
}
