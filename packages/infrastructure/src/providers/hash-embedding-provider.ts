import type { EmbeddingProvider } from "@multi-agent-brain/application";

const DEFAULT_DIMENSIONS = 192;

export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly providerId = "hash-embedding-v1";

  constructor(private readonly dimensions = DEFAULT_DIMENSIONS) {}

  async embedText(text: string): Promise<number[]> {
    const tokens = tokenize(text);
    const vector = new Array<number>(this.dimensions).fill(0);
    const effectiveTokens = tokens.length > 0 ? tokens : [text.trim().toLowerCase()];

    for (const token of effectiveTokens) {
      if (!token) {
        continue;
      }

      const primary = fnv1a(token);
      const secondary = mix32(primary ^ 0x9e3779b9);
      const index = Math.abs(primary) % this.dimensions;
      const sign = secondary % 2 === 0 ? 1 : -1;
      vector[index] += sign * tokenWeight(token);
    }

    return normalizeVector(vector);
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embedText(text)));
  }
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? [];
}

function tokenWeight(token: string): number {
  return Math.min(3, 1 + token.length / 12);
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
  if (magnitude === 0) {
    return vector;
  }

  return vector.map((value) => value / magnitude);
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash | 0;
}

function mix32(value: number): number {
  let mixed = value | 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed | 0;
}
