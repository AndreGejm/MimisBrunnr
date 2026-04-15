import type { LocalReasoningProvider } from "../ports/local-reasoning-provider.js";
import { packetTypeForIntent } from "./retrieval-candidate.js";
import type {
  AnswerabilityDisposition,
  PacketType,
  QueryIntent
} from "@mimir/domain";
import type { ContextCandidate } from "@mimir/contracts";

export class QueryIntentService {
  constructor(private readonly provider?: LocalReasoningProvider) {}

  async classifyIntent(query: string, intentHint?: QueryIntent): Promise<QueryIntent> {
    if (intentHint) {
      return intentHint;
    }

    if (this.provider) {
      return this.provider.classifyIntent(query);
    }

    return classifyIntentHeuristically(query);
  }

  async assessAnswerability(
    query: string,
    intent: QueryIntent,
    candidates: ContextCandidate[]
  ): Promise<AnswerabilityDisposition> {
    if (this.provider) {
      return this.provider.assessAnswerability({
        query,
        intent,
        candidates
      });
    }

    return assessAnswerabilityHeuristically(candidates);
  }

  packetTypeForIntent(intent: QueryIntent): PacketType {
    return packetTypeForIntent(intent);
  }
}

function classifyIntentHeuristically(query: string): QueryIntent {
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

function assessAnswerabilityHeuristically(
  candidates: ContextCandidate[]
): AnswerabilityDisposition {
  if (candidates.length === 0) {
    return "needs_escalation";
  }

  const topScore = candidates[0]?.score ?? 0;
  const goodEvidenceCount = candidates.filter((candidate) => candidate.score >= 0.55).length;

  if (topScore >= 0.72 && goodEvidenceCount >= 1) {
    return "local_answer";
  }

  if (topScore >= 0.35 || goodEvidenceCount >= 1) {
    return "partial";
  }

  return "needs_escalation";
}
