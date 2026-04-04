import type { ControlledTag, NoteType, QueryIntent } from "@multi-agent-brain/domain";
import type { ScoredChunkCandidate } from "./retrieval-candidate.js";

const DEFAULT_FINAL_LIMIT = 8;

const INTENT_NOTE_TYPE_PRIORITY: Record<QueryIntent, NoteType[]> = {
  fact_lookup: ["reference", "glossary", "decision", "constraint", "architecture", "runbook", "handoff", "bug", "investigation", "policy"],
  decision_lookup: ["decision", "constraint", "architecture", "policy", "handoff", "reference", "runbook", "bug", "investigation", "glossary"],
  implementation_guidance: ["decision", "constraint", "architecture", "runbook", "reference", "handoff", "bug", "investigation", "policy", "glossary"],
  status_timeline: ["handoff", "bug", "investigation", "decision", "runbook", "reference", "constraint", "architecture", "policy", "glossary"],
  debugging: ["bug", "investigation", "runbook", "decision", "constraint", "handoff", "reference", "architecture", "policy", "glossary"],
  architecture_recall: ["architecture", "decision", "constraint", "reference", "policy", "handoff", "runbook", "investigation", "bug", "glossary"]
};

export class RankingFusionService {
  getNoteTypePriority(intent: QueryIntent): NoteType[] {
    return INTENT_NOTE_TYPE_PRIORITY[intent];
  }

  rankCandidates(input: {
    intent: QueryIntent;
    lexicalCandidates: ScoredChunkCandidate[];
    vectorCandidates: ScoredChunkCandidate[];
    finalLimit?: number;
    noteTypePriority?: NoteType[];
    tagFilters?: ControlledTag[];
  }): ScoredChunkCandidate[] {
    const noteTypePriority = input.noteTypePriority ?? this.getNoteTypePriority(input.intent);
    const merged = new Map<string, ScoredChunkCandidate>();

    input.lexicalCandidates.forEach((candidate, index) => {
      const existing = merged.get(candidate.chunk.chunkId) ?? candidate;
      merged.set(candidate.chunk.chunkId, {
        ...existing,
        ...candidate,
        lexicalScore: candidate.lexicalScore ?? candidate.score,
        fusedScore: (existing.fusedScore ?? 0) + reciprocalRankScore(index, 60)
      });
    });

    input.vectorCandidates.forEach((candidate, index) => {
      const existing = merged.get(candidate.chunk.chunkId) ?? candidate;
      merged.set(candidate.chunk.chunkId, {
        ...existing,
        ...candidate,
        lexicalScore: existing.lexicalScore,
        vectorScore: candidate.vectorScore ?? candidate.score,
        fusedScore: (existing.fusedScore ?? 0) + reciprocalRankScore(index, 60)
      });
    });

    return [...merged.values()]
      .filter((candidate) => matchesTagFilters(candidate.tags, input.tagFilters))
      .map((candidate) => ({
        ...candidate,
        score:
          candidate.fusedScore +
          noteTypeBoost(candidate.noteType, noteTypePriority) +
          lexicalBoost(candidate.lexicalScore) +
          stalenessAdjustment(candidate.stalenessClass, input.intent),
        fusedScore:
          candidate.fusedScore +
          noteTypeBoost(candidate.noteType, noteTypePriority) +
          lexicalBoost(candidate.lexicalScore) +
          stalenessAdjustment(candidate.stalenessClass, input.intent)
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, input.finalLimit ?? DEFAULT_FINAL_LIMIT);
  }
}

function matchesTagFilters(
  tags: readonly ControlledTag[],
  tagFilters: readonly ControlledTag[] | undefined
): boolean {
  if (!tagFilters || tagFilters.length === 0) {
    return true;
  }

  return tagFilters.every((tagFilter) => tags.includes(tagFilter));
}

function reciprocalRankScore(index: number, constant: number): number {
  return 1 / (constant + index + 1);
}

function noteTypeBoost(noteType: NoteType, priority: NoteType[]): number {
  const index = priority.indexOf(noteType);
  if (index === -1) {
    return 0;
  }

  return Math.max(0.02, 0.22 - index * 0.02);
}

function lexicalBoost(score?: number): number {
  if (score === undefined) {
    return 0;
  }

  return Math.min(score, 1.5) * 0.25;
}

function stalenessAdjustment(
  stalenessClass: ScoredChunkCandidate["stalenessClass"],
  intent: QueryIntent
): number {
  if (stalenessClass === "superseded") {
    return intent === "status_timeline" ? -0.08 : -0.35;
  }

  if (stalenessClass === "stale") {
    return intent === "status_timeline" ? -0.03 : -0.12;
  }

  return 0.06;
}
