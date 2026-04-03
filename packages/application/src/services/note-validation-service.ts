import type {
  ControlledTag,
  CorpusId,
  NoteFrontmatter,
  NoteType
} from "@multi-agent-brain/domain";
import type {
  NoteValidationIssue,
  ValidateNoteRequest,
  ValidateNoteResponse
} from "@multi-agent-brain/contracts";

type ValidationSeverity = NoteValidationIssue["severity"];

const NOTE_TYPE_SECTION_REQUIREMENTS: Record<NoteType, string[]> = {
  decision: ["Context", "Decision", "Rationale", "Consequences"],
  constraint: ["Constraint", "Scope", "Rationale", "Implications"],
  bug: ["Summary", "Symptoms", "Reproduction", "Impact", "Status"],
  investigation: ["Question", "Findings", "Evidence", "Next Steps"],
  runbook: ["Purpose", "Preconditions", "Procedure", "Verification"],
  architecture: ["Context", "Components", "Data Flow", "Constraints"],
  glossary: ["Term", "Definition", "Related Terms"],
  handoff: ["Context", "Current State", "Open Questions", "Next Steps"],
  reference: ["Summary", "Details", "Sources"],
  policy: ["Policy", "Scope", "Rules", "Exceptions"]
};

const CONTROLLED_TAG_REGISTRY = new Set<ControlledTag>([
  "domain/agent",
  "domain/architecture",
  "domain/chunking",
  "domain/metadata",
  "domain/orchestration",
  "domain/retrieval",
  "domain/storage",
  "domain/vector",
  "artifact/api",
  "artifact/application",
  "artifact/backend",
  "artifact/cli",
  "artifact/contracts",
  "artifact/domain",
  "artifact/infrastructure",
  "artifact/qdrant",
  "artifact/sqlite",
  "artifact/vault",
  "project/multi-agent-brain",
  "project/zengram",
  "risk/contradiction",
  "risk/duplicate-memory",
  "risk/over-retrieval",
  "risk/raw-context",
  "risk/regression",
  "risk/stale-context",
  "risk/trust-boundary",
  "status/current",
  "status/draft",
  "status/promoted",
  "status/rejected",
  "status/staged",
  "status/superseded",
  "topic/corpus-separation",
  "topic/docker",
  "topic/current-state-snapshot",
  "topic/mcp",
  "topic/note-schema",
  "topic/packet-contract",
  "topic/promotion-policy",
  "topic/ranking-policy"
]);

interface ValidationOptions {
  allowedTags?: Iterable<ControlledTag>;
}

export class NoteValidationService {
  private readonly allowedTags: Set<ControlledTag>;

  constructor(options: ValidationOptions = {}) {
    this.allowedTags = new Set(options.allowedTags ?? CONTROLLED_TAG_REGISTRY);
  }

  validate(request: ValidateNoteRequest): ValidateNoteResponse {
    const violations: NoteValidationIssue[] = [];
    const normalizedFrontmatter = this.normalizeFrontmatter(
      request.frontmatter,
      request.targetCorpus,
      violations
    );
    const normalizedBody = normalizeLineEndings(request.body);

    this.validatePath(request.notePath, request.targetCorpus, violations);
    this.validateSectionRequirements(
      normalizedFrontmatter.type,
      normalizedBody,
      violations
    );
    this.validateCorpusPolicy(
      normalizedFrontmatter,
      request.notePath,
      violations
    );
    this.validateTemporalValidity(normalizedFrontmatter, violations);
    this.validateSupersedeState(normalizedFrontmatter, violations);
    this.validateLifecycleMode(
      normalizedFrontmatter.status,
      request.validationMode,
      violations
    );

    const hasErrors = violations.some((issue) => issue.severity === "error");

    return {
      valid: !hasErrors,
      normalizedFrontmatter,
      violations,
      blockedFromPromotion:
        hasErrors || request.validationMode === "promotion" && normalizedFrontmatter.status === "draft"
    };
  }

  private normalizeFrontmatter(
    input: NoteFrontmatter,
    targetCorpus: CorpusId,
    violations: NoteValidationIssue[]
  ): NoteFrontmatter {
    const noteId = normalizeRequiredString(input.noteId, "frontmatter.noteId", violations);
    const title = normalizeRequiredString(input.title, "frontmatter.title", violations);
    const project = normalizeRequiredString(input.project, "frontmatter.project", violations);
    const summary = normalizeRequiredString(input.summary, "frontmatter.summary", violations);
    const scope = normalizeRequiredString(input.scope, "frontmatter.scope", violations);
    const updated = normalizeDateString(input.updated, "frontmatter.updated", violations);
    const validFrom = normalizeOptionalDateString(
      input.validFrom,
      "frontmatter.validFrom",
      violations
    );
    const validUntil = normalizeOptionalDateString(
      input.validUntil,
      "frontmatter.validUntil",
      violations
    );
    const tags = this.normalizeTags(input.tags, violations);

    if (input.corpusId !== targetCorpus) {
      violations.push(issue("frontmatter.corpusId", `Frontmatter corpus '${input.corpusId}' does not match target corpus '${targetCorpus}'.`, "error"));
    }

    return {
      ...input,
      noteId,
      title,
      project,
      summary,
      scope,
      updated,
      corpusId: input.corpusId,
      tags,
      validFrom,
      validUntil,
      supersedes: dedupeStrings(input.supersedes ?? []),
      supersededBy: normalizeOptionalString(input.supersededBy)
    };
  }

  private normalizeTags(
    tags: ControlledTag[],
    violations: NoteValidationIssue[]
  ): ControlledTag[] {
    if (!Array.isArray(tags) || tags.length === 0) {
      violations.push(issue("frontmatter.tags", "At least one controlled tag is required.", "error"));
      return [];
    }

    const normalized = dedupeStrings(
      tags
        .map((tag) => normalizeTag(tag))
        .filter((tag): tag is ControlledTag => Boolean(tag))
    ).sort();

    for (const tag of normalized) {
      if (!this.allowedTags.has(tag)) {
        violations.push(issue("frontmatter.tags", `Tag '${tag}' is not part of the controlled vocabulary.`, "error"));
      }
    }

    return normalized;
  }

  private validateCorpusPolicy(
    frontmatter: NoteFrontmatter,
    notePath: string,
    violations: NoteValidationIssue[]
  ): void {
    const normalizedPath = normalizePathString(notePath);

    if (frontmatter.corpusId === "general_notes") {
      if (frontmatter.currentState) {
        violations.push(issue("frontmatter.currentState", "General notes cannot be marked as current-state canonical context.", "error"));
      }

      if (frontmatter.tags.includes("status/current")) {
        violations.push(issue("frontmatter.tags", "General notes cannot carry the status/current tag.", "error"));
      }

      if (normalizedPath.startsWith("general_notes/current-state/")) {
        violations.push(issue("notePath", "Current-state snapshot notes must live in the context_brain corpus.", "error"));
      }
    }
  }

  private validatePath(
    notePath: string,
    targetCorpus: CorpusId,
    violations: NoteValidationIssue[]
  ): void {
    const normalized = normalizePathString(notePath);

    if (!normalized.endsWith(".md")) {
      violations.push(issue("notePath", "Note path must end with .md.", "error"));
    }

    if (!normalized.startsWith(`${targetCorpus}/`)) {
      violations.push(issue("notePath", `Note path must live under the '${targetCorpus}' corpus root.`, "error"));
    }

    if (normalized.includes("../")) {
      violations.push(issue("notePath", "Note path must not contain parent traversal segments.", "error"));
    }
  }

  private validateSectionRequirements(
    noteType: NoteType,
    body: string,
    violations: NoteValidationIssue[]
  ): void {
    const headings = extractHeadings(body);
    const requiredSections = NOTE_TYPE_SECTION_REQUIREMENTS[noteType] ?? [];

    for (const section of requiredSections) {
      if (!headings.has(normalizeHeading(section))) {
        violations.push(issue("body.sections", `Missing required section heading '${section}'.`, "error"));
      }
    }
  }

  private validateSupersedeState(
    frontmatter: NoteFrontmatter,
    violations: NoteValidationIssue[]
  ): void {
    if (frontmatter.currentState && frontmatter.supersededBy) {
      violations.push(issue("frontmatter.currentState", "A current-state note cannot declare a supersededBy value.", "error"));
    }

    if (!frontmatter.currentState && !frontmatter.supersededBy && frontmatter.status === "superseded") {
      violations.push(issue("frontmatter.supersededBy", "Superseded notes must declare the replacing note ID.", "error"));
    }
  }

  private validateTemporalValidity(
    frontmatter: NoteFrontmatter,
    violations: NoteValidationIssue[]
  ): void {
    if (
      frontmatter.validFrom &&
      frontmatter.validUntil &&
      frontmatter.validFrom > frontmatter.validUntil
    ) {
      violations.push(
        issue(
          "frontmatter.validUntil",
          "validUntil must be on or after validFrom.",
          "error"
        )
      );
    }
  }

  private validateLifecycleMode(
    lifecycleState: NoteFrontmatter["status"],
    validationMode: ValidateNoteRequest["validationMode"],
    violations: NoteValidationIssue[]
  ): void {
    if (validationMode === "draft" && lifecycleState !== "draft" && lifecycleState !== "staged") {
      violations.push(issue("frontmatter.status", "Draft validation only allows 'draft' or 'staged' lifecycle states.", "error"));
    }

    if (validationMode === "promotion" && (lifecycleState === "draft" || lifecycleState === "rejected")) {
      violations.push(issue("frontmatter.status", "Promotion validation cannot proceed from a draft or rejected lifecycle state.", "error"));
    }
  }
}

function issue(field: string, message: string, severity: ValidationSeverity): NoteValidationIssue {
  return { field, message, severity };
}

function normalizeRequiredString(
  value: string,
  field: string,
  violations: NoteValidationIssue[]
): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    violations.push(issue(field, "This field is required.", "error"));
    return "";
  }

  return normalized;
}

function normalizeOptionalString(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeDateString(
  value: string,
  field: string,
  violations: NoteValidationIssue[]
): string {
  const normalized = normalizeRequiredString(value, field, violations);
  if (!normalized) {
    return "";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    violations.push(issue(field, "Dates must use YYYY-MM-DD format.", "error"));
  }

  return normalized;
}

function normalizeOptionalDateString(
  value: string | undefined,
  field: string,
  violations: NoteValidationIssue[]
): string | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return undefined;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    violations.push(issue(field, "Dates must use YYYY-MM-DD format.", "error"));
  }

  return normalized;
}

function normalizeTag(value: string): ControlledTag | undefined {
  const [namespace, rawTag] = value
    .trim()
    .toLowerCase()
    .replace(/\\/g, "/")
    .split("/", 2);

  if (!namespace || !rawTag) {
    return undefined;
  }

  const normalizedTag = rawTag
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!normalizedTag) {
    return undefined;
  }

  return `${namespace}/${normalizedTag}` as ControlledTag;
}

function dedupeStrings<T extends string>(values: T[]): T[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean) as T[])];
}

function normalizeHeading(heading: string): string {
  return heading.trim().toLowerCase();
}

function extractHeadings(markdown: string): Set<string> {
  const matches = markdown.matchAll(/^\s{0,3}#{1,6}\s+(.+?)\s*$/gm);
  return new Set(
    [...matches].map((match) => normalizeHeading(match[1].replace(/\s+#*$/, "")))
  );
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function normalizePathString(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

export const NOTE_VALIDATION_POLICY = {
  requiredSectionsByType: NOTE_TYPE_SECTION_REQUIREMENTS,
  allowedTags: CONTROLLED_TAG_REGISTRY
} as const;
