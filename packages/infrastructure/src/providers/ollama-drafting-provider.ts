import type { DraftingProvider } from "@multi-agent-brain/application";
import { NOTE_VALIDATION_POLICY } from "@multi-agent-brain/application";
import type { DraftNoteRequest, DraftNoteResponse } from "@multi-agent-brain/contracts";
import { OllamaClient } from "./ollama-client.js";

interface OllamaDraftingProviderOptions {
  baseUrl: string;
  model: string;
  fetchImplementation?: typeof fetch;
}

type DraftPayload = {
  body: string;
  warnings?: string[];
};

export class OllamaDraftingProvider implements DraftingProvider {
  readonly providerId: string;
  private readonly client: OllamaClient;

  constructor(private readonly options: OllamaDraftingProviderOptions) {
    this.providerId = `ollama-drafting:${options.model}`;
    this.client = new OllamaClient({
      baseUrl: options.baseUrl,
      fetchImplementation: options.fetchImplementation
    });
  }

  async draftStructuredNote(request: DraftNoteRequest): Promise<DraftNoteResponse> {
    const requiredSections = NOTE_VALIDATION_POLICY.requiredSectionsByType[request.noteType] ?? [];
    const sourcePaths = request.supportingSources.map((source) => source.notePath);
    const prompt = JSON.stringify(
      {
        noteType: request.noteType,
        title: request.title,
        targetCorpus: request.targetCorpus,
        sourcePrompt: request.sourcePrompt,
        bodyHints: request.bodyHints ?? [],
        sourcePaths,
        requiredSections
      },
      null,
      2
    );

    const generated = await this.client.generateJson<DraftPayload>({
      model: this.options.model,
      system: [
        "You draft structured markdown notes for a governed multi-agent memory system.",
        "Return JSON only: {\"body\":\"...markdown...\",\"warnings\":[\"...\"]}.",
        "The markdown body must include every required section as an H2 heading in the specified order.",
        "Preserve a Sources section when sources are available.",
        "Do not include frontmatter."
      ].join(" "),
      prompt,
      format: "json",
      raw: false
    });

    return {
      draftNoteId: request.frontmatterOverrides?.noteId ?? "",
      lifecycleState: request.frontmatterOverrides?.status ?? "draft",
      draftPath: "",
      frontmatter: {
        noteId: request.frontmatterOverrides?.noteId ?? "",
        title: request.title,
        project: request.frontmatterOverrides?.project ?? "multi-agent-brain",
        type: request.noteType,
        status: request.frontmatterOverrides?.status ?? "draft",
        updated: request.frontmatterOverrides?.updated ?? new Date().toISOString().slice(0, 10),
        summary: request.frontmatterOverrides?.summary ?? request.sourcePrompt,
        tags: request.frontmatterOverrides?.tags ?? ["project/multi-agent-brain", "status/draft"],
        scope: request.frontmatterOverrides?.scope ?? "staging",
        corpusId: request.targetCorpus,
        currentState: request.frontmatterOverrides?.currentState ?? false,
        supersedes: request.frontmatterOverrides?.supersedes,
        supersededBy: request.frontmatterOverrides?.supersededBy
      },
      body: generated.body?.trim() || "",
      warnings: generated.warnings ?? []
    };
  }
}
