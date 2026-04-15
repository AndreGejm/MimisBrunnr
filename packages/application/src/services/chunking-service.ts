import { createHash } from "node:crypto";
import type { CanonicalNoteRecord } from "../ports/canonical-note-repository.js";
import type { ChunkRecord, ChunkStalenessClass } from "@mimir/domain";

export interface ChunkingOptions {
  targetChunkCharacters?: number;
}

interface SectionChunkSeed {
  headingPath: string[];
  rawText: string;
}

const DEFAULT_TARGET_CHUNK_CHARACTERS = 1400;

export class ChunkingService {
  private readonly targetChunkCharacters: number;

  constructor(options: ChunkingOptions = {}) {
    this.targetChunkCharacters =
      options.targetChunkCharacters ?? DEFAULT_TARGET_CHUNK_CHARACTERS;
  }

  chunkCanonicalNote(note: CanonicalNoteRecord): ChunkRecord[] {
    const sectionSeeds = extractSectionSeeds(note.frontmatter.title, note.body, this.targetChunkCharacters);
    const chunks = sectionSeeds.map((seed, index) => {
      const summary = summarizeChunk(seed.rawText);
      const chunkId = createDeterministicChunkId(note.noteId, seed.headingPath, index, seed.rawText);
      return {
        chunkId,
        noteId: note.noteId,
        corpusId: note.corpusId,
        noteType: note.frontmatter.type,
        notePath: note.notePath,
        headingPath: seed.headingPath,
        parentHeading: seed.headingPath.length > 2 ? seed.headingPath.at(-2) : undefined,
        prevChunkId: undefined,
        nextChunkId: undefined,
        rawText: seed.rawText,
        summary,
        entities: extractEntities(seed.rawText),
        qualifiers: extractQualifiers(seed.rawText),
        scope: note.frontmatter.scope,
        tags: note.frontmatter.tags,
        stalenessClass: classifyStaleness(
          note.frontmatter.updated,
          note.frontmatter.status,
          note.frontmatter.currentState,
          note.frontmatter.validFrom,
          note.frontmatter.validUntil
        ),
        validFrom: note.frontmatter.validFrom,
        validUntil: note.frontmatter.validUntil,
        tokenEstimate: estimateTokens(seed.rawText),
        updatedAt: note.frontmatter.updated
      } satisfies ChunkRecord;
    });

    return chunks.map((chunk, index) => ({
      ...chunk,
      prevChunkId: index > 0 ? chunks[index - 1].chunkId : undefined,
      nextChunkId: index < chunks.length - 1 ? chunks[index + 1].chunkId : undefined
    }));
  }
}

function createDeterministicChunkId(
  noteId: string,
  headingPath: string[],
  index: number,
  rawText: string
): string {
  return createHash("sha256")
    .update(`${noteId}\n${headingPath.join(" > ")}\n${index}\n${rawText}`, "utf8")
    .digest("hex");
}

function extractSectionSeeds(
  title: string,
  body: string,
  targetChunkCharacters: number
): SectionChunkSeed[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const sections: Array<{ headingPath: string[]; lines: string[] }> = [];
  const headingStack: Array<{ level: number; text: string }> = [];
  let currentLines: string[] = [];
  let currentHeadingPath: string[] = [title];

  const flushSection = (): void => {
    const content = currentLines.join("\n").trim();
    if (!content) {
      return;
    }

    sections.push({
      headingPath: [...currentHeadingPath],
      lines: [...currentLines]
    });
  };

  for (const line of lines) {
    const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      flushSection();
      currentLines = [];

      const level = headingMatch[1].length;
      const headingText = headingMatch[2].replace(/\s+#*$/, "").trim();

      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }

      headingStack.push({ level, text: headingText });
      currentHeadingPath = [title, ...headingStack.map((item) => item.text)];
      currentLines.push(line.trim());
      continue;
    }

    currentLines.push(line);
  }

  flushSection();

  if (sections.length === 0) {
    sections.push({
      headingPath: [title],
      lines
    });
  }

  return sections.flatMap((section) =>
    splitLargeSection(section, targetChunkCharacters).map((rawText) => ({
      headingPath: section.headingPath,
      rawText
    }))
  );
}

function splitLargeSection(
  section: { headingPath: string[]; lines: string[] },
  targetChunkCharacters: number
): string[] {
  const blocks = partitionIntoBlocks(section.lines);
  const chunks: string[] = [];
  let current = "";

  for (const block of blocks) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length <= targetChunkCharacters || current === "") {
      current = candidate;
      continue;
    }

    chunks.push(current.trim());
    current = block;
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.length > 0 ? chunks : [section.lines.join("\n").trim()];
}

function partitionIntoBlocks(lines: string[]): string[] {
  const blocks: string[] = [];
  let currentLines: string[] = [];
  let inCodeFence = false;

  const flush = (): void => {
    const value = currentLines.join("\n").trim();
    if (value) {
      blocks.push(value);
    }
    currentLines = [];
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inCodeFence = !inCodeFence;
      currentLines.push(line);
      continue;
    }

    if (!inCodeFence && line.trim() === "") {
      flush();
      continue;
    }

    currentLines.push(line);
  }

  flush();
  return blocks;
}

function summarizeChunk(rawText: string): string {
  const normalized = rawText
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  const sentenceMatch = normalized.match(/^(.{1,220}?[.!?])(?:\s|$)/);
  return sentenceMatch ? sentenceMatch[1].trim() : normalized.slice(0, 220);
}

function extractQualifiers(rawText: string): string[] {
  const matches = rawText.matchAll(/^\s*[-*]\s+(.+?)\s*$/gm);
  const items = [...matches].map((match) => match[1].trim());
  return [...new Set(items)].slice(0, 6);
}

function extractEntities(rawText: string): string[] {
  const inlineCodeMatches = [...rawText.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim());
  const symbolMatches = [...rawText.matchAll(/\b[A-Z][A-Za-z0-9_-]{2,}\b/g)].map((match) => match[0].trim());
  const merged = [...inlineCodeMatches, ...symbolMatches].filter(Boolean);
  return [...new Set(merged)].slice(0, 8);
}

function classifyStaleness(
  updated: string,
  status: string,
  currentState: boolean,
  validFrom?: string,
  validUntil?: string
): ChunkStalenessClass {
  if (status === "superseded") {
    return "superseded";
  }

  if (!currentState) {
    return "stale";
  }

  const today = currentDateIso();
  if (validFrom && today < validFrom) {
    return "stale";
  }

  if (validUntil && today > validUntil) {
    return "stale";
  }

  const updatedDate = new Date(`${updated}T00:00:00Z`);
  const ageInDays = Number.isNaN(updatedDate.getTime())
    ? 0
    : Math.floor((Date.now() - updatedDate.getTime()) / (1000 * 60 * 60 * 24));

  return ageInDays > 180 ? "stale" : "current";
}

function estimateTokens(rawText: string): number {
  return Math.max(1, Math.ceil(rawText.length / 4));
}

function currentDateIso(): string {
  return new Date().toISOString().slice(0, 10);
}
