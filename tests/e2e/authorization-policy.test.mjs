import assert from "node:assert/strict";
import test from "node:test";

const orchestration = await import("../../packages/orchestration/dist/index.js");
const matrix = await import("../../packages/orchestration/dist/root/command-authorization-matrix.js");
const registryPolicy = await import("../../packages/orchestration/dist/root/actor-registry-policy.js");
const tokenInspector = await import("../../packages/orchestration/dist/root/actor-token-inspector.js");

test("command authorization matrix exposes administrative role policy", () => {
  assert.deepEqual(
    matrix.getAdministrativeActionAuthorizationRoles("view_freshness_status"),
    ["operator", "orchestrator", "system"]
  );
});

test("actor registry policy summarizes lifecycle and credential windows", () => {
  const evaluationTimeMs = Date.parse("2026-01-01T12:30:00Z");
  const registry = registryPolicy.buildActorRegistry([
    {
      actorId: "writer-agent",
      actorRole: "writer",
      source: "mcp",
      authTokens: [
        {
          token: "writer-active-token",
          label: "active",
          validFrom: "2026-01-01T12:00:00Z",
          validUntil: "2026-01-01T13:00:00Z"
        },
        {
          token: "writer-future-token",
          label: "future",
          validFrom: "2026-01-01T13:00:01Z"
        }
      ]
    }
  ]);

  const entry = registry.get("writer-agent");
  assert.ok(entry);
  assert.equal(
    registryPolicy.deriveActorLifecycleStatus(entry, evaluationTimeMs),
    "active"
  );

  const summary = registryPolicy.summarizeActorRegistryEntry(entry, evaluationTimeMs);
  assert.equal(summary.actorId, "writer-agent");
  assert.equal(summary.activeCredentialCount, 1);
  assert.equal(summary.futureCredentialCount, 1);
  assert.equal(summary.expiredCredentialCount, 0);
});

test("actor token inspector recognizes issued tokens against registry constraints", () => {
  const asOf = "2026-01-01T12:30:00Z";
  const registry = registryPolicy.buildActorRegistry([
    {
      actorId: "retrieval-agent",
      actorRole: "retrieval",
      source: "mcp",
      allowedTransports: ["mcp"],
      allowedCommands: ["search_context"]
    }
  ]);
  const token = orchestration.issueActorAccessToken(
    {
      actorId: "retrieval-agent",
      actorRole: "retrieval",
      source: "mcp",
      allowedTransports: ["mcp"],
      allowedCommands: ["search_context"],
      validFrom: "2026-01-01T12:00:00Z",
      validUntil: "2026-01-01T13:00:00Z",
      issuedAt: "2026-01-01T12:00:00Z"
    },
    "issuer-secret"
  );

  const inspection = tokenInspector.inspectActorToken({
    token,
    asOf,
    registry,
    issuerSecret: "issuer-secret",
    issuedTokenRequireRegistryMatch: true,
    revokedIssuedTokenIds: new Set(),
    expectedTransport: "mcp",
    expectedCommand: "search_context"
  });

  assert.equal(inspection.tokenKind, "issued");
  assert.equal(inspection.valid, true);
  assert.equal(inspection.matchedActor?.actorId, "retrieval-agent");
  assert.equal(inspection.authorization?.commandAllowed, true);
});

test("actor authorization facade still enforces administrative permissions", () => {
  const policy = new orchestration.ActorAuthorizationPolicy({
    mode: "enforced",
    registry: [
      {
        actorId: "operator-agent",
        actorRole: "operator",
        source: "mcp",
        authToken: "operator-token",
        allowedAdminActions: ["view_auth_status"]
      }
    ]
  });

  assert.doesNotThrow(() =>
    policy.authorizeAdministrativeAction("view_auth_status", {
      actorId: "operator-agent",
      actorRole: "operator",
      source: "mcp",
      transport: "mcp",
      initiatedAt: "2026-01-01T12:30:00Z",
      authToken: "operator-token"
    })
  );

  assert.throws(
    () =>
      policy.authorizeAdministrativeAction("issue_auth_token", {
        actorId: "operator-agent",
        actorRole: "operator",
        source: "mcp",
        transport: "mcp",
        initiatedAt: "2026-01-01T12:30:00Z",
        authToken: "operator-token"
      }),
    /not allowed to execute administrative action/i
  );
});