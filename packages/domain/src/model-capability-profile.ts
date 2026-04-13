export interface ModelCapabilityProfile {
  id: string;
  provider: "docker-model-runner" | "docker-ollama" | "internal";
  role: "coding" | "reasoning" | "embedding" | "reranking";
  contextWindowTokens: number;
  recommendedTemperature: number;
  recommendedSeed?: number;
  phaseBudgets?: Record<string, number>;
  strengths: string[];
  cautions: string[];
}

export const QWEN3_CODER_LOCAL_PROFILE: ModelCapabilityProfile = {
  id: "qwen3-coder",
  provider: "docker-model-runner",
  role: "coding",
  contextWindowTokens: 262144,
  recommendedTemperature: 0,
  recommendedSeed: 42,
  phaseBudgets: {
    planning: 32000,
    implementation: 128000,
    verification: 48000,
    summary: 16000
  },
  strengths: [
    "large local coding context",
    "deterministic repair and review loops",
    "repo-scale code reading without paid escalation"
  ],
  cautions: [
    "retrieved context is advisory and never authority by itself",
    "large context windows still need bounded packets",
    "tool writes must remain governed by MultiagentBrain review paths"
  ]
};
