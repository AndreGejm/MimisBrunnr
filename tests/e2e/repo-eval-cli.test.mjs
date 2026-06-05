import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliPath = path.resolve("apps/mimir-cli/dist/main.js");

test("repo evaluation CLI indexes tracked files and answers with source-path citations", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "mimir-repo-eval-"));
  const repo = path.join(workspace, "repo");
  const indexPath = path.join(workspace, "index", "repo-index.json");
  await mkdir(path.join(repo, "docs", "runbooks"), { recursive: true });
  await mkdir(path.join(repo, "docs", "ai-agents"), { recursive: true });
  await mkdir(path.join(repo, "docs", "security"), { recursive: true });
  await mkdir(path.join(repo, "docs", "evaluations"), { recursive: true });
  await writeFile(path.join(repo, "README.md"), "# Demo\n\nRepository overview.\n", "utf8");
  await writeFile(
    path.join(repo, "docs", "runbooks", "restore-test-runbook.md"),
    [
      "# Restore Test Runbook",
      "",
      "## Purpose",
      "",
      "Backup is not trusted until restore has been tested.",
      "Rollback needs explicit operator approval."
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(repo, "docs", "ai-agents", "agent-prompt-quality-standard.md"),
    [
      "# Agent Prompt Quality Standard",
      "",
      "Prompts should list files to inspect first, acceptance criteria, validation, risk, and rollback.",
      "Documentation-only work should cite source documents instead of eval suites."
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(repo, "docs", "security", "approval-gate-matrix.md"),
    [
      "# Approval Gate Matrix",
      "",
      "Telegram and OpenClaw automation require explicit operator approval before risky commands.",
      "Public ingress and unaudited deployment actions are blocked."
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(repo, "docs", "evaluations", "suite.md"),
    "# Eval Suite\n\nVilka dokument beskriver restore, backup, rollback, prompt och approval?\n",
    "utf8"
  );
  await execFileAsync("git", ["init"], { cwd: repo });
  await execFileAsync("git", ["add", "README.md", "docs"], { cwd: repo });

  const index = await runCli("index-repo", {
    root: repo,
    include: ["README.md", "docs/"],
    outputPath: indexPath
  });
  assert.equal(index.ok, true);
  assert.equal(index.fileCount, 5);
  assert.equal(index.indexPath, indexPath);

  const answer = await runCli("answer-repo", {
    indexPath,
    query: "Vilka dokument beskriver restore, backup och rollback?",
    excludeFromAnswer: ["docs/evaluations/"],
    maxSources: 3
  });
  assert.equal(answer.ok, true);
  assert.equal(answer.citations[0].path, "docs/runbooks/restore-test-runbook.md");
  assert.ok(answer.citations[0].scoreBreakdown.termScore > 0);
  assert.ok(Array.isArray(answer.retrievalHealth.topCandidates));
  assert.equal(answer.retrievalHealth.topCandidates[0].path, "docs/runbooks/restore-test-runbook.md");
  assert.equal(
    answer.citations.some((citation) => citation.path.startsWith("docs/evaluations/")),
    false
  );

  const evaluation = await runCli("eval-repo", {
    indexPath,
    tests: [
      {
        id: "restore-docs",
        prompt: "Vilka dokument beskriver restore, backup och rollback?",
        expectedFiles: ["docs/runbooks/restore-test-runbook.md"],
        expectedAnyFiles: [["README.md", "docs/runbooks/restore-test-runbook.md"]],
        forbiddenFiles: ["docs/evaluations/suite.md"],
        mustIncludeTerms: ["restore"],
        requireGroundedTerms: true,
        forbiddenTerms: ["untrusted"],
        maxExpectedRank: 1,
        excludeFromAnswer: ["docs/evaluations/"]
      },
      {
        id: "prompt-generation",
        prompt: "Generera en Codex-prompt for dokumentation-only restore-testbarhet.",
        expectedFiles: ["docs/ai-agents/agent-prompt-quality-standard.md"],
        forbiddenFiles: ["docs/evaluations/suite.md"],
        mustIncludeTerms: ["acceptance criteria"],
        requireGroundedTerms: true,
        forbiddenTerms: ["criterion leak"],
        maxExpectedRank: 1,
        excludeFromAnswer: ["docs/evaluations/"],
        intentHint: "prompt_generation"
      },
      {
        id: "security-reasoning",
        prompt: "Vilka regler stoppar Telegram och OpenClaw fran public ingress utan approval?",
        expectedFiles: ["docs/security/approval-gate-matrix.md"],
        forbiddenFiles: ["docs/evaluations/suite.md"],
        mustIncludeTerms: ["approval"],
        requireGroundedTerms: true,
        forbiddenTerms: ["root shell"],
        maxExpectedRank: 1,
        excludeFromAnswer: ["docs/evaluations/"],
        intentHint: "security_reasoning"
      }
    ],
    maxSources: 3
  });
  assert.equal(evaluation.ok, true);
  assert.equal(evaluation.summary.pass, 3);
  assert.equal(evaluation.summary.passRate, 1);
  assert.equal(evaluation.summary.groundedTermRate, 1);
  assert.equal(evaluation.summary.forbiddenViolationCount, 0);
  assert.equal(evaluation.summary.scoreOutOf10, 10);
  assert.equal(evaluation.results[0].status, "PASS");
  assert.equal(evaluation.results[0].coverage.matchedExpectedFiles, 1);
  assert.equal(evaluation.results[0].coverage.rankEligibleExpectedFiles, 1);
  assert.equal(evaluation.results[0].rankMetrics.bestExpectedRank, 1);
  assert.equal(evaluation.results[0].rankMetrics.meanReciprocalRank, 1);
  assert.equal(evaluation.results[0].coverage.citedForbiddenTerms, 0);
  assert.equal(evaluation.results[0].coverage.ungroundedTerms, 0);
  assert.equal(evaluation.results[0].citationQuality, true);
  assert.equal(evaluation.results[1].status, "PASS");
  assert.equal(evaluation.results[1].intent, "prompt_generation");
  assert.equal(
    evaluation.results[1].citations.some((citation) => citation.path.startsWith("docs/evaluations/")),
    false
  );
  assert.equal(evaluation.results[2].status, "PASS");
  assert.equal(evaluation.results[2].intent, "security_reasoning");
  assert.equal(evaluation.results[2].citations[0].path, "docs/security/approval-gate-matrix.md");
  assert.equal(evaluation.results[2].rankMetrics.expectedFileRanks[0].rank, 1);
  assert.ok(evaluation.results[2].citations[0].scoreBreakdown.pathScore > 0);

  const ungroundedEvaluation = await runCli("eval-repo", {
    indexPath,
    tests: [
      {
        id: "ungrounded-term",
        prompt: "Vilka dokument beskriver restore och hallucinated-policy?",
        expectedFiles: ["docs/runbooks/restore-test-runbook.md"],
        mustIncludeTerms: ["hallucinated-policy"],
        requireGroundedTerms: true,
        excludeFromAnswer: ["docs/evaluations/"]
      }
    ],
    maxSources: 3
  });
  assert.equal(ungroundedEvaluation.ok, true);
  assert.equal(ungroundedEvaluation.results[0].status, "PARTIAL");
  assert.deepEqual(ungroundedEvaluation.results[0].ungroundedTerms, ["hallucinated-policy"]);
  assert.match(
    ungroundedEvaluation.results[0].statusReason,
    /required term\(s\) not grounded in cited sources/
  );
});

async function runCli(command, payload) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [cliPath, command, "--json", JSON.stringify(payload), "--no-pretty"],
    { cwd: path.resolve(".") }
  );
  return JSON.parse(stdout);
}
