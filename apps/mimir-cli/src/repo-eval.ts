import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type JsonRecord = Record<string, unknown>;

export interface RepoIndexPayload {
  root: string;
  include: string[];
  exclude?: string[];
  outputPath?: string;
  denyPrivateIpPatterns?: boolean;
}

export interface RepoAnswerPayload {
  indexPath: string;
  query: string;
  maxSources?: number;
  excludeFromAnswer?: string[];
  rankingProfile?: RepoRankingProfile;
  intentHint?: RepoAnswerIntent;
  sourceWeights?: Record<string, number>;
  requireSourcePathCitations?: boolean;
}

export interface RepoEvalPayload {
  indexPath: string;
  tests: Array<{
    id: string;
    prompt: string;
    expectedFiles?: string[];
    expectedAnyFiles?: string[][];
    forbiddenFiles?: string[];
    minExpectedFiles?: number;
    maxExpectedRank?: number;
    mustIncludeTerms?: string[];
    groundingTerms?: string[];
    requireGroundedTerms?: boolean;
    forbiddenTerms?: string[];
    excludeFromAnswer?: string[];
    intentHint?: RepoAnswerIntent;
    sourceWeights?: Record<string, number>;
  }>;
  maxSources?: number;
  rankingProfile?: RepoRankingProfile;
  intentHint?: RepoAnswerIntent;
  sourceWeights?: Record<string, number>;
}

interface RepoIndex {
  schemaVersion: 1;
  root: string;
  createdAt: string;
  include: string[];
  exclude: string[];
  files: RepoIndexedFile[];
  chunks: RepoIndexedChunk[];
  warnings: string[];
}

interface RepoIndexedFile {
  path: string;
  bytes: number;
  sha256: string;
}

interface RepoIndexedChunk {
  id: string;
  path: string;
  headingPath: string[];
  text: string;
  ordinal: number;
}

interface ScoredChunk extends RepoIndexedChunk {
  score: number;
  matchedTerms: string[];
  scoreBreakdown: RepoScoreBreakdown;
}

type RepoRankingProfile = "generic" | "panopticon";
type RepoAnswerIntent =
  | "generic"
  | "repo_orientation"
  | "security_reasoning"
  | "prompt_generation"
  | "gap_analysis"
  | "operator_usefulness";

interface RepoScoreBreakdown {
  termScore: number;
  pathScore: number;
  headingScore: number;
  matchedTerms: string[];
  matchedSourceWeights: Array<{ pattern: string; weight: number }>;
}

const DEFAULT_EXCLUDES = [
  ".env",
  ".env.*",
  "*.key",
  "*.pem",
  "*.p12",
  "*.pfx",
  "id_rsa",
  "id_ed25519",
  "secrets/",
  ".secrets/",
  "doppler.yaml",
  "doppler.*",
  ".doppler/",
  ".terraform/",
  "*.tfstate",
  "*.tfstate.*",
  "backups/",
  "*.zip",
  "*.7z",
  "*.tar",
  "*.gz",
  "*.tar.gz",
  "node_modules/",
  "dist/",
  "build/",
  "target/",
  "coverage/",
  ".git/",
  "host-output/",
  "*.log"
];

const PRIVATE_IP_PATTERN =
  /\b(10\.(?:\d{1,3}\.){2}\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.(?:\d{1,3}\.)\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})\b/;

const DOMAIN_TERMS: Record<string, string[]> = {
  restore: ["restore", "restore-test", "restore-verified", "återställ", "aterstall"],
  backup: ["backup", "backups", "backup-policy"],
  rollback: ["rollback", "roll back"],
  telegram: ["telegram", "openclaw", "n8n"],
  security: ["security", "säkerhet", "sakerhet", "approval", "explicit"],
  deploy: ["deploy", "deployment", "production deploy"],
  firewall: ["firewall", "network exposure"],
  secret: ["secret", "secrets", "token", "rotation", "doppler"],
  root: ["root", "proxmox", "ssh"],
  documentation: ["documentation-only", "documentation", "docs"],
  prompt: ["prompt", "codex", "antigravity"],
  evaluation: ["mimers", "brunn", "mimisbrunnr", "evaluation", "pr182"],
  gap: ["gap", "luckor", "policy", "runbook", "acceptance criteria"]
};

const GENERIC_SOURCE_WEIGHTS: Record<string, number> = {
  "docs/architecture/source-of-truth-map.md": 5,
  "docs/operations/": 4,
  "docs/runbooks/": 4,
  "docs/security/": 4,
  "docs/backup/": 3,
  "README.md": 2,
  "AGENTS.md": 2,
  "docs/glossary.md": -2,
  "docs/repositories/": -2,
  "docs/evaluations/": -5,
  "docs/backlog/": -6
};

const PANOPTICON_SOURCE_WEIGHTS: Record<string, number> = {
  "docs/architecture/source-of-truth-map.md": 5,
  "ai/prompts/codex-task-template.md": 7,
  "docs/ai-agents/agent-prompt-quality-standard.md": 8,
  "docs/operations/backup-restore-map.md": 12,
  "docs/operations/documentation-only-pr-checklist.md": 7,
  "docs/operations/restore-evidence-index.md": 8,
  "docs/operations/restore-readiness.md": 8,
  "docs/runbooks/panopticon-backup-policy.md": 10,
  "docs/runbooks/restore-test-runbook.md": 10,
  "docs/runbooks/restore-test-minimum-standard.md": 6,
  "docs/security/approval-gate-matrix.md": 6,
  "docs/security/command-class-taxonomy.md": 6,
  "docs/operations/": 4,
  "docs/runbooks/": 4,
  "docs/security/": 4,
  "docs/backup/": 3,
  "README.md": 2,
  "AGENTS.md": 2,
  "docs/glossary.md": -2,
  "docs/repositories/": -2,
  "docs/evaluations/": -5,
  "docs/backlog/": -6
};

const SOURCE_WEIGHT_PROFILES: Record<RepoRankingProfile, Record<string, number>> = {
  generic: GENERIC_SOURCE_WEIGHTS,
  panopticon: PANOPTICON_SOURCE_WEIGHTS
};

const INTENT_SOURCE_WEIGHTS: Record<RepoAnswerIntent, Record<string, number>> = {
  generic: {},
  repo_orientation: {
    "docs/architecture/source-of-truth-map.md": 45,
    "docs/operations/backup-restore-map.md": 70,
    "docs/operations/restore-evidence-index.md": -18,
    "docs/operations/restore-readiness.md": 6,
    "docs/runbooks/panopticon-backup-policy.md": 18,
    "docs/runbooks/restore-test-runbook.md": 18,
    "docs/operations/": 4,
    "docs/runbooks/": 4,
    "docs/README.md": -12,
    "docs/glossary.md": -18,
    "docs/repositories/": -14,
    "docs/observability/": -10,
    "docs/backlog/": -10
  },
  security_reasoning: {
    "docs/security/approval-gate-matrix.md": 45,
    "docs/security/command-class-taxonomy.md": 45,
    "docs/security/threat-model-telegram-n8n-openclaw.md": -12,
    "docs/operations/documentation-only-pr-checklist.md": 8,
    "docs/security/": 6,
    "docs/glossary.md": -18,
    "docs/runbooks/openclaw-command-router.md": -10,
    "docs/backlog/": -10
  },
  prompt_generation: {
    "docs/ai-agents/agent-prompt-quality-standard.md": 30,
    "ai/prompts/codex-task-template.md": 35,
    "docs/operations/documentation-only-pr-checklist.md": 35,
    "docs/security/approval-gate-matrix.md": -20,
    "docs/operations/restore-evidence-index.md": -12,
    "docs/runbooks/restore-test-runbook.md": 16,
    "docs/runbooks/restore-test-minimum-standard.md": 8,
    "docs/evaluations/": -12,
    "docs/backlog/": -25,
    "docs/backlog.md": -12,
    "ai/handoffs/": -6
  },
  gap_analysis: {
    "docs/operations/backup-restore-map.md": 80,
    "docs/operations/restore-readiness.md": 35,
    "docs/runbooks/restore-test-minimum-standard.md": 24,
    "docs/operations/restore-evidence-index.md": -20,
    "docs/observability/": -14,
    "docs/operations/README.md": -10,
    "docs/backlog/": 6,
    "docs/evaluations/": -10
  },
  operator_usefulness: {
    "docs/operations/backup-restore-map.md": 34,
    "docs/operations/restore-evidence-index.md": 18,
    "docs/operations/restore-readiness.md": 50,
    "docs/runbooks/panopticon-backup-policy.md": 12,
    "docs/runbooks/restore-test-runbook.md": 55,
    "docs/architecture/source-of-truth-map.md": -16,
    "docs/operations/README.md": -18,
    "docs/README.md": -8,
    "docs/observability/": -10,
    "ai/context/": -4,
    "ai/handoffs/": -8,
    "docs/backlog/": -8
  }
};

const INTENT_TERMS: Record<RepoAnswerIntent, string[]> = {
  generic: [],
  repo_orientation: [
    "source of truth",
    "backup restore map",
    "restore readiness",
    "rollback",
    "backup policy"
  ],
  security_reasoning: [
    "approval gate",
    "command class",
    "explicit approval",
    "public ingress",
    "operator approval"
  ],
  prompt_generation: [
    "agent prompt quality",
    "codex task template",
    "files to inspect first",
    "acceptance criteria",
    "documentation-only",
    "restore-testbarhet",
    "restore test",
    "validation",
    "risk",
    "rollback"
  ],
  gap_analysis: [
    "gap",
    "luckor",
    "missing",
    "backup restore map",
    "restore readiness",
    "minimum standard"
  ],
  operator_usefulness: [
    "next pr",
    "operator",
    "restore evidence",
    "backup restore map",
    "restore readiness",
    "restore test",
    "restore confidence",
    "next steps"
  ]
};

export async function runRepoIndex(payload: JsonRecord): Promise<JsonRecord> {
  const request = parseRepoIndexPayload(payload);
  const root = path.resolve(request.root);
  const rootInfo = await stat(root);
  if (!rootInfo.isDirectory()) {
    throw new Error("index-repo root must be a directory.");
  }

  const exclude = [...DEFAULT_EXCLUDES, ...(request.exclude ?? [])];
  const trackedFiles = await listTrackedFiles(root);
  const files = trackedFiles
    .filter((filePath) => isIncluded(filePath, request.include))
    .filter((filePath) => !matchesAnyPattern(filePath, exclude));

  const warnings: string[] = [];
  const indexedFiles: RepoIndexedFile[] = [];
  const chunks: RepoIndexedChunk[] = [];

  for (const filePath of files) {
    const absolutePath = resolveInsideRoot(root, filePath);
    const content = await readFile(absolutePath, "utf8");
    if (request.denyPrivateIpPatterns && PRIVATE_IP_PATTERN.test(content)) {
      warnings.push(`Excluded '${filePath}' because it matched a private or Tailnet IP pattern.`);
      continue;
    }

    const normalized = content.replace(/\r\n?/g, "\n");
    const digest = createHash("sha256").update(normalized, "utf8").digest("hex");
    const bytes = Buffer.byteLength(normalized, "utf8");
    indexedFiles.push({ path: filePath, bytes, sha256: digest });
    chunks.push(...chunkFile(filePath, normalized));
  }

  const outputPath = request.outputPath
    ? path.resolve(request.outputPath)
    : path.join(root, ".mimir-index", "repo-index.json");
  if (isInsideRoot(root, outputPath)) {
    throw new Error("index-repo outputPath must be outside the indexed repo root.");
  }

  const index: RepoIndex = {
    schemaVersion: 1,
    root,
    createdAt: new Date().toISOString(),
    include: request.include,
    exclude,
    files: indexedFiles,
    chunks,
    warnings
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");

  return {
    ok: true,
    indexPath: outputPath,
    root,
    fileCount: indexedFiles.length,
    chunkCount: chunks.length,
    warnings
  };
}

export async function runRepoAnswer(payload: JsonRecord): Promise<JsonRecord> {
  const request = parseRepoAnswerPayload(payload);
  const index = await loadRepoIndex(request.indexPath);
  const answer = answerFromIndex(index, request);
  return {
    ok: true,
    ...answer
  };
}

export async function runRepoEval(payload: JsonRecord): Promise<JsonRecord> {
  const request = parseRepoEvalPayload(payload);
  const index = await loadRepoIndex(request.indexPath);
  const results = request.tests.map((test) => {
    const answer = answerFromIndex(index, {
      indexPath: request.indexPath,
      query: test.prompt,
      maxSources: request.maxSources,
      excludeFromAnswer: test.excludeFromAnswer,
      rankingProfile: request.rankingProfile,
      intentHint: test.intentHint ?? request.intentHint,
      sourceWeights: {
        ...(request.sourceWeights ?? {}),
        ...(test.sourceWeights ?? {})
      },
      requireSourcePathCitations: true
    });
    const citedPaths = new Set(answer.citations.map((citation) => citation.path));
    const citationRanks = new Map(answer.citations.map((citation, index) => [citation.path, index + 1]));
    const expectedFiles = test.expectedFiles ?? [];
    const matchedExpectedFiles = expectedFiles.filter((filePath) => citedPaths.has(filePath));
    const minExpectedFiles = test.minExpectedFiles ?? expectedFiles.length;
    const missingExpectedFiles = expectedFiles.filter((filePath) => !citedPaths.has(filePath));
    const maxExpectedRank = test.maxExpectedRank;
    const lateExpectedFiles = maxExpectedRank === undefined
      ? []
      : matchedExpectedFiles.filter((filePath) => (citationRanks.get(filePath) ?? Infinity) > maxExpectedRank);
    const rankEligibleExpectedFiles = maxExpectedRank === undefined
      ? matchedExpectedFiles
      : matchedExpectedFiles.filter((filePath) => (citationRanks.get(filePath) ?? Infinity) <= maxExpectedRank);
    const missingExpectedFileCount = Math.max(0, minExpectedFiles - rankEligibleExpectedFiles.length);
    const expectedAnyFiles = test.expectedAnyFiles ?? [];
    const missingExpectedAnyFiles = expectedAnyFiles
      .filter((group) => !group.some((filePath) => {
        const rank = citationRanks.get(filePath);
        return rank !== undefined && (maxExpectedRank === undefined || rank <= maxExpectedRank);
      }));
    const forbiddenFiles = test.forbiddenFiles ?? [];
    const citedForbiddenFiles = forbiddenFiles.filter((filePath) => citedPaths.has(filePath));
    const rankMetrics = buildRankMetrics({
      expectedFiles,
      expectedAnyFiles,
      forbiddenFiles,
      citationRanks
    });
    const answerText = [
      answer.summary,
      ...answer.findings.map((finding) => finding.text)
    ].join("\n").toLowerCase();
    const missingTerms = (test.mustIncludeTerms ?? [])
      .filter((term) => !answerText.includes(term.toLowerCase()));
    const citedSourceText = answer.findings.map((finding) => finding.text).join("\n").toLowerCase();
    const groundingTerms = test.groundingTerms ?? test.mustIncludeTerms ?? [];
    const requireGroundedTerms = test.requireGroundedTerms ?? false;
    const ungroundedTerms = requireGroundedTerms
      ? groundingTerms.filter((term) => !citedSourceText.includes(term.toLowerCase()))
      : [];
    const citedForbiddenTerms = (test.forbiddenTerms ?? [])
      .filter((term) => citedSourceText.includes(term.toLowerCase()));
    const citationQuality = answer.citations.every((citation) => citation.path.includes("."));
    const hardFailureCount =
      missingExpectedFileCount +
      lateExpectedFiles.length +
      missingExpectedAnyFiles.length +
      missingTerms.length +
      ungroundedTerms.length +
      citedForbiddenTerms.length +
      citedForbiddenFiles.length +
      (citationQuality ? 0 : 1);
    const status = hardFailureCount === 0
      ? "PASS"
      : answer.citations.length > 0
        ? "PARTIAL"
        : "FAIL";
    return {
      id: test.id,
      prompt: test.prompt,
      status,
      citations: answer.citations,
      intent: answer.intent,
      coverage: {
        expectedFiles: expectedFiles.length,
        matchedExpectedFiles: matchedExpectedFiles.length,
        minExpectedFiles,
        maxExpectedRank,
        rankEligibleExpectedFiles: rankEligibleExpectedFiles.length,
        lateExpectedFiles: lateExpectedFiles.length,
        expectedAnyGroups: expectedAnyFiles.length,
        matchedExpectedAnyGroups: expectedAnyFiles.length - missingExpectedAnyFiles.length,
        forbiddenFiles: forbiddenFiles.length,
        citedForbiddenFiles: citedForbiddenFiles.length,
        groundingTerms: groundingTerms.length,
        ungroundedTerms: ungroundedTerms.length,
        forbiddenTerms: (test.forbiddenTerms ?? []).length,
        citedForbiddenTerms: citedForbiddenTerms.length
      },
      missingExpectedFiles,
      lateExpectedFiles,
      missingExpectedAnyFiles,
      missingTerms,
      ungroundedTerms,
      citedForbiddenTerms,
      citedForbiddenFiles,
      rankMetrics,
      citationQuality,
      statusReason: buildEvalStatusReason({
        status,
        missingExpectedFileCount,
        lateExpectedFiles,
        missingExpectedAnyFiles,
        missingTerms,
        ungroundedTerms,
        citedForbiddenTerms,
        citedForbiddenFiles,
        citationQuality
      }),
      retrievalHealth: answer.retrievalHealth
    };
  });
  const calibration = buildSuiteCalibration(results);

  return {
    ok: true,
    indexPath: request.indexPath,
    results,
    summary: {
      pass: results.filter((result) => result.status === "PASS").length,
      partial: results.filter((result) => result.status === "PARTIAL").length,
      fail: results.filter((result) => result.status === "FAIL").length,
      ...calibration
    }
  };
}

function answerFromIndex(index: RepoIndex, request: RepoAnswerPayload): {
  query: string;
  intent: RepoAnswerIntent;
  summary: string;
  findings: Array<{ text: string; citations: string[] }>;
  citations: Array<{
    path: string;
    headingPath: string[];
    chunkId: string;
    score: number;
    scoreBreakdown: RepoScoreBreakdown;
  }>;
  retrievalHealth: JsonRecord;
  warnings: string[];
} {
  const maxSources = request.maxSources ?? 8;
  const excluded = request.excludeFromAnswer ?? [];
  const intent = request.intentHint ?? inferAnswerIntent(request.query);
  const weights = {
    ...SOURCE_WEIGHT_PROFILES[request.rankingProfile ?? "generic"],
    ...INTENT_SOURCE_WEIGHTS[intent],
    ...(request.sourceWeights ?? {})
  };
  const queryTerms = expandQueryTerms(request.query, intent);
  const scored = index.chunks
    .filter((chunk) => !matchesAnyPattern(chunk.path, excluded))
    .map((chunk) => scoreChunk(chunk, queryTerms, weights))
    .filter((chunk) => chunk.score > 0)
    .sort((left, right) => right.score - left.score);
  const selected = selectDiverseChunks(scored, maxSources);
  const citations = selected.map((chunk) => ({
    path: chunk.path,
    headingPath: chunk.headingPath,
    chunkId: chunk.id,
    score: Number(chunk.score.toFixed(2)),
    scoreBreakdown: normalizeScoreBreakdown(chunk.scoreBreakdown)
  }));
  const warnings = [...index.warnings];
  if (request.requireSourcePathCitations && citations.some((citation) => !citation.path.includes("."))) {
    warnings.push("One or more citations did not look like source file paths.");
  }
  if (selected.length === 0) {
    warnings.push("No answerable source chunks matched the query.");
  }

  return {
    query: request.query,
    intent,
    summary: selected.length > 0
      ? `Found ${selected.length} repo source chunk(s) for '${request.query}'.`
      : `No repo source chunks found for '${request.query}'.`,
    findings: selected.map((chunk) => ({
      text: summarizeChunk(chunk),
      citations: [formatCitation(chunk)]
    })),
    citations,
    retrievalHealth: {
      status: selected.length > 0 ? "lexical_only" : "unanswered",
      lexicalCandidates: scored.length,
      deliveredCandidates: selected.length,
      intent,
      queryTerms,
      topCandidates: scored.slice(0, Math.min(10, scored.length)).map((chunk) => ({
        path: chunk.path,
        chunkId: chunk.id,
        score: Number(chunk.score.toFixed(2)),
        scoreBreakdown: normalizeScoreBreakdown(chunk.scoreBreakdown)
      })),
      vectorCandidates: 0,
      warnings: [
        "answer-repo uses deterministic lexical retrieval only.",
        ...warnings
      ]
    },
    warnings
  };
}

function parseRepoIndexPayload(payload: JsonRecord): RepoIndexPayload {
  return {
    root: requireString(payload.root, "root"),
    include: requireStringArray(payload.include, "include"),
    exclude: optionalStringArray(payload.exclude, "exclude"),
    outputPath: optionalString(payload.outputPath, "outputPath"),
    denyPrivateIpPatterns: payload.denyPrivateIpPatterns === undefined
      ? true
      : requireBoolean(payload.denyPrivateIpPatterns, "denyPrivateIpPatterns")
  };
}

function parseRepoAnswerPayload(payload: JsonRecord): RepoAnswerPayload {
  return {
    indexPath: requireString(payload.indexPath, "indexPath"),
    query: requireString(payload.query, "query"),
    maxSources: optionalPositiveInteger(payload.maxSources, "maxSources"),
    excludeFromAnswer: optionalStringArray(payload.excludeFromAnswer, "excludeFromAnswer"),
    rankingProfile: optionalRankingProfile(payload.rankingProfile, "rankingProfile"),
    intentHint: optionalAnswerIntent(payload.intentHint, "intentHint"),
    sourceWeights: optionalNumberRecord(payload.sourceWeights, "sourceWeights"),
    requireSourcePathCitations: payload.requireSourcePathCitations === undefined
      ? true
      : requireBoolean(payload.requireSourcePathCitations, "requireSourcePathCitations")
  };
}

function parseRepoEvalPayload(payload: JsonRecord): RepoEvalPayload {
  const tests = payload.tests;
  if (!Array.isArray(tests) || tests.length === 0) {
    throw new Error("Invalid field 'tests': must be a non-empty array.");
  }
  return {
    indexPath: requireString(payload.indexPath, "indexPath"),
    tests: tests.map((test, index) => {
      if (!test || typeof test !== "object") {
        throw new Error(`Invalid field 'tests[${index}]': must be an object.`);
      }
      const record = test as JsonRecord;
      return {
        id: requireString(record.id, `tests[${index}].id`),
        prompt: requireString(record.prompt, `tests[${index}].prompt`),
        expectedFiles: optionalStringArray(record.expectedFiles, `tests[${index}].expectedFiles`),
        expectedAnyFiles: optionalStringArrayArray(record.expectedAnyFiles, `tests[${index}].expectedAnyFiles`),
        forbiddenFiles: optionalStringArray(record.forbiddenFiles, `tests[${index}].forbiddenFiles`),
        minExpectedFiles: optionalPositiveInteger(record.minExpectedFiles, `tests[${index}].minExpectedFiles`),
        maxExpectedRank: optionalPositiveInteger(record.maxExpectedRank, `tests[${index}].maxExpectedRank`),
        mustIncludeTerms: optionalStringArray(record.mustIncludeTerms, `tests[${index}].mustIncludeTerms`),
        groundingTerms: optionalStringArray(record.groundingTerms, `tests[${index}].groundingTerms`),
        requireGroundedTerms: record.requireGroundedTerms === undefined
          ? undefined
          : requireBoolean(record.requireGroundedTerms, `tests[${index}].requireGroundedTerms`),
        forbiddenTerms: optionalStringArray(record.forbiddenTerms, `tests[${index}].forbiddenTerms`),
        excludeFromAnswer: optionalStringArray(record.excludeFromAnswer, `tests[${index}].excludeFromAnswer`),
        intentHint: optionalAnswerIntent(record.intentHint, `tests[${index}].intentHint`),
        sourceWeights: optionalNumberRecord(record.sourceWeights, `tests[${index}].sourceWeights`)
      };
    }),
    maxSources: optionalPositiveInteger(payload.maxSources, "maxSources"),
    rankingProfile: optionalRankingProfile(payload.rankingProfile, "rankingProfile"),
    intentHint: optionalAnswerIntent(payload.intentHint, "intentHint"),
    sourceWeights: optionalNumberRecord(payload.sourceWeights, "sourceWeights")
  };
}

function buildEvalStatusReason(input: {
  status: string;
  missingExpectedFileCount: number;
  lateExpectedFiles: string[];
  missingExpectedAnyFiles: string[][];
  missingTerms: string[];
  ungroundedTerms: string[];
  citedForbiddenTerms: string[];
  citedForbiddenFiles: string[];
  citationQuality: boolean;
}): string {
  if (input.status === "PASS") {
    return "All required file, term, forbidden-file, and citation-quality checks passed.";
  }
  const reasons = [
    input.missingExpectedFileCount > 0
      ? `${input.missingExpectedFileCount} required expected file(s) missing`
      : undefined,
    input.lateExpectedFiles.length > 0
      ? `${input.lateExpectedFiles.length} expected file(s) ranked too low`
      : undefined,
    input.missingExpectedAnyFiles.length > 0
      ? `${input.missingExpectedAnyFiles.length} expectedAnyFiles group(s) missing`
      : undefined,
    input.missingTerms.length > 0
      ? `${input.missingTerms.length} required term(s) missing`
      : undefined,
    input.ungroundedTerms.length > 0
      ? `${input.ungroundedTerms.length} required term(s) not grounded in cited sources`
      : undefined,
    input.citedForbiddenTerms.length > 0
      ? `${input.citedForbiddenTerms.length} forbidden term(s) present`
      : undefined,
    input.citedForbiddenFiles.length > 0
      ? `${input.citedForbiddenFiles.length} forbidden file(s) cited`
      : undefined,
    input.citationQuality ? undefined : "one or more citations are not source paths"
  ].filter(Boolean);
  return reasons.join("; ") || "No source citations were delivered.";
}

function buildRankMetrics(input: {
  expectedFiles: string[];
  expectedAnyFiles: string[][];
  forbiddenFiles: string[];
  citationRanks: Map<string, number>;
}): JsonRecord {
  const expectedFileRanks = input.expectedFiles.map((filePath) => ({
    path: filePath,
    rank: input.citationRanks.get(filePath) ?? null
  }));
  const expectedAnyGroupRanks = input.expectedAnyFiles.map((group) => {
    const fileRanks = group.map((filePath) => ({
      path: filePath,
      rank: input.citationRanks.get(filePath) ?? null
    }));
    const bestRank = fileRanks.reduce<number | null>((best, entry) => {
      if (entry.rank === null) {
        return best;
      }
      return best === null ? entry.rank : Math.min(best, entry.rank);
    }, null);
    return { files: fileRanks, bestRank };
  });
  const forbiddenFileRanks = input.forbiddenFiles.map((filePath) => ({
    path: filePath,
    rank: input.citationRanks.get(filePath) ?? null
  }));
  const presentExpectedRanks = expectedFileRanks
    .map((entry) => entry.rank)
    .filter((rank): rank is number => rank !== null);
  const reciprocalRanks = presentExpectedRanks.map((rank) => 1 / rank);
  return {
    expectedFileRanks,
    expectedAnyGroupRanks,
    forbiddenFileRanks,
    bestExpectedRank: presentExpectedRanks.length > 0 ? Math.min(...presentExpectedRanks) : null,
    meanReciprocalRank: reciprocalRanks.length > 0
      ? Number((reciprocalRanks.reduce((sum, rank) => sum + rank, 0) / reciprocalRanks.length).toFixed(4))
      : 0
  };
}

function buildSuiteCalibration(results: Array<{
  status: string;
  coverage: JsonRecord;
  rankMetrics: JsonRecord;
}>): JsonRecord {
  const total = results.length;
  const pass = results.filter((result) => result.status === "PASS").length;
  const partial = results.filter((result) => result.status === "PARTIAL").length;
  const meanReciprocalRanks = results
    .filter((result) => (
      Array.isArray(result.rankMetrics.expectedFileRanks) &&
      result.rankMetrics.expectedFileRanks.length > 0
    ))
    .map((result) => Number(result.rankMetrics.meanReciprocalRank ?? 0))
    .filter((value) => Number.isFinite(value));
  const expectedAnyReciprocalRanks = results
    .flatMap((result) => Array.isArray(result.rankMetrics.expectedAnyGroupRanks)
      ? result.rankMetrics.expectedAnyGroupRanks
      : [])
    .map((group) => {
      if (!group || typeof group !== "object" || Array.isArray(group)) {
        return 0;
      }
      const rank = Number((group as JsonRecord).bestRank ?? 0);
      return rank > 0 && Number.isFinite(rank) ? 1 / rank : 0;
    });
  const groundingTerms = results
    .map((result) => Number(result.coverage.groundingTerms ?? 0))
    .reduce((sum, value) => sum + value, 0);
  const ungroundedTerms = results
    .map((result) => Number(result.coverage.ungroundedTerms ?? 0))
    .reduce((sum, value) => sum + value, 0);
  const forbiddenViolations = results
    .map((result) => (
      Number(result.coverage.citedForbiddenFiles ?? 0) +
      Number(result.coverage.citedForbiddenTerms ?? 0)
    ))
    .reduce((sum, value) => sum + value, 0);
  const passRate = total > 0 ? pass / total : 0;
  const partialCreditRate = total > 0 ? (pass + partial * 0.5) / total : 0;
  const reciprocalRankSamples = [...meanReciprocalRanks, ...expectedAnyReciprocalRanks];
  const meanReciprocalRank = reciprocalRankSamples.length > 0
    ? reciprocalRankSamples.reduce((sum, value) => sum + value, 0) / reciprocalRankSamples.length
    : 0;
  const groundedTermRate = groundingTerms > 0
    ? (groundingTerms - ungroundedTerms) / groundingTerms
    : 1;
  const violationPenalty = Math.min(1, forbiddenViolations / Math.max(1, total));
  const scoreOutOf10 = Math.max(0, Math.min(10, (
    partialCreditRate * 6 +
    passRate * 2 +
    groundedTermRate * 1 +
    (1 - violationPenalty) * 1
  )));
  return {
    passRate: Number(passRate.toFixed(4)),
    partialCreditRate: Number(partialCreditRate.toFixed(4)),
    meanReciprocalRank: Number(meanReciprocalRank.toFixed(4)),
    groundedTermRate: Number(groundedTermRate.toFixed(4)),
    forbiddenViolationCount: forbiddenViolations,
    scoreOutOf10: Number(scoreOutOf10.toFixed(2))
  };
}

async function loadRepoIndex(indexPath: string): Promise<RepoIndex> {
  const raw = await readFile(path.resolve(indexPath), "utf8");
  const parsed = JSON.parse(raw) as Partial<RepoIndex>;
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.chunks) || !Array.isArray(parsed.files)) {
    throw new Error("Invalid repo index: unsupported schema.");
  }
  return parsed as RepoIndex;
}

async function listTrackedFiles(root: string): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["ls-files"], { cwd: root });
  return stdout
    .split(/\r?\n/)
    .map((line) => normalizeRepoPath(line.trim()))
    .filter(Boolean);
}

function chunkFile(filePath: string, content: string): RepoIndexedChunk[] {
  const lines = content.split("\n");
  const chunks: RepoIndexedChunk[] = [];
  let currentHeading: string[] = [];
  let current: string[] = [];
  let ordinal = 0;

  const flush = () => {
    const text = current.join("\n").trim();
    if (!text) {
      current = [];
      return;
    }
    chunks.push({
      id: `${filePath}::${ordinal}`,
      path: filePath,
      headingPath: currentHeading,
      text,
      ordinal
    });
    ordinal += 1;
    current = [];
  };

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      currentHeading = [
        ...currentHeading.slice(0, level - 1),
        heading[2].trim()
      ];
    }
    current.push(line);
    if (current.join("\n").length > 2500) {
      flush();
    }
  }
  flush();
  return chunks;
}

function scoreChunk(
  chunk: RepoIndexedChunk,
  queryTerms: string[],
  weights: Record<string, number>
): ScoredChunk {
  const haystack = `${chunk.path}\n${chunk.headingPath.join(" ")}\n${chunk.text}`.toLowerCase();
  const matchedTerms = queryTerms.filter((term) => haystack.includes(term));
  const termScore = matchedTerms.reduce((score, term) => score + Math.min(term.length, 18), 0);
  const matchedSourceWeights = Object.entries(weights)
    .filter(([pattern]) => matchesPattern(chunk.path, normalizeRepoPath(pattern)))
    .map(([pattern, weight]) => ({ pattern: normalizeRepoPath(pattern), weight }));
  const pathScore = matchedSourceWeights.reduce((score, entry) => score + entry.weight, 0);
  const headingScore = chunk.headingPath.length > 0 ? 1 : 0;
  return {
    ...chunk,
    score: termScore + pathScore + headingScore,
    matchedTerms,
    scoreBreakdown: {
      termScore,
      pathScore,
      headingScore,
      matchedTerms,
      matchedSourceWeights
    }
  };
}

function normalizeScoreBreakdown(breakdown: RepoScoreBreakdown): RepoScoreBreakdown {
  return {
    termScore: Number(breakdown.termScore.toFixed(2)),
    pathScore: Number(breakdown.pathScore.toFixed(2)),
    headingScore: Number(breakdown.headingScore.toFixed(2)),
    matchedTerms: breakdown.matchedTerms.slice(0, 20),
    matchedSourceWeights: breakdown.matchedSourceWeights
  };
}

function selectDiverseChunks(chunks: ScoredChunk[], maxSources: number): ScoredChunk[] {
  const selected: ScoredChunk[] = [];
  const seenPaths = new Set<string>();
  for (const chunk of chunks) {
    if (selected.length >= maxSources) {
      break;
    }
    if (seenPaths.has(chunk.path)) {
      continue;
    }
    selected.push(chunk);
    seenPaths.add(chunk.path);
  }
  return selected;
}

function summarizeChunk(chunk: RepoIndexedChunk): string {
  const normalized = chunk.text.replace(/\s+/g, " ").trim();
  return normalized.length <= 320 ? normalized : `${normalized.slice(0, 317)}...`;
}

function formatCitation(chunk: RepoIndexedChunk): string {
  const heading = chunk.headingPath.length > 0 ? `#${chunk.headingPath.join(" > ")}` : "";
  return `${chunk.path}${heading}`;
}

function expandQueryTerms(query: string, intent: RepoAnswerIntent): string[] {
  const normalized = normalizeSearchText(query);
  const terms = new Set<string>();
  for (const token of normalized.split(/\s+/).filter((token) => token.length >= 3)) {
    terms.add(token);
    for (const [key, expansions] of Object.entries(DOMAIN_TERMS)) {
      if (token.includes(key) || expansions.some((term) => term.includes(token) || token.includes(term))) {
        expansions.forEach((term) => terms.add(normalizeSearchText(term)));
      }
    }
  }
  for (const [key, expansions] of Object.entries(DOMAIN_TERMS)) {
    if (normalized.includes(key) || expansions.some((term) => normalized.includes(normalizeSearchText(term)))) {
      expansions.forEach((term) => terms.add(normalizeSearchText(term)));
    }
  }
  INTENT_TERMS[intent].forEach((term) => terms.add(normalizeSearchText(term)));
  return [...terms].filter(Boolean);
}

function inferAnswerIntent(query: string): RepoAnswerIntent {
  const normalized = normalizeSearchText(query);
  if (
    normalized.includes("prompt") ||
    normalized.includes("codex-task") ||
    normalized.includes("documentation-only") ||
    normalized.includes("restore-testbarhet")
  ) {
    return "prompt_generation";
  }
  if (
    normalized.includes("telegram") ||
    normalized.includes("openclaw") ||
    normalized.includes("sakerhet") ||
    normalized.includes("security") ||
    normalized.includes("approval")
  ) {
    return "security_reasoning";
  }
  if (
    normalized.includes("gap") ||
    normalized.includes("luck") ||
    normalized.includes("saknas") ||
    normalized.includes("brist")
  ) {
    return "gap_analysis";
  }
  if (
    normalized.includes("nasta") ||
    normalized.includes("next") ||
    normalized.includes("pr182") ||
    normalized.includes("operator")
  ) {
    return "operator_usefulness";
  }
  if (
    normalized.includes("restore") ||
    normalized.includes("backup") ||
    normalized.includes("rollback") ||
    normalized.includes("aterstall")
  ) {
    return "repo_orientation";
  }
  return "generic";
}

function isIncluded(filePath: string, include: string[]): boolean {
  return include.some((pattern) => matchesPattern(filePath, normalizeRepoPath(pattern)));
}

function matchesAnyPattern(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesPattern(filePath, normalizeRepoPath(pattern)));
}

function matchesPattern(filePath: string, pattern: string): boolean {
  if (pattern.endsWith("/")) {
    return filePath.startsWith(pattern);
  }
  if (pattern.includes("*")) {
    const regex = new RegExp(`^${pattern.split("*").map(escapeRegex).join(".*")}$`);
    return regex.test(filePath) || regex.test(path.basename(filePath));
  }
  return filePath === pattern || filePath.startsWith(`${pattern}/`);
}

function resolveInsideRoot(root: string, repoPath: string): string {
  const resolved = path.resolve(root, repoPath);
  if (!isInsideRoot(root, resolved)) {
    throw new Error(`Path '${repoPath}' escapes repo root.`);
  }
  return resolved;
}

function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid field '${field}': must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireString(value, field);
}

function requireStringArray(value: unknown, field: string): string[] {
  const parsed = optionalStringArray(value, field);
  if (!parsed || parsed.length === 0) {
    throw new Error(`Invalid field '${field}': must be a non-empty string array.`);
  }
  return parsed;
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid field '${field}': must be a string array.`);
  }
  return value.map((item, index) => requireString(item, `${field}[${index}]`));
}

function optionalStringArrayArray(value: unknown, field: string): string[][] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid field '${field}': must be an array of string arrays.`);
  }
  return value.map((group, index) => requireStringArray(group, `${field}[${index}]`));
}

function optionalRankingProfile(value: unknown, field: string): RepoRankingProfile | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = requireString(value, field);
  if (parsed !== "generic" && parsed !== "panopticon") {
    throw new Error(`Invalid field '${field}': must be 'generic' or 'panopticon'.`);
  }
  return parsed;
}

function optionalAnswerIntent(value: unknown, field: string): RepoAnswerIntent | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = requireString(value, field);
  if (
    parsed !== "generic" &&
    parsed !== "repo_orientation" &&
    parsed !== "security_reasoning" &&
    parsed !== "prompt_generation" &&
    parsed !== "gap_analysis" &&
    parsed !== "operator_usefulness"
  ) {
    throw new Error(
      `Invalid field '${field}': must be generic, repo_orientation, security_reasoning, prompt_generation, gap_analysis, or operator_usefulness.`
    );
  }
  return parsed;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid field '${field}': must be a boolean.`);
  }
  return value;
}

function optionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error(`Invalid field '${field}': must be a positive integer.`);
  }
  return Number(value);
}

function optionalNumberRecord(value: unknown, field: string): Record<string, number> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid field '${field}': must be an object.`);
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
      if (typeof entry !== "number") {
        throw new Error(`Invalid field '${field}.${key}': must be a number.`);
      }
      return [normalizeRepoPath(key), entry];
    })
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
