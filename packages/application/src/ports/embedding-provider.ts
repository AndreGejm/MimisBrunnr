export interface EmbeddingProvider {
  readonly providerId: string;
  embedText(text: string): Promise<number[]>;
  embedTexts(texts: string[]): Promise<number[][]>;
}
