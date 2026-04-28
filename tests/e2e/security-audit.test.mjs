import assert from "node:assert/strict";
import test from "node:test";
import { classifyAuditReport } from "../../scripts/audit-security.mjs";

const allowedVoltAgentUuidAdvisory = {
  advisories: {
    1116970: {
      github_advisory_id: "GHSA-w5hq-g745-h8pq",
      module_name: "uuid",
      severity: "moderate",
      title: "uuid: Missing buffer bounds check in v3/v5/v6 when buf is provided",
      findings: [
        {
          version: "9.0.1",
          paths: [
            "packages__infrastructure>@voltagent/core>uuid",
            "packages\\infrastructure > @voltagent/core@2.7.2 > uuid@9.0.1",
            "apps\\mimir-api > @mimir/infrastructure@link:../../packages/infrastructure > @voltagent/core@2.7.2 > uuid@9.0.1",
            "vendor\\codex-claude-voltagent-client > @voltagent/core@2.7.2 > uuid@9.0.1"
          ]
        }
      ],
      recommendation: "Upgrade to version 14.0.0 or later"
    }
  }
};

test("security audit allows the documented VoltAgent uuid advisory", () => {
  const result = classifyAuditReport(allowedVoltAgentUuidAdvisory);

  assert.equal(result.allowed.length, 1);
  assert.equal(result.blocking.length, 0);
});

test("security audit blocks the same advisory when it appears outside the documented path", () => {
  const report = structuredClone(allowedVoltAgentUuidAdvisory);
  report.advisories[1116970].findings[0].paths = ["some-other-package>uuid"];

  const result = classifyAuditReport(report);

  assert.equal(result.allowed.length, 0);
  assert.equal(result.blocking.length, 1);
});

test("security audit blocks unknown advisories", () => {
  const result = classifyAuditReport({
    advisories: {
      123: {
        github_advisory_id: "GHSA-unknown",
        module_name: "example",
        severity: "high",
        title: "unknown advisory",
        findings: [{ paths: ["example"] }]
      }
    }
  });

  assert.equal(result.allowed.length, 0);
  assert.equal(result.blocking.length, 1);
});
