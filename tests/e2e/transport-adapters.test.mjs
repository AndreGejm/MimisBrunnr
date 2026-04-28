import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir as fsMkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { CLI_COMMAND_NAMES } from "../../apps/mimir-cli/dist/command-surface.js";

test("mimir-cli exposes shared release metadata through the version command", async () => {
  const result = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    ["version"],
    {
      ...process.env,
      MAB_RELEASE_VERSION: "0.2.0",
      MAB_GIT_TAG: "v0.2.0",
      MAB_GIT_COMMIT: "0123456789abcdef",
      MAB_RELEASE_CHANNEL: "tagged"
    }
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.release.applicationName, "mimir");
  assert.equal(payload.release.version, "0.2.0");
  assert.equal(payload.release.gitTag, "v0.2.0");
  assert.equal(payload.release.gitCommit, "0123456789abcdef");
  assert.equal(payload.release.releaseChannel, "tagged");
});

test("mimir-cli accepts a leading argument separator for root workspace passthrough", async () => {
  const result = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    ["--", "version"],
    {
      ...process.env,
      MAB_RELEASE_VERSION: "0.2.1"
    }
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.release.applicationName, "mimir");
  assert.equal(payload.release.version, "0.2.1");
});

test("mimir-cli prints root help with a successful exit code", async () => {
  const result = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    ["--help"],
    process.env
  );

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /mimir CLI/);
  assert.match(result.stdout, /Commands:/);
  for (const commandName of CLI_COMMAND_NAMES) {
    assert.ok(result.stdout.includes(commandName), `Expected help output to list '${commandName}'.`);
  }
});


test("mimir-cli lists Docker AI tools through the read-only registry", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-cli-ai-tools-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const result = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    ["list-ai-tools", "--json", JSON.stringify({ includeRuntime: true })],
    cliEnvironment(root, {
      MAB_TOOL_REGISTRY_DIR: path.resolve("docker", "tool-registry")
    })
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.tools.map((tool) => tool.id), ["aider", "codesight", "rtk"]);
  const aider = payload.tools.find((tool) => tool.id === "aider");
  assert.equal("environment" in aider, false);
  assert.equal(aider.runtime.compose.service, "aider");
  assert.equal(aider.runtime.container.mimisbrunnrMountAllowed, false);
  assert.equal(payload.warnings.length, 0);
});

test("mimir-cli checks Docker AI tool manifests through the read-only registry", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-cli-check-ai-tools-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const result = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    ["check-ai-tools", "--json", JSON.stringify({ ids: ["rtk"] })],
    cliEnvironment(root, {
      MAB_TOOL_REGISTRY_DIR: path.resolve("docker", "tool-registry")
    })
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.checks.map((check) => check.toolId), ["rtk"]);
  assert.equal(payload.checks[0].status, "valid");
  assert.deepEqual(payload.warnings, []);
});
test("mimir-cli builds Docker AI tool package plans through the read-only registry", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-cli-tools-package-plan-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const result = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    ["tools-package-plan", "--json", JSON.stringify({ ids: ["aider"] })],
    cliEnvironment(root, {
      MAB_TOOL_REGISTRY_DIR: path.resolve("docker", "tool-registry")
    })
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.packageReady, true);
  assert.deepEqual(payload.tools.map((tool) => tool.id), ["aider"]);
  assert.equal(payload.tools[0].composeRun.command, "docker");
  assert.deepEqual(payload.tools[0].composeRun.args.slice(0, 6), [
    "compose",
    "-f",
    "docker/compose.local.yml",
    "-f",
    "docker/compose.tools.yml",
    "--profile"
  ]);
  assert.equal(payload.tools[0].mimisbrunnrMountAllowed, false);
});

test("mimir-cli exposes auth registry status for operators", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-cli-auth-status-"));
  const env = cliEnvironment(root, {
    MAB_AUTH_MODE: "enforced",
    MAB_AUTH_ISSUER_SECRET: "cli-issuer-secret",
    MAB_AUTH_ACTOR_REGISTRY_JSON: JSON.stringify([
      buildCliAdminRegistryEntry(["view_auth_status"], {
        allowedCommands: ["query_history"]
      })
    ])
  });
  const result = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    ["auth-status", "--json", JSON.stringify({ actor: buildCliAdminActor() })],
    env
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.auth.mode, "enforced");
  assert.equal(payload.auth.issuedTokenSupport.enabled, true);
  assert.equal(payload.auth.actorCounts.total, 1);
  assert.equal(payload.issuedTokens.total, 0);

  await rm(root, { recursive: true, force: true });
});

test("mimir-cli rejects unauthenticated auth admin commands when auth is enforced", async (t) => {
  const { issueActorAccessToken } = await import(
    pathToFileURL(
      path.join(process.cwd(), "packages", "infrastructure", "dist", "index.js")
    ).href
  );

  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-cli-auth-admin-"));
  const revocationPath = path.join(root, "config", "revoked-issued-token-ids.json");
  const env = cliEnvironment(root, {
    MAB_AUTH_MODE: "enforced",
    MAB_AUTH_ISSUER_SECRET: "cli-admin-secret",
    MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_PATH: revocationPath,
    MAB_AUTH_ACTOR_REGISTRY_JSON: JSON.stringify([
      buildCliAdminRegistryEntry([
        "view_auth_status",
        "view_issued_tokens",
        "inspect_auth_token",
        "issue_auth_token",
        "revoke_auth_token"
      ])
    ])
  });
  const issuedToken = issueActorAccessToken(
    {
      actorId: "validate-note-http",
      actorRole: "orchestrator",
      source: "mimir-api",
      allowedTransports: ["http"],
      allowedCommands: ["validate_note"],
      validUntil: new Date(Date.now() + 3_600_000).toISOString(),
      issuedAt: new Date().toISOString()
    },
    "cli-admin-secret"
  );

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  for (const scenario of [
    {
      name: "auth-status",
      args: ["auth-status"]
    },
    {
      name: "auth-issued-tokens",
      args: ["auth-issued-tokens", "--json", JSON.stringify({ includeRevoked: true })]
    },
    {
      name: "auth-introspect-token",
      args: [
        "auth-introspect-token",
        "--json",
        JSON.stringify({
          token: issuedToken,
          expectedTransport: "http",
          expectedCommand: "validate_note"
        })
      ]
    },
    {
      name: "issue-auth-token",
      args: [
        "issue-auth-token",
        "--json",
        JSON.stringify({
          actorId: "next-issued-actor",
          actorRole: "operator",
          source: "mimir-cli",
          ttlMinutes: 60
        })
      ]
    },
    {
      name: "revoke-auth-token",
      args: [
        "revoke-auth-token",
        "--json",
        JSON.stringify({
          token: issuedToken,
          reason: "test revocation"
        })
      ]
    }
  ]) {
    const result = await runNodeCommand(
      path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
      scenario.args,
      env
    );

    assert.equal(result.exitCode, 1, `${scenario.name} should fail without operator auth`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "unauthorized");
  }
});

test("mimir-cli lists recorded issued actor tokens through the operator control surface", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-cli-issued-tokens-"));
  const env = cliEnvironment(root, {
    MAB_AUTH_MODE: "enforced",
    MAB_AUTH_ISSUER_SECRET: "cli-issued-secret",
    MAB_AUTH_ISSUED_TOKEN_REQUIRE_REGISTRY_MATCH: "false",
    MAB_AUTH_ACTOR_REGISTRY_JSON: JSON.stringify([
      buildCliAdminRegistryEntry(["issue_auth_token", "view_issued_tokens"])
    ])
  });

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const issueResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "issue-auth-token",
      "--json",
      JSON.stringify({
        actor: buildCliAdminActor(),
        actorId: "cli-issued-actor",
        actorRole: "operator",
        source: "mimir-cli",
        ttlMinutes: 60
      })
    ],
    env
  );

  assert.equal(issueResult.exitCode, 0, issueResult.stderr);

  const listResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "auth-issued-tokens",
      "--json",
      JSON.stringify({
        actor: buildCliAdminActor(),
        includeRevoked: true
      })
    ],
    env
  );

  assert.equal(listResult.exitCode, 0, listResult.stderr);
  const payload = JSON.parse(listResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.summary.total, 1);
  assert.equal(payload.issuedTokens.length, 1);
  assert.equal(payload.issuedTokens[0].actorId, "cli-issued-actor");
  assert.equal(payload.issuedTokens[0].lifecycleStatus, "active");
  assert.equal(payload.issuedTokens[0].issuedByActorId, "operator-cli");
  assert.equal(payload.issuedTokens[0].issuedByActorRole, "operator");
  assert.equal(payload.issuedTokens[0].issuedBySource, "mimir-cli-admin");
  assert.equal(payload.issuedTokens[0].issuedByTransport, "cli");
});

test("mimir-cli enforces centrally managed issuer controls for multi-operator issuance", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-cli-auth-issuers-"));
  const env = cliEnvironment(root, {
    MAB_AUTH_MODE: "enforced",
    MAB_AUTH_ISSUER_SECRET: "cli-issued-secret",
    MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_PATH: path.join(
      root,
      "config",
      "revoked-issued-token-ids.json"
    ),
    MAB_AUTH_ISSUED_TOKEN_REQUIRE_REGISTRY_MATCH: "false",
    MAB_AUTH_ACTOR_REGISTRY_JSON: JSON.stringify([
      buildCliAdminRegistryEntry([
        "issue_auth_token",
        "revoke_auth_token",
        "view_issued_tokens",
        "view_auth_issuers",
        "manage_auth_issuers"
      ]),
      buildCliAdminRegistryEntry(
        [
          "issue_auth_token",
          "revoke_auth_token",
          "view_issued_tokens",
          "view_auth_issuers"
        ],
        {
          actorId: "security-cli",
          source: "mimir-security-admin",
          authTokens: [
            {
              token: "security-operator-token",
              validUntil: new Date(Date.now() + 3_600_000).toISOString()
            }
          ]
        }
      )
    ])
  });
  const securityActor = buildCliAdminActor({
    actorId: "security-cli",
    source: "mimir-security-admin",
    authToken: "security-operator-token"
  });

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const listBeforeResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    ["auth-issuers", "--json", JSON.stringify({ actor: buildCliAdminActor() })],
    env
  );
  assert.equal(listBeforeResult.exitCode, 0, listBeforeResult.stderr);
  const listBeforePayload = JSON.parse(listBeforeResult.stdout);
  assert.equal(listBeforePayload.ok, true);
  assert.equal(listBeforePayload.summary.total, 2);
  assert.equal(
    listBeforePayload.issuers.find((issuer) => issuer.actorId === "security-cli")
      .allowIssueAuthToken,
    true
  );

  const updateResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "set-auth-issuer-state",
      "--json",
      JSON.stringify({
        actor: buildCliAdminActor(),
        actorId: "security-cli",
        enabled: true,
        allowIssueAuthToken: false,
        allowRevokeAuthToken: true,
        reason: "handoff-only revoker"
      })
    ],
    env
  );
  assert.equal(updateResult.exitCode, 0, updateResult.stderr);
  const updatePayload = JSON.parse(updateResult.stdout);
  assert.equal(updatePayload.ok, true);
  assert.equal(updatePayload.issuer.actorId, "security-cli");
  assert.equal(updatePayload.issuer.allowIssueAuthToken, false);
  assert.equal(updatePayload.issuer.allowRevokeAuthToken, true);
  assert.equal(updatePayload.issuer.updatedByActorId, "operator-cli");

  const deniedIssueResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "issue-auth-token",
      "--json",
      JSON.stringify({
        actor: securityActor,
        actorId: "cli-issued-by-security",
        actorRole: "operator",
        source: "mimir-cli",
        ttlMinutes: 60
      })
    ],
    env
  );
  assert.equal(deniedIssueResult.exitCode, 1, deniedIssueResult.stderr);
  const deniedIssuePayload = JSON.parse(deniedIssueResult.stdout);
  assert.equal(deniedIssuePayload.ok, false);
  assert.equal(deniedIssuePayload.error.code, "forbidden");

  const operatorIssueResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "issue-auth-token",
      "--json",
      JSON.stringify({
        actor: buildCliAdminActor(),
        actorId: "cli-issued-for-revoke",
        actorRole: "operator",
        source: "mimir-cli",
        ttlMinutes: 60
      })
    ],
    env
  );
  assert.equal(operatorIssueResult.exitCode, 0, operatorIssueResult.stderr);
  const operatorIssuePayload = JSON.parse(operatorIssueResult.stdout);

  const revokeResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "revoke-auth-token",
      "--json",
      JSON.stringify({
        actor: securityActor,
        token: operatorIssuePayload.issuedToken,
        reason: "revocation still allowed"
      })
    ],
    env
  );
  assert.equal(revokeResult.exitCode, 0, revokeResult.stderr);
  const revokePayload = JSON.parse(revokeResult.stdout);
  assert.equal(revokePayload.ok, true);
});

test("mimir-cli central issuer controls cannot widen registry capabilities", async (t) => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "mimir-cli-auth-issuer-no-widen-")
  );
  const env = cliEnvironment(root, {
    MAB_AUTH_MODE: "enforced",
    MAB_AUTH_ISSUER_SECRET: "cli-issued-secret",
    MAB_AUTH_ACTOR_REGISTRY_JSON: JSON.stringify([
      buildCliAdminRegistryEntry([
        "issue_auth_token",
        "revoke_auth_token",
        "view_auth_issuers",
        "manage_auth_issuers"
      ]),
      buildCliAdminRegistryEntry(
        ["revoke_auth_token", "view_auth_issuers"],
        {
          actorId: "revoker-only-cli",
          source: "mimir-revoker-admin",
          authTokens: [
            {
              token: "revoker-only-token",
              validUntil: new Date(Date.now() + 3_600_000).toISOString()
            }
          ]
        }
      )
    ])
  });

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const listResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    ["auth-issuers", "--json", JSON.stringify({ actor: buildCliAdminActor() })],
    env
  );
  assert.equal(listResult.exitCode, 0, listResult.stderr);
  const listPayload = JSON.parse(listResult.stdout);
  const revokerIssuer = listPayload.issuers.find(
    (issuer) => issuer.actorId === "revoker-only-cli"
  );
  assert.equal(revokerIssuer.allowIssueAuthToken, false);
  assert.equal(revokerIssuer.allowRevokeAuthToken, true);

  const widenResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "set-auth-issuer-state",
      "--json",
      JSON.stringify({
        actor: buildCliAdminActor(),
        actorId: "revoker-only-cli",
        enabled: true,
        allowIssueAuthToken: true,
        allowRevokeAuthToken: true,
        reason: "attempt unauthorized widening"
      })
    ],
    env
  );
  assert.equal(widenResult.exitCode, 1, widenResult.stderr);
  const widenPayload = JSON.parse(widenResult.stdout);
  assert.equal(widenPayload.ok, false);
  assert.equal(widenPayload.error.code, "validation_failed");
  assert.match(widenPayload.error.message, /registry does not allow/i);
});

test("mimir-cli filters issued token listings by issuer and lifecycle state", async (t) => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "mimir-cli-issued-tokens-filtered-")
  );
  const securityAdmin = buildCliAdminActor({
    actorId: "security-cli",
    source: "mimir-security-admin",
    authToken: "security-operator-token"
  });
  const env = cliEnvironment(root, {
    MAB_AUTH_MODE: "enforced",
    MAB_AUTH_ISSUER_SECRET: "cli-issued-secret",
    MAB_AUTH_ACTOR_REGISTRY_JSON: JSON.stringify([
      buildCliAdminRegistryEntry([
        "issue_auth_token",
        "view_issued_tokens"
      ]),
      buildCliAdminRegistryEntry(
        ["issue_auth_token", "view_issued_tokens"],
        {
          actorId: "security-cli",
          source: "mimir-security-admin",
          authTokens: [
            {
              token: "security-operator-token",
              validUntil: new Date(Date.now() + 3_600_000).toISOString()
            }
          ]
        }
      ),
      {
        actorId: "cli-active-actor",
        actorRole: "operator",
        source: "mimir-cli",
        allowedTransports: ["cli"]
      },
      {
        actorId: "cli-future-actor",
        actorRole: "operator",
        source: "mimir-cli",
        allowedTransports: ["cli"]
      }
    ])
  });

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const activeIssueResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "issue-auth-token",
      "--json",
      JSON.stringify({
        actor: buildCliAdminActor(),
        actorId: "cli-active-actor",
        actorRole: "operator",
        source: "mimir-cli",
        ttlMinutes: 60
      })
    ],
    env
  );

  assert.equal(activeIssueResult.exitCode, 0, activeIssueResult.stderr);

  const revokedIssueResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "issue-auth-token",
      "--json",
      JSON.stringify({
        actor: securityAdmin,
        actorId: "cli-future-actor",
        actorRole: "operator",
        source: "mimir-cli",
        validFrom: addDaysIso(currentDateIso(), 1),
        validUntil: addDaysIso(currentDateIso(), 2)
      })
    ],
    env
  );

  assert.equal(revokedIssueResult.exitCode, 0, revokedIssueResult.stderr);

  const activeListResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "auth-issued-tokens",
      "--json",
      JSON.stringify({
        actor: buildCliAdminActor(),
        includeRevoked: true,
        issuedByActorId: "operator-cli",
        lifecycleStatus: "active"
      })
    ],
    env
  );

  assert.equal(activeListResult.exitCode, 0, activeListResult.stderr);
  const activeListPayload = JSON.parse(activeListResult.stdout);
  assert.equal(activeListPayload.ok, true);
  assert.deepEqual(
    activeListPayload.issuedTokens.map((record) => record.actorId),
    ["cli-active-actor"]
  );

  const futureListResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "auth-issued-tokens",
      "--json",
      JSON.stringify({
        actor: buildCliAdminActor(),
        includeRevoked: true,
        issuedByActorId: "security-cli",
        lifecycleStatus: "future"
      })
    ],
    env
  );

  assert.equal(futureListResult.exitCode, 0, futureListResult.stderr);
  const futureListPayload = JSON.parse(futureListResult.stdout);
  assert.equal(futureListPayload.ok, true);
  assert.deepEqual(
    futureListPayload.issuedTokens.map((record) => record.actorId),
    ["cli-future-actor"]
  );
  assert.equal(futureListPayload.issuedTokens[0].issuedByActorId, "security-cli");
  assert.equal(futureListPayload.issuedTokens[0].lifecycleStatus, "future");
});

test("mimir-cli bulk revokes issued tokens with dry-run preview and bounded filters", async (t) => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "mimir-cli-bulk-revoke-issued-tokens-")
  );
  const securityAdmin = buildCliAdminActor({
    actorId: "security-cli",
    source: "mimir-security-admin",
    authToken: "security-operator-token"
  });
  const env = cliEnvironment(root, {
    MAB_AUTH_MODE: "enforced",
    MAB_AUTH_ISSUER_SECRET: "cli-issued-secret",
    MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_PATH: path.join(
      root,
      "config",
      "revoked-issued-token-ids.json"
    ),
    MAB_AUTH_ACTOR_REGISTRY_JSON: JSON.stringify([
      buildCliAdminRegistryEntry(
        ["issue_auth_token", "revoke_auth_tokens", "view_issued_tokens"],
        {
          actorId: "operator-cli",
          source: "mimir-cli-admin"
        }
      ),
      buildCliAdminRegistryEntry(
        ["issue_auth_token", "revoke_auth_tokens", "view_issued_tokens"],
        {
          actorId: "security-cli",
          source: "mimir-security-admin",
          authTokens: [
            {
              token: "security-operator-token",
              validUntil: new Date(Date.now() + 3_600_000).toISOString()
            }
          ]
        }
      ),
      {
        actorId: "cli-active-actor",
        actorRole: "operator",
        source: "mimir-cli",
        allowedTransports: ["cli"]
      },
      {
        actorId: "cli-future-actor-a",
        actorRole: "operator",
        source: "mimir-cli",
        allowedTransports: ["cli"]
      },
      {
        actorId: "cli-future-actor-b",
        actorRole: "operator",
        source: "mimir-cli",
        allowedTransports: ["cli"]
      }
    ])
  });

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  for (const payload of [
    {
      actor: buildCliAdminActor(),
      actorId: "cli-active-actor",
      actorRole: "operator",
      source: "mimir-cli",
      ttlMinutes: 60
    },
    {
      actor: securityAdmin,
      actorId: "cli-future-actor-a",
      actorRole: "operator",
      source: "mimir-cli",
      validFrom: addDaysIso(currentDateIso(), 1),
      validUntil: addDaysIso(currentDateIso(), 2)
    },
    {
      actor: securityAdmin,
      actorId: "cli-future-actor-b",
      actorRole: "operator",
      source: "mimir-cli",
      validFrom: addDaysIso(currentDateIso(), 1),
      validUntil: addDaysIso(currentDateIso(), 2)
    }
  ]) {
    const issueResult = await runNodeCommand(
      path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
      ["issue-auth-token", "--json", JSON.stringify(payload)],
      env
    );
    assert.equal(issueResult.exitCode, 0, issueResult.stderr);
  }

  const previewResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "revoke-auth-tokens",
      "--json",
      JSON.stringify({
        actor: buildCliAdminActor(),
        issuedByActorId: "security-cli",
        lifecycleStatus: "future",
        dryRun: true,
        reason: "rotation preview"
      })
    ],
    env
  );

  assert.equal(previewResult.exitCode, 0, previewResult.stderr);
  const previewPayload = JSON.parse(previewResult.stdout);
  assert.equal(previewPayload.ok, true);
  assert.equal(previewPayload.dryRun, true);
  assert.equal(previewPayload.matchedCount, 2);
  assert.equal(previewPayload.revokedCount, 0);
  assert.deepEqual(
    previewPayload.candidates.map((record) => record.actorId).sort(),
    ["cli-future-actor-a", "cli-future-actor-b"]
  );

  const revokeResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "revoke-auth-tokens",
      "--json",
      JSON.stringify({
        actor: securityAdmin,
        issuedByActorId: "security-cli",
        lifecycleStatus: "future",
        reason: "security rotation"
      })
    ],
    env
  );

  assert.equal(revokeResult.exitCode, 0, revokeResult.stderr);
  const revokePayload = JSON.parse(revokeResult.stdout);
  assert.equal(revokePayload.ok, true);
  assert.equal(revokePayload.dryRun, false);
  assert.equal(revokePayload.matchedCount, 2);
  assert.equal(revokePayload.revokedCount, 2);
  assert.equal(revokePayload.alreadyRevokedCount, 0);

  const revokedListResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "auth-issued-tokens",
      "--json",
      JSON.stringify({
        actor: buildCliAdminActor(),
        includeRevoked: true,
        issuedByActorId: "security-cli",
        revokedByActorId: "security-cli",
        lifecycleStatus: "revoked"
      })
    ],
    env
  );

  assert.equal(revokedListResult.exitCode, 0, revokedListResult.stderr);
  const revokedListPayload = JSON.parse(revokedListResult.stdout);
  assert.equal(revokedListPayload.ok, true);
  assert.deepEqual(
    revokedListPayload.issuedTokens.map((record) => record.actorId).sort(),
    ["cli-future-actor-a", "cli-future-actor-b"]
  );
  assert.equal(revokedListPayload.issuedTokens[0].revokedByActorId, "security-cli");
  assert.equal(
    revokedListPayload.issuedTokens[0].revokedReason,
    "security rotation"
  );
});

test("mimir-cli can introspect issued actor tokens against the current auth policy", async (t) => {
  const { issueActorAccessToken } = await import(
    pathToFileURL(
      path.join(process.cwd(), "packages", "infrastructure", "dist", "index.js")
    ).href
  );
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-cli-introspect-token-"));
  const env = cliEnvironment(root, {
    MAB_AUTH_MODE: "enforced",
    MAB_AUTH_ISSUER_SECRET: "cli-issuer-secret",
    MAB_AUTH_ACTOR_REGISTRY_JSON: JSON.stringify([
      buildCliAdminRegistryEntry(["inspect_auth_token"]),
      {
        actorId: "validate-note-http",
        actorRole: "orchestrator",
        source: "mimir-api",
        allowedTransports: ["http"],
        allowedCommands: ["validate_note"]
      }
    ])
  });

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const issuedToken = issueActorAccessToken(
    {
      actorId: "validate-note-http",
      actorRole: "orchestrator",
      source: "mimir-api",
      allowedTransports: ["http"],
      allowedCommands: ["validate_note"],
      validUntil: new Date(Date.now() + 3_600_000).toISOString(),
      issuedAt: new Date().toISOString()
    },
    "cli-issuer-secret"
  );

  const result = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "auth-introspect-token",
      "--json",
      JSON.stringify({
        actor: buildCliAdminActor(),
        token: issuedToken,
        expectedTransport: "http",
        expectedCommand: "validate_note"
      })
    ],
    env
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.inspection.tokenKind, "issued");
  assert.equal(payload.inspection.valid, true);
  assert.equal(payload.inspection.authorization.transportAllowed, true);
  assert.equal(payload.inspection.authorization.commandAllowed, true);
  assert.equal(payload.inspection.matchedActor.actorId, "validate-note-http");
});

test("mimir-cli lists and reads namespace nodes through the shared context namespace service", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-cli-namespace-"));
  const canonical = await seedCanonicalTemporalNote(root, {
    title: "CLI Namespace Canonical Node",
    scope: "cli-namespace",
    validFrom: addDaysIso(currentDateIso(), -14),
    validUntil: addDaysIso(currentDateIso(), 14)
  });
  const staging = await seedStagingDraft(root, {
    title: "CLI Namespace Staging Node",
    scope: "cli-namespace"
  });

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const listResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "list-context-tree",
      "--json",
      JSON.stringify({
        ownerScope: "mimisbrunnr",
        authorityStates: ["canonical", "staging"]
      })
    ],
    cliEnvironment(root)
  );

  assert.equal(listResult.exitCode, 0, listResult.stderr);
  const listPayload = JSON.parse(listResult.stdout);
  assert.equal(listPayload.ok, true);
  assert.ok(
    listPayload.data.nodes.some(
      (node) =>
        node.uri === `mimir://mimisbrunnr/note/${canonical.noteId}` &&
        node.authorityState === "canonical"
    )
  );
  assert.ok(
    listPayload.data.nodes.some(
      (node) =>
        node.uri === `mimir://mimisbrunnr/note/${staging.draftNoteId}` &&
        node.authorityState === "staging"
    )
  );

  const readResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "read-context-node",
      "--json",
      JSON.stringify({
        uri: `mimir://mimisbrunnr/note/${canonical.noteId}`
      })
    ],
    cliEnvironment(root)
  );

  assert.equal(readResult.exitCode, 0, readResult.stderr);
  const readPayload = JSON.parse(readResult.stdout);
  assert.equal(readPayload.ok, true);
  assert.equal(readPayload.data.node.uri, `mimir://mimisbrunnr/note/${canonical.noteId}`);
  assert.equal(readPayload.data.node.authorityState, "canonical");
  assert.equal(readPayload.data.node.sourceType, "canonical_note");
  assert.equal(readPayload.data.node.ownerScope, "mimisbrunnr");
});

test("mimir-cli exposes temporal freshness status and refresh candidates for operators", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-cli-freshness-"));
  const sqlitePath = path.join(root, "state", "mimisbrunnr.sqlite");
  await seedTemporalValidityNote(sqlitePath, {
    noteId: "expired-cli-freshness-note",
    notePath: "mimisbrunnr/reference/expired-cli-freshness-note.md",
    validFrom: "2026-03-01",
    validUntil: addDaysIso(currentDateIso(), -1),
    summary: "CLI freshness status should show expired refresh candidates."
  });
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const result = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    ["freshness-status", "--json", JSON.stringify({ corpusId: "mimir_brunnr" })],
    cliEnvironment(root)
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.freshness.expiredCurrentStateNotes, 1);
  assert.equal(payload.freshness.expiredCurrentState[0].noteId, "expired-cli-freshness-note");
  assert.equal(payload.freshness.expiredCurrentState[0].state, "expired");
});

test("mimir-cli creates governed refresh drafts for expired current-state notes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-cli-refresh-draft-"));
  const seeded = await seedCanonicalTemporalNote(root, {
    title: "CLI Refresh Workflow",
    scope: "cli-refresh-workflow",
    validFrom: addDaysIso(currentDateIso(), -14),
    validUntil: addDaysIso(currentDateIso(), -1)
  });
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const result = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "create-refresh-draft",
      "--json",
      JSON.stringify({
        noteId: seeded.noteId,
        bodyHints: ["Refresh the expired CLI guidance."]
      })
    ],
    cliEnvironment(root)
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.sourceNoteId, seeded.noteId);
  assert.equal(payload.data.sourceState, "expired");
  assert.deepEqual(payload.data.frontmatter.supersedes, [seeded.noteId]);
});

test("mimir-cli creates a bounded batch of refresh drafts from current freshness candidates", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-cli-refresh-drafts-"));
  await seedCanonicalTemporalNotes(root, [
    {
      title: "CLI Batch Refresh A",
      scope: "cli-batch-refresh-a",
      validFrom: addDaysIso(currentDateIso(), -14),
      validUntil: addDaysIso(currentDateIso(), -1)
    },
    {
      title: "CLI Batch Refresh B",
      scope: "cli-batch-refresh-b",
      validFrom: addDaysIso(currentDateIso(), -10),
      validUntil: addDaysIso(currentDateIso(), -1)
    },
    {
      title: "CLI Batch Refresh C",
      scope: "cli-batch-refresh-c",
      validFrom: addDaysIso(currentDateIso(), -5),
      validUntil: addDaysIso(currentDateIso(), 2)
    }
  ]);

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const result = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "create-refresh-drafts",
      "--json",
      JSON.stringify({
        expiringWithinDays: 14,
        maxDrafts: 2,
        bodyHints: ["Refresh these stale notes in batch."]
      })
    ],
    cliEnvironment(root)
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.createdCount, 2);
  assert.equal(payload.data.drafts.length, 2);
  assert.equal(payload.data.candidatesRemaining, 1);
  assert.ok(
    payload.data.skipped.some((item) => /maxDrafts limit/i.test(item.reason))
  );
});

test("mimir-cli can mint issued actor access tokens when the issuer secret is configured", async () => {
  const result = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "issue-auth-token",
      "--json",
      JSON.stringify({
        actorId: "validate-note-http",
        actorRole: "orchestrator",
        source: "mimir-api",
        allowedTransports: ["http"],
        allowedCommands: ["validate_note"],
        ttlMinutes: 60
      })
    ],
    {
      ...process.env,
      MAB_AUTH_ISSUER_SECRET: "cli-issuer-secret"
    }
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.match(payload.issuedToken, /^mab1\./);
  assert.equal(payload.claims.actorId, "validate-note-http");
});

test("mimir-cli can revoke issued actor tokens through the file-backed revocation store", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-cli-revoke-token-"));
  const revocationPath = path.join(root, "config", "revoked-issued-token-ids.json");
  const authEnv = cliEnvironment(root, {
    MAB_AUTH_MODE: "enforced",
    MAB_AUTH_ISSUER_SECRET: "cli-issuer-secret",
    MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_PATH: revocationPath,
    MAB_AUTH_ACTOR_REGISTRY_JSON: JSON.stringify([
      buildCliAdminRegistryEntry([
        "issue_auth_token",
        "revoke_auth_token",
        "inspect_auth_token",
        "view_issued_tokens"
      ], {
        allowedCommands: ["query_history"]
      })
    ])
  });

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const issueResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "issue-auth-token",
      "--json",
      JSON.stringify({
        actor: buildCliAdminActor(),
        actorId: "validate-note-http",
        actorRole: "orchestrator",
        source: "mimir-api",
        allowedTransports: ["http"],
        allowedCommands: ["validate_note"],
        ttlMinutes: 60
      })
    ],
    authEnv
  );

  assert.equal(issueResult.exitCode, 0, issueResult.stderr);
  const issuePayload = JSON.parse(issueResult.stdout);
  assert.equal(issuePayload.ok, true);
  const issuedToken = issuePayload.issuedToken;

  const revokeResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "revoke-auth-token",
      "--json",
      JSON.stringify({
        actor: buildCliAdminActor(),
        token: issuedToken,
        reason: "test revocation"
      })
    ],
    authEnv
  );

  assert.equal(revokeResult.exitCode, 0, revokeResult.stderr);
  const revokePayload = JSON.parse(revokeResult.stdout);
  assert.equal(revokePayload.ok, true);
  assert.equal(typeof revokePayload.revokedTokenId, "string");
  assert.equal(revokePayload.persisted, true);

  const issuedTokensResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "auth-issued-tokens",
      "--json",
      JSON.stringify({
        actor: buildCliAdminActor(),
        includeRevoked: true
      })
    ],
    authEnv
  );

  assert.equal(issuedTokensResult.exitCode, 0, issuedTokensResult.stderr);
  const issuedTokensPayload = JSON.parse(issuedTokensResult.stdout);
  assert.equal(issuedTokensPayload.ok, true);
  assert.equal(issuedTokensPayload.summary.total, 1);
  assert.equal(issuedTokensPayload.issuedTokens.length, 1);
  assert.equal(issuedTokensPayload.issuedTokens[0].lifecycleStatus, "revoked");
  assert.equal(issuedTokensPayload.issuedTokens[0].revokedReason, "test revocation");
  assert.equal(issuedTokensPayload.issuedTokens[0].revokedByActorId, "operator-cli");
  assert.equal(issuedTokensPayload.issuedTokens[0].revokedByActorRole, "operator");
  assert.equal(issuedTokensPayload.issuedTokens[0].revokedBySource, "mimir-cli-admin");
  assert.equal(issuedTokensPayload.issuedTokens[0].revokedByTransport, "cli");

  const historyResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "query-history",
      "--json",
      JSON.stringify({
        actor: buildCliAdminActor(),
        actorId: "operator-cli",
        actionType: "issue_auth_token",
        limit: 20
      })
    ],
    authEnv
  );

  assert.equal(historyResult.exitCode, 0, historyResult.stderr);
  const historyPayload = JSON.parse(historyResult.stdout);
  assert.equal(historyPayload.ok, true);
  assert.equal(historyPayload.data.entries.length, 1);
  const issueAudit = historyPayload.data.entries[0];
  assert.equal(issueAudit.actorId, "operator-cli");
  assert.equal(issueAudit.actionType, "issue_auth_token");
  assert.equal(issueAudit.detail.tokenId, revokePayload.revokedTokenId);
  assert.equal(issueAudit.detail.targetActorId, "validate-note-http");
  assert.equal(issueAudit.detail.targetActorRole, "orchestrator");
  assert.equal(issueAudit.detail.targetSource, "mimir-api");
  assert.equal(issueAudit.detail.transport, "cli");
  assert.equal(issueAudit.detail.command, "issue-auth-token");
  assert.equal(issueAudit.detail.hasAllowedCommands, true);
  assert.equal(issueAudit.detail.hasAllowedAdminActions, false);
  assert.equal(issueAudit.detail.hasAllowedCorpora, false);

  const revokeHistoryResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "query-history",
      "--json",
      JSON.stringify({
        actor: buildCliAdminActor(),
        actorId: "operator-cli",
        actionType: "revoke_auth_token",
        limit: 20
      })
    ],
    authEnv
  );

  assert.equal(revokeHistoryResult.exitCode, 0, revokeHistoryResult.stderr);
  const revokeHistoryPayload = JSON.parse(revokeHistoryResult.stdout);
  assert.equal(revokeHistoryPayload.ok, true);
  assert.equal(revokeHistoryPayload.data.entries.length, 1);
  const revokeAudit = revokeHistoryPayload.data.entries[0];
  assert.equal(revokeAudit.actorId, "operator-cli");
  assert.equal(revokeAudit.actionType, "revoke_auth_token");
  assert.equal(revokeAudit.detail.tokenId, revokePayload.revokedTokenId);
  assert.equal(revokeAudit.detail.reason, "test revocation");
  assert.equal(revokeAudit.detail.transport, "cli");
  assert.equal(revokeAudit.detail.command, "revoke-auth-token");
  assert.equal(revokeAudit.detail.recordedTokenFound, true);
  assert.equal(revokeAudit.detail.alreadyRevoked, false);

  const introspectResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    [
      "auth-introspect-token",
      "--json",
      JSON.stringify({
        actor: buildCliAdminActor(),
        token: issuedToken,
        expectedTransport: "http",
        expectedCommand: "validate_note"
      })
    ],
    authEnv
  );

  assert.equal(introspectResult.exitCode, 0, introspectResult.stderr);
  const introspectPayload = JSON.parse(introspectResult.stdout);
  assert.equal(introspectPayload.ok, true);
  assert.equal(introspectPayload.inspection.tokenKind, "issued");
  assert.equal(introspectPayload.inspection.valid, false);
  assert.equal(introspectPayload.inspection.reason, "revoked_issued_token");
});

test("mimir-cli drafts notes through the staging service with JSON input", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-cli-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const requestPath = path.join(root, "draft-note.json");
  await writeFile(
    requestPath,
    JSON.stringify({
      targetCorpus: "mimisbrunnr",
      noteType: "decision",
      title: "CLI Draft Policy",
      sourcePrompt: "Draft a CLI policy note.",
      supportingSources: [],
      bodyHints: ["CLI transport should remain thin."]
    }),
    "utf8"
  );

  const result = await runNodeCommand(
    path.join(
      process.cwd(),
      "apps",
      "mimir-cli",
      "dist",
      "main.js"
    ),
    ["draft-note", "--input", requestPath],
    cliEnvironment(root)
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.frontmatter.corpusId, "mimisbrunnr");
  assert.match(payload.data.draftPath, /^mimisbrunnr\//);
});

test("mimir-cli review queue commands list read and reject staged drafts", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-cli-review-queue-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const draftRequestPath = path.join(root, "review-draft.json");
  await writeFile(
    draftRequestPath,
    JSON.stringify({
      targetCorpus: "general_notes",
      noteType: "decision",
      title: "CLI Review Queue Draft",
      sourcePrompt: "Create a draft for thin review frontend coverage.",
      supportingSources: [],
      bodyHints: ["Review queue commands should stay wired through the shared transport stack."]
    }),
    "utf8"
  );

  const draftResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    ["draft-note", "--input", draftRequestPath],
    cliEnvironment(root)
  );

  assert.equal(draftResult.exitCode, 0, draftResult.stderr);
  const draftPayload = JSON.parse(draftResult.stdout);
  assert.equal(draftPayload.ok, true);
  const draftNoteId = draftPayload.data.draftNoteId;

  const listResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    ["list-review-queue"],
    cliEnvironment(root)
  );

  assert.equal(listResult.exitCode, 0, listResult.stderr);
  const listPayload = JSON.parse(listResult.stdout);
  const queueItem = listPayload.data.items.find((item) => item.draftNoteId === draftNoteId);
  assert.equal(queueItem?.title, "CLI Review Queue Draft");
  assert.equal(queueItem?.reviewState, "unreviewed");

  const readRequestPath = path.join(root, "read-review-note.json");
  await writeFile(readRequestPath, JSON.stringify({ draftNoteId }), "utf8");

  const readResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    ["read-review-note", "--input", readRequestPath],
    cliEnvironment(root)
  );

  assert.equal(readResult.exitCode, 0, readResult.stderr);
  const readPayload = JSON.parse(readResult.stdout);
  assert.equal(readPayload.ok, true);
  assert.equal(readPayload.data.draftNoteId, draftNoteId);
  assert.match(readPayload.data.body, /## Context/);

  const rejectRequestPath = path.join(root, "reject-review-note.json");
  await writeFile(
    rejectRequestPath,
    JSON.stringify({
      draftNoteId,
      reviewNotes: "Rejected in CLI review regression coverage."
    }),
    "utf8"
  );

  const rejectResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    ["reject-note", "--input", rejectRequestPath],
    cliEnvironment(root)
  );

  assert.equal(rejectResult.exitCode, 0, rejectResult.stderr);
  const rejectPayload = JSON.parse(rejectResult.stdout);
  assert.equal(rejectPayload.ok, true);
  assert.equal(rejectPayload.data.rejected, true);
  assert.equal(rejectPayload.data.finalReviewState, "rejected");
  assert.match(rejectPayload.data.draftPath, /^general_notes\//);

  const readRejectedResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    ["read-review-note", "--input", readRequestPath],
    cliEnvironment(root)
  );

  assert.equal(readRejectedResult.exitCode, 0, readRejectedResult.stderr);
  const readRejectedPayload = JSON.parse(readRejectedResult.stdout);
  assert.equal(readRejectedPayload.ok, true);
  assert.equal(readRejectedPayload.data.reviewState, "rejected");
  assert.equal(readRejectedPayload.data.promotionEligible, false);

  const hiddenRejectedResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    ["list-review-queue"],
    cliEnvironment(root)
  );

  assert.equal(hiddenRejectedResult.exitCode, 0, hiddenRejectedResult.stderr);
  const hiddenRejectedPayload = JSON.parse(hiddenRejectedResult.stdout);
  assert.equal(
    hiddenRejectedPayload.data.items.some((item) => item.draftNoteId === draftNoteId),
    false
  );

  const includeRejectedResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    ["list-review-queue", "--json", JSON.stringify({ includeRejected: true })],
    cliEnvironment(root)
  );

  assert.equal(includeRejectedResult.exitCode, 0, includeRejectedResult.stderr);
  const includeRejectedPayload = JSON.parse(includeRejectedResult.stdout);
  const rejectedItem = includeRejectedPayload.data.items.find((item) => item.draftNoteId === draftNoteId);
  assert.equal(rejectedItem?.reviewState, "rejected");
});

test("mimir-cli accept-note promotes a staged draft through the review surface", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-cli-accept-note-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const draftRequestPath = path.join(root, "accept-draft.json");
  await writeFile(
    draftRequestPath,
    JSON.stringify({
      targetCorpus: "general_notes",
      noteType: "decision",
      title: "CLI Accept Draft",
      sourcePrompt: "Create a draft that will be promoted through accept-note.",
      supportingSources: [],
      bodyHints: ["Accept note should promote staged drafts through the shared review flow."]
    }),
    "utf8"
  );

  const draftResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    ["draft-note", "--input", draftRequestPath],
    cliEnvironment(root)
  );

  assert.equal(draftResult.exitCode, 0, draftResult.stderr);
  const draftPayload = JSON.parse(draftResult.stdout);
  assert.equal(draftPayload.ok, true);
  const draftNoteId = draftPayload.data.draftNoteId;

  const acceptRequestPath = path.join(root, "accept-note.json");
  await writeFile(acceptRequestPath, JSON.stringify({ draftNoteId }), "utf8");

  const acceptResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    ["accept-note", "--input", acceptRequestPath],
    cliEnvironment(root)
  );

  assert.equal(acceptResult.exitCode, 0, acceptResult.stderr);
  const acceptPayload = JSON.parse(acceptResult.stdout);
  assert.equal(acceptPayload.ok, true);
  assert.equal(acceptPayload.data.accepted, true);
  assert.equal(acceptPayload.data.finalReviewState, "promotion_ready");
  assert.match(acceptPayload.data.canonicalPath, /^general_notes\//);
  assert.equal(typeof acceptPayload.data.promotedNoteId, "string");

  const readAcceptedRequestPath = path.join(root, "accept-read-note.json");
  await writeFile(readAcceptedRequestPath, JSON.stringify({ draftNoteId }), "utf8");

  const readAcceptedResult = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    ["read-review-note", "--input", readAcceptedRequestPath],
    cliEnvironment(root)
  );

  assert.equal(readAcceptedResult.exitCode, 0, readAcceptedResult.stderr);
  const readAcceptedPayload = JSON.parse(readAcceptedResult.stdout);
  assert.equal(readAcceptedPayload.ok, true);
  assert.equal(readAcceptedPayload.data.reviewState, "promoted");
  assert.equal(readAcceptedPayload.data.promotionEligible, false);

  const promotedDraftMarkdown = await readFile(
    path.join(root, "vault", "staging", draftPayload.data.draftPath),
    "utf8"
  );
  assert.match(promotedDraftMarkdown, /status:\s*"promoted"/);
  assert.match(promotedDraftMarkdown, /status\/promoted/);
  assert.doesNotMatch(promotedDraftMarkdown, /status\/draft/);
});

test("mimir-api exposes thin review routes for queue, read, and accept", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-api-review-"));
  const seeded = await seedStagingDraft(root, {
    title: "API Review Draft",
    scope: "api-review"
  });
  const { createMimirApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")
    ).href
  );
  const api = createMimirApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "mimisbrunnr.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 0,
    logLevel: "error"
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();

  const listResponse = await fetch(`${apiBaseUrl(api)}/v1/review/queue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });

  assert.equal(listResponse.status, 200);
  const listPayload = await listResponse.json();
  const queueItem = listPayload.data.items.find((item) => item.draftNoteId === seeded.draftNoteId);
  assert.equal(queueItem?.title, "API Review Draft");
  assert.equal(queueItem?.reviewState, "unreviewed");

  const readResponse = await fetch(`${apiBaseUrl(api)}/v1/review/note`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ draftNoteId: seeded.draftNoteId })
  });

  assert.equal(readResponse.status, 200);
  const readPayload = await readResponse.json();
  assert.equal(readPayload.data.draftNoteId, seeded.draftNoteId);
  assert.match(readPayload.data.body, /## (Context|Summary)/);

  const acceptResponse = await fetch(`${apiBaseUrl(api)}/v1/review/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ draftNoteId: seeded.draftNoteId })
  });

  assert.equal(acceptResponse.status, 200);
  const acceptPayload = await acceptResponse.json();
  assert.equal(acceptPayload.ok, true);
  assert.equal(acceptPayload.data.accepted, true);
  assert.equal(acceptPayload.data.finalReviewState, "promotion_ready");
  assert.match(acceptPayload.data.canonicalPath, /^mimisbrunnr\//);
  assert.equal(typeof acceptPayload.data.promotedNoteId, "string");
});
test("mimir-cli exposes direct context-packet assembly as a thin transport command", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-cli-packet-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const requestPath = path.join(root, "context-packet.json");
  await writeFile(
    requestPath,
    JSON.stringify({
      intent: "architecture_recall",
      budget: {
        maxTokens: 320,
        maxSources: 2,
        maxRawExcerpts: 1,
        maxSummarySentences: 2
      },
      includeRawExcerpts: true,
      candidates: [
        {
          noteType: "architecture",
          score: 0.84,
          summary: "Architecture context for bounded retrieval packets.",
          rawText: "Architecture context for bounded retrieval packets with provenance attached.",
          scope: "architecture",
          qualifiers: ["bounded retrieval"],
          tags: ["project/mimir"],
          stalenessClass: "current",
          provenance: {
            noteId: "note-1",
            notePath: "mimisbrunnr/architecture/retrieval.md",
            headingPath: ["Summary"]
          }
        }
      ]
    }),
    "utf8"
  );

  const result = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    ["get-context-packet", "--input", requestPath],
    cliEnvironment(root)
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.packet.packetType, "implementation");
  assert.equal(payload.packet.answerability, "local_answer");
  assert.equal(payload.packet.evidence[0].noteId, "note-1");
});

test("mimir-cli rejects malformed request payloads at ingress", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-cli-invalid-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const requestPath = path.join(root, "invalid-context-packet.json");
  await writeFile(
    requestPath,
    JSON.stringify({
      intent: "architecture_recall",
      budget: {
        maxTokens: "320",
        maxSources: 2,
        maxRawExcerpts: 1,
        maxSummarySentences: 2
      },
      includeRawExcerpts: true,
      candidates: []
    }),
    "utf8"
  );

  const result = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    ["get-context-packet", "--input", requestPath],
    cliEnvironment(root)
  );

  assert.equal(result.exitCode, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "validation_failed");
});

test("mimir-cli executes coding tasks through the vendored runtime bridge", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-cli-coding-"));
  const repoRoot = path.join(root, "repo");
  await fsMkdir(path.join(repoRoot, ".git"), { recursive: true });
  await fsMkdir(path.join(repoRoot, "src"), { recursive: true });
  await writeFile(
    path.join(repoRoot, "src", "foo.py"),
    'def greet(name: str) -> str:\n    return f"Hello, {name}"\n',
    "utf8"
  );
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const requestPath = path.join(root, "coding-task.json");
  await writeFile(
    requestPath,
    JSON.stringify({
      taskType: "propose_fix",
      task: "Fix the writer promotion bug.",
      context: "The bug affects writer promotion.",
      filePath: "src/foo.py"
    }),
    "utf8"
  );

  const result = await runNodeCommand(
    path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js"),
    ["execute-coding-task", "--input", requestPath],
    cliEnvironment(root, {
      MAB_PROVIDER_DOCKER_OLLAMA_BASE_URL: "http://127.0.0.1:1",
      MAB_OLLAMA_BASE_URL: "http://127.0.0.1:1"
    }),
    repoRoot
  );

  assert.equal(result.exitCode, 1, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "fail");
  assert.doesNotMatch(payload.reason, /allowed_patch_root|LOCAL_EXPERT_REPO_ROOT/i);
});

test("mimir-api exposes validation as a thin HTTP transport over services", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-api-"));
  const { createMimirApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")
    ).href
  );

  const api = createMimirApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "mimisbrunnr.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 0,
    logLevel: "error"
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();
  const baseUrl = apiBaseUrl(api);

  const liveResponse = await fetch(`${baseUrl}/health/live`);
  assert.equal(liveResponse.status, 200);
  const livePayload = await liveResponse.json();
  assert.equal(livePayload.mode, "live");
  assert.ok(["pass", "degraded"].includes(livePayload.status));
  assert.equal(typeof livePayload.release.version, "string");

  const noteId = randomUUID();
  const response = await fetch(`${baseUrl}/v1/notes/validate`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      targetCorpus: "mimisbrunnr",
      notePath: "mimisbrunnr/decision/invalid-http-note.md",
      validationMode: "promotion",
      frontmatter: {
        noteId,
        title: "Invalid HTTP Decision",
        project: "mimir",
        type: "decision",
        status: "promoted",
        updated: currentDateIso(),
        summary: "Missing required sections.",
        tags: ["project/mimir", "domain/orchestration", "status/promoted"],
        scope: "validation",
        corpusId: "mimisbrunnr",
        currentState: false
      },
      body: "## Context\n\nOnly one section exists."
    })
  });

  assert.equal(response.status, 422);
  const payload = await response.json();
  assert.equal(payload.valid, false);
  assert.ok(payload.violations.some((issue) => issue.field === "body.sections"));
});

test("mimir-api exposes shared release metadata through the system version route", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-api-version-"));
  const { createMimirApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")
    ).href
  );
  const { loadEnvironment } = await import(
    pathToFileURL(
      path.join(process.cwd(), "packages", "infrastructure", "dist", "index.js")
    ).href
  );

  const api = createMimirApiServer(
    loadEnvironment({
      ...process.env,
      MAB_NODE_ENV: "test",
      MAB_RELEASE_VERSION: "0.3.0",
      MAB_GIT_TAG: "v0.3.0",
      MAB_GIT_COMMIT: "abcdef0123456789",
      MAB_RELEASE_CHANNEL: "tagged",
      MAB_VAULT_ROOT: path.join(root, "vault", "canonical"),
      MAB_STAGING_ROOT: path.join(root, "vault", "staging"),
      MAB_SQLITE_PATH: path.join(root, "state", "mimisbrunnr.sqlite"),
      MAB_QDRANT_URL: "http://127.0.0.1:6333",
      MAB_QDRANT_COLLECTION: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
      MAB_EMBEDDING_PROVIDER: "hash",
      MAB_REASONING_PROVIDER: "heuristic",
      MAB_DRAFTING_PROVIDER: "disabled",
      MAB_RERANKER_PROVIDER: "local",
      MAB_API_HOST: "127.0.0.1",
      MAB_API_PORT: "0",
      MAB_LOG_LEVEL: "error"
    })
  );

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();
  const baseUrl = apiBaseUrl(api);

  const response = await fetch(`${baseUrl}/v1/system/version`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.release.version, "0.3.0");
  assert.equal(payload.release.gitTag, "v0.3.0");
  assert.equal(payload.release.gitCommit, "abcdef0123456789");
  assert.equal(payload.release.releaseChannel, "tagged");
});

test("loadEnvironment accepts old and new mimisbrunnr role env names", async () => {
  const { loadEnvironment } = await import(
    "../../packages/infrastructure/dist/index.js"
  );

  const legacy = loadEnvironment({
    MAB_ROLE_MIMIR_BRUNNR_PRIMARY_PROVIDER: "internal_heuristic",
    MAB_ROLE_MIMIR_BRUNNR_PRIMARY_MODEL: "legacy-model"
  });
  assert.equal(
    legacy.roleBindings.mimisbrunnr_primary.providerId,
    "internal_heuristic"
  );
  assert.equal(legacy.roleBindings.mimisbrunnr_primary.modelId, "legacy-model");

  const current = loadEnvironment({
    MAB_ROLE_MIMISBRUNNR_PRIMARY_PROVIDER: "docker_ollama",
    MAB_ROLE_MIMISBRUNNR_PRIMARY_MODEL: "current-model",
    MAB_ROLE_MIMIR_BRUNNR_PRIMARY_PROVIDER: "internal_heuristic",
    MAB_ROLE_MIMIR_BRUNNR_PRIMARY_MODEL: "legacy-model"
  });
  assert.equal(current.roleBindings.mimisbrunnr_primary.providerId, "docker_ollama");
  assert.equal(current.roleBindings.mimisbrunnr_primary.modelId, "current-model");
});
test("loadEnvironment derives storage paths from MAB_DATA_ROOT", async () => {
  const { loadEnvironment } = await import(
    pathToFileURL(
      path.join(process.cwd(), "packages", "infrastructure", "dist", "index.js")
    ).href
  );
  const dataRoot = path.join(os.tmpdir(), `mimir-data-root-${randomUUID()}`);

  const environment = loadEnvironment({
    ...process.env,
    MAB_DATA_ROOT: dataRoot,
    MAB_VAULT_ROOT: undefined,
    MAB_STAGING_ROOT: undefined,
    MAB_SQLITE_PATH: undefined
  });

  assert.equal(environment.vaultRoot, path.join(dataRoot, "vault", "canonical"));
  assert.equal(environment.stagingRoot, path.join(dataRoot, "vault", "staging"));
  assert.equal(
    environment.sqlitePath,
    path.join(dataRoot, "state", "mimisbrunnr.sqlite")
  );
});


test("mimir-api lists Docker AI tools through the read-only route", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-api-ai-tools-"));
  const { createMimirApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")
    ).href
  );
  const api = createMimirApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "mimisbrunnr.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 0,
    logLevel: "error",
    toolRegistryDir: path.resolve("docker", "tool-registry")
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();
  const response = await fetch(`${apiBaseUrl(api)}/v1/tools/ai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: ["aider"], includeEnvironment: true, includeRuntime: true })
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.tools.map((tool) => tool.id), ["aider"]);
  assert.equal(payload.tools[0].environment.MIMIR_API_URL, "http://mimir-api:8080");
  assert.equal(payload.tools[0].runtime.compose.service, "aider");
  assert.equal(payload.tools[0].runtime.container.workspaceMount.access, "read_write");
});

test("mimir-api checks Docker AI tool manifests through the read-only route", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-api-check-ai-tools-"));
  const { createMimirApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")
    ).href
  );
  const api = createMimirApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "mimisbrunnr.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 0,
    logLevel: "error",
    toolRegistryDir: path.resolve("docker", "tool-registry")
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();
  const response = await fetch(`${apiBaseUrl(api)}/v1/tools/ai/check`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: ["rtk"] })
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.checks.map((check) => check.toolId), ["rtk"]);
  assert.equal(payload.checks[0].status, "valid");
});
test("mimir-api builds Docker AI tool package plans through the read-only route", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-api-tools-package-plan-"));
  const { createMimirApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")
    ).href
  );
  const api = createMimirApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "mimisbrunnr.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 0,
    logLevel: "error",
    toolRegistryDir: path.resolve("docker", "tool-registry")
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();
  const response = await fetch(`${apiBaseUrl(api)}/v1/tools/ai/package-plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: ["rtk"] })
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.packageReady, true);
  assert.deepEqual(payload.tools.map((tool) => tool.id), ["rtk"]);
  assert.equal(payload.tools[0].composeRun.command, "docker");
  assert.equal(payload.tools[0].mimisbrunnrMountAllowed, false);
});

test("mimir-api exposes auth registry status through the system auth route", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-api-auth-status-"));
  const { createMimirApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")
    ).href
  );

  const api = createMimirApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "mimisbrunnr.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 0,
    logLevel: "error",
    auth: {
      mode: "enforced",
      allowAnonymousInternal: true,
      actorRegistry: [
        {
          actorId: "operator-http",
          actorRole: "operator",
          authToken: "operator-http-secret",
          source: "mimir-api-admin",
          allowedTransports: ["http"],
          allowedAdminActions: ["view_auth_status"]
        }
      ],
      issuerSecret: "api-issuer-secret",
      issuedTokenRequireRegistryMatch: true
    }
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();
  const baseUrl = apiBaseUrl(api);

  const unauthorized = await fetch(`${baseUrl}/v1/system/auth`);
  assert.equal(unauthorized.status, 401);

  const response = await fetch(`${baseUrl}/v1/system/auth`, {
    headers: {
      "x-mimir-actor-id": "operator-http",
      "x-mimir-actor-role": "operator",
      "x-mimir-source": "mimir-api-admin",
      "x-mimir-actor-token": "operator-http-secret"
    }
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.auth.mode, "enforced");
  assert.equal(payload.auth.issuedTokenSupport.enabled, true);
  assert.equal(payload.auth.actorCounts.total, 1);
  assert.equal(payload.issuedTokens.total, 0);
});

test("mimir-api can issue short-lived actor tokens through the protected auth route", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-api-issue-token-"));
  const { createMimirApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")
    ).href
  );

  const api = createMimirApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "mimisbrunnr.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 0,
    logLevel: "error",
    auth: {
      mode: "enforced",
      allowAnonymousInternal: true,
      actorRegistry: [
        {
          actorId: "operator-http",
          actorRole: "operator",
          authToken: "operator-http-secret",
          source: "mimir-api-admin",
          allowedTransports: ["http"],
          allowedAdminActions: [
            "issue_auth_token",
            "inspect_auth_token",
            "view_issued_tokens"
          ]
        },
        {
          actorId: "validate-note-http",
          actorRole: "orchestrator",
          source: "mimir-api",
          allowedTransports: ["http"],
          allowedCommands: ["validate_note"]
        }
      ],
      issuerSecret: "api-issuer-secret",
      issuedTokenRequireRegistryMatch: true
    }
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();
  const baseUrl = apiBaseUrl(api);

  const response = await fetch(`${baseUrl}/v1/system/auth/issue-token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mimir-actor-id": "operator-http",
      "x-mimir-actor-role": "operator",
      "x-mimir-source": "mimir-api-admin",
      "x-mimir-actor-token": "operator-http-secret"
    },
    body: JSON.stringify({
      actorId: "validate-note-http",
      actorRole: "orchestrator",
      source: "mimir-api",
      allowedTransports: ["http"],
      allowedCommands: ["validate_note"],
      ttlMinutes: 60
    })
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.match(payload.issuedToken, /^mab1\./);
  assert.equal(payload.claims.actorId, "validate-note-http");

  const issuedTokensResponse = await fetch(
    `${baseUrl}/v1/system/auth/issued-tokens?includeRevoked=true`,
    {
      headers: {
        "x-mimir-actor-id": "operator-http",
        "x-mimir-actor-role": "operator",
        "x-mimir-source": "mimir-api-admin",
        "x-mimir-actor-token": "operator-http-secret"
      }
    }
  );

  assert.equal(issuedTokensResponse.status, 200);
  const issuedTokensPayload = await issuedTokensResponse.json();
  assert.equal(issuedTokensPayload.ok, true);
  assert.equal(issuedTokensPayload.summary.total, 1);
  assert.equal(issuedTokensPayload.issuedTokens.length, 1);
  assert.equal(issuedTokensPayload.issuedTokens[0].actorId, "validate-note-http");
  assert.equal(issuedTokensPayload.issuedTokens[0].lifecycleStatus, "active");
  assert.equal(issuedTokensPayload.issuedTokens[0].issuedByActorId, "operator-http");
  assert.equal(issuedTokensPayload.issuedTokens[0].issuedByActorRole, "operator");
  assert.equal(issuedTokensPayload.issuedTokens[0].issuedBySource, "mimir-api-admin");
  assert.equal(issuedTokensPayload.issuedTokens[0].issuedByTransport, "http");
});

test("mimir-api filters issued token listings by issuer revoker and lifecycle state", async (t) => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "mimir-api-issued-token-filters-")
  );
  const revocationPath = path.join(root, "config", "revoked-issued-token-ids.json");
  const { createMimirApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")
    ).href
  );

  const api = createMimirApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "mimisbrunnr.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 0,
    logLevel: "error",
    auth: {
      mode: "enforced",
      actorRegistry: [
        {
          actorId: "operator-http",
          actorRole: "operator",
          authToken: "operator-http-secret",
          source: "mimir-api-admin",
          allowedTransports: ["http"],
          allowedCommands: ["query_history"],
          allowedAdminActions: [
            "issue_auth_token",
            "revoke_auth_token",
            "view_issued_tokens"
          ]
        },
        {
          actorId: "security-http",
          actorRole: "operator",
          authToken: "security-http-secret",
          source: "mimir-security-admin",
          allowedTransports: ["http"],
          allowedAdminActions: [
            "issue_auth_token",
            "revoke_auth_token",
            "view_issued_tokens"
          ]
        }
      ],
      issuerSecret: "api-issuer-secret",
      issuedTokenRequireRegistryMatch: false,
      issuedTokenRevocationPath: revocationPath,
      revokedIssuedTokenIds: []
    }
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();
  const baseUrl = apiBaseUrl(api);

  const activeIssueResponse = await fetch(`${baseUrl}/v1/system/auth/issue-token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mimir-actor-id": "operator-http",
      "x-mimir-actor-role": "operator",
      "x-mimir-source": "mimir-api-admin",
      "x-mimir-actor-token": "operator-http-secret"
    },
    body: JSON.stringify({
      actorId: "api-active-actor",
      actorRole: "operator",
      source: "mimir-api",
      ttlMinutes: 60
    })
  });

  assert.equal(activeIssueResponse.status, 200);

  const revokedIssueResponse = await fetch(`${baseUrl}/v1/system/auth/issue-token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mimir-actor-id": "security-http",
      "x-mimir-actor-role": "operator",
      "x-mimir-source": "mimir-security-admin",
      "x-mimir-actor-token": "security-http-secret"
    },
    body: JSON.stringify({
      actorId: "api-revoked-actor",
      actorRole: "operator",
      source: "mimir-api",
      ttlMinutes: 60
    })
  });

  assert.equal(revokedIssueResponse.status, 200);
  const revokedIssuePayload = await revokedIssueResponse.json();

  const revokeResponse = await fetch(`${baseUrl}/v1/system/auth/revoke-token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mimir-actor-id": "security-http",
      "x-mimir-actor-role": "operator",
      "x-mimir-source": "mimir-security-admin",
      "x-mimir-actor-token": "security-http-secret"
    },
    body: JSON.stringify({
      token: revokedIssuePayload.issuedToken,
      reason: "security rotation"
    })
  });

  assert.equal(revokeResponse.status, 200);

  const activeListResponse = await fetch(
    `${baseUrl}/v1/system/auth/issued-tokens?includeRevoked=true&issuedByActorId=operator-http&lifecycleStatus=active`,
    {
      headers: {
        "x-mimir-actor-id": "operator-http",
        "x-mimir-actor-role": "operator",
        "x-mimir-source": "mimir-api-admin",
        "x-mimir-actor-token": "operator-http-secret"
      }
    }
  );

  assert.equal(activeListResponse.status, 200);
  const activeListPayload = await activeListResponse.json();
  assert.equal(activeListPayload.ok, true);
  assert.deepEqual(
    activeListPayload.issuedTokens.map((record) => record.actorId),
    ["api-active-actor"]
  );

  const revokedListResponse = await fetch(
    `${baseUrl}/v1/system/auth/issued-tokens?includeRevoked=true&issuedByActorId=security-http&revokedByActorId=security-http&lifecycleStatus=revoked`,
    {
      headers: {
        "x-mimir-actor-id": "operator-http",
        "x-mimir-actor-role": "operator",
        "x-mimir-source": "mimir-api-admin",
        "x-mimir-actor-token": "operator-http-secret"
      }
    }
  );

  assert.equal(revokedListResponse.status, 200);
  const revokedListPayload = await revokedListResponse.json();
  assert.equal(revokedListPayload.ok, true);
  assert.deepEqual(
    revokedListPayload.issuedTokens.map((record) => record.actorId),
    ["api-revoked-actor"]
  );
  assert.equal(revokedListPayload.issuedTokens[0].issuedByActorId, "security-http");
  assert.equal(revokedListPayload.issuedTokens[0].revokedByActorId, "security-http");
  assert.equal(revokedListPayload.issuedTokens[0].lifecycleStatus, "revoked");
});

test("mimir-api enforces centrally managed issuer controls for multi-operator issuance", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-api-auth-issuers-"));
  const revocationPath = path.join(root, "config", "revoked-issued-token-ids.json");
  const { createMimirApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")
    ).href
  );

  const api = createMimirApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "mimisbrunnr.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 0,
    logLevel: "error",
    auth: {
      mode: "enforced",
      actorRegistry: [
        {
          actorId: "operator-http",
          actorRole: "operator",
          authToken: "operator-http-secret",
          source: "mimir-api-admin",
          allowedTransports: ["http"],
          allowedAdminActions: [
            "issue_auth_token",
            "revoke_auth_token",
            "view_auth_issuers",
            "manage_auth_issuers"
          ]
        },
        {
          actorId: "security-http",
          actorRole: "operator",
          authToken: "security-http-secret",
          source: "mimir-security-admin",
          allowedTransports: ["http"],
          allowedAdminActions: [
            "issue_auth_token",
            "revoke_auth_token",
            "view_auth_issuers"
          ]
        }
      ],
      issuerSecret: "api-issuer-secret",
      issuedTokenRequireRegistryMatch: false,
      issuedTokenRevocationPath: revocationPath,
      revokedIssuedTokenIds: []
    }
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();
  const baseUrl = apiBaseUrl(api);

  const issuersBeforeResponse = await fetch(`${baseUrl}/v1/system/auth/issuers`, {
    headers: {
      "x-mimir-actor-id": "operator-http",
      "x-mimir-actor-role": "operator",
      "x-mimir-source": "mimir-api-admin",
      "x-mimir-actor-token": "operator-http-secret"
    }
  });
  assert.equal(issuersBeforeResponse.status, 200);
  const issuersBeforePayload = await issuersBeforeResponse.json();
  assert.equal(issuersBeforePayload.ok, true);
  assert.equal(issuersBeforePayload.summary.total, 2);

  const issuerUpdateResponse = await fetch(`${baseUrl}/v1/system/auth/issuer-state`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mimir-actor-id": "operator-http",
      "x-mimir-actor-role": "operator",
      "x-mimir-source": "mimir-api-admin",
      "x-mimir-actor-token": "operator-http-secret"
    },
    body: JSON.stringify({
      actorId: "security-http",
      enabled: true,
      allowIssueAuthToken: false,
      allowRevokeAuthToken: true,
      reason: "http revoker only"
    })
  });
  assert.equal(issuerUpdateResponse.status, 200);
  const issuerUpdatePayload = await issuerUpdateResponse.json();
  assert.equal(issuerUpdatePayload.ok, true);
  assert.equal(issuerUpdatePayload.issuer.actorId, "security-http");
  assert.equal(issuerUpdatePayload.issuer.allowIssueAuthToken, false);
  assert.equal(issuerUpdatePayload.issuer.allowRevokeAuthToken, true);

  const deniedIssueResponse = await fetch(`${baseUrl}/v1/system/auth/issue-token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mimir-actor-id": "security-http",
      "x-mimir-actor-role": "operator",
      "x-mimir-source": "mimir-security-admin",
      "x-mimir-actor-token": "security-http-secret"
    },
    body: JSON.stringify({
      actorId: "api-issued-by-security",
      actorRole: "operator",
      source: "mimir-api",
      ttlMinutes: 60
    })
  });
  assert.equal(deniedIssueResponse.status, 403);
  const deniedIssuePayload = await deniedIssueResponse.json();
  assert.equal(deniedIssuePayload.ok, false);
  assert.equal(deniedIssuePayload.error.code, "forbidden");

  const operatorIssueResponse = await fetch(`${baseUrl}/v1/system/auth/issue-token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mimir-actor-id": "operator-http",
      "x-mimir-actor-role": "operator",
      "x-mimir-source": "mimir-api-admin",
      "x-mimir-actor-token": "operator-http-secret"
    },
    body: JSON.stringify({
      actorId: "api-issued-for-revoke",
      actorRole: "operator",
      source: "mimir-api",
      ttlMinutes: 60
    })
  });
  assert.equal(operatorIssueResponse.status, 200);
  const operatorIssuePayload = await operatorIssueResponse.json();

  const revokeResponse = await fetch(`${baseUrl}/v1/system/auth/revoke-token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mimir-actor-id": "security-http",
      "x-mimir-actor-role": "operator",
      "x-mimir-source": "mimir-security-admin",
      "x-mimir-actor-token": "security-http-secret"
    },
    body: JSON.stringify({
      token: operatorIssuePayload.issuedToken,
      reason: "revoke remains enabled"
    })
  });
  assert.equal(revokeResponse.status, 200);
  const revokePayload = await revokeResponse.json();
  assert.equal(revokePayload.ok, true);
});

test("mimir-api central issuer controls cannot widen registry capabilities", async (t) => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "mimir-api-auth-issuer-no-widen-")
  );
  const { createMimirApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")
    ).href
  );

  const api = createMimirApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "mimisbrunnr.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 0,
    logLevel: "error",
    auth: {
      mode: "enforced",
      actorRegistry: [
        {
          actorId: "operator-http",
          actorRole: "operator",
          authToken: "operator-http-secret",
          source: "mimir-api-admin",
          allowedTransports: ["http"],
          allowedAdminActions: [
            "issue_auth_token",
            "revoke_auth_token",
            "view_auth_issuers",
            "manage_auth_issuers"
          ]
        },
        {
          actorId: "revoker-http",
          actorRole: "operator",
          authToken: "revoker-http-secret",
          source: "mimir-revoker-admin",
          allowedTransports: ["http"],
          allowedAdminActions: [
            "revoke_auth_token",
            "view_auth_issuers"
          ]
        }
      ],
      issuerSecret: "api-issuer-secret"
    }
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();
  const baseUrl = apiBaseUrl(api);

  const issuersResponse = await fetch(`${baseUrl}/v1/system/auth/issuers`, {
    headers: {
      "x-mimir-actor-id": "operator-http",
      "x-mimir-actor-role": "operator",
      "x-mimir-source": "mimir-api-admin",
      "x-mimir-actor-token": "operator-http-secret"
    }
  });
  assert.equal(issuersResponse.status, 200);
  const issuersPayload = await issuersResponse.json();
  const revokerIssuer = issuersPayload.issuers.find(
    (issuer) => issuer.actorId === "revoker-http"
  );
  assert.equal(revokerIssuer.allowIssueAuthToken, false);
  assert.equal(revokerIssuer.allowRevokeAuthToken, true);

  const widenResponse = await fetch(`${baseUrl}/v1/system/auth/issuer-state`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mimir-actor-id": "operator-http",
      "x-mimir-actor-role": "operator",
      "x-mimir-source": "mimir-api-admin",
      "x-mimir-actor-token": "operator-http-secret"
    },
    body: JSON.stringify({
      actorId: "revoker-http",
      enabled: true,
      allowIssueAuthToken: true,
      allowRevokeAuthToken: true,
      reason: "attempt unauthorized widening"
    })
  });
  assert.equal(widenResponse.status, 400);
  const widenPayload = await widenResponse.json();
  assert.equal(widenPayload.ok, false);
  assert.equal(widenPayload.error.code, "validation_failed");
  assert.match(widenPayload.error.message, /registry does not allow/i);
});

test("mimir-api bulk revokes issued tokens through the auth lifecycle control plane", async (t) => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "mimir-api-bulk-revoke-issued-tokens-")
  );
  const revocationPath = path.join(root, "config", "revoked-issued-token-ids.json");
  const { createMimirApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")
    ).href
  );

  const api = createMimirApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "mimisbrunnr.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 0,
    logLevel: "error",
    auth: {
      mode: "enforced",
      actorRegistry: [
        {
          actorId: "operator-http",
          actorRole: "operator",
          authToken: "operator-http-secret",
          source: "mimir-api-admin",
          allowedTransports: ["http"],
          allowedAdminActions: [
            "issue_auth_token",
            "revoke_auth_tokens",
            "view_issued_tokens"
          ]
        },
        {
          actorId: "security-http",
          actorRole: "operator",
          authToken: "security-http-secret",
          source: "mimir-security-admin",
          allowedTransports: ["http"],
          allowedAdminActions: [
            "issue_auth_token",
            "revoke_auth_tokens",
            "view_issued_tokens"
          ]
        }
      ],
      issuerSecret: "api-issuer-secret",
      issuedTokenRequireRegistryMatch: false,
      issuedTokenRevocationPath: revocationPath,
      revokedIssuedTokenIds: []
    }
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();
  const baseUrl = apiBaseUrl(api);

  for (const request of [
    {
      headers: {
        "x-mimir-actor-id": "operator-http",
        "x-mimir-actor-role": "operator",
        "x-mimir-source": "mimir-api-admin",
        "x-mimir-actor-token": "operator-http-secret"
      },
      body: {
        actorId: "api-active-actor",
        actorRole: "operator",
        source: "mimir-api",
        ttlMinutes: 60
      }
    },
    {
      headers: {
        "x-mimir-actor-id": "security-http",
        "x-mimir-actor-role": "operator",
        "x-mimir-source": "mimir-security-admin",
        "x-mimir-actor-token": "security-http-secret"
      },
      body: {
        actorId: "api-future-actor-a",
        actorRole: "operator",
        source: "mimir-api",
        validFrom: addDaysIso(currentDateIso(), 1),
        validUntil: addDaysIso(currentDateIso(), 2)
      }
    },
    {
      headers: {
        "x-mimir-actor-id": "security-http",
        "x-mimir-actor-role": "operator",
        "x-mimir-source": "mimir-security-admin",
        "x-mimir-actor-token": "security-http-secret"
      },
      body: {
        actorId: "api-future-actor-b",
        actorRole: "operator",
        source: "mimir-api",
        validFrom: addDaysIso(currentDateIso(), 1),
        validUntil: addDaysIso(currentDateIso(), 2)
      }
    }
  ]) {
    const issueResponse = await fetch(`${baseUrl}/v1/system/auth/issue-token`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...request.headers
      },
      body: JSON.stringify(request.body)
    });
    assert.equal(issueResponse.status, 200);
  }

  const previewResponse = await fetch(`${baseUrl}/v1/system/auth/revoke-tokens`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mimir-actor-id": "operator-http",
      "x-mimir-actor-role": "operator",
      "x-mimir-source": "mimir-api-admin",
      "x-mimir-actor-token": "operator-http-secret"
    },
    body: JSON.stringify({
      issuedByActorId: "security-http",
      lifecycleStatus: "future",
      dryRun: true,
      reason: "rotation preview"
    })
  });

  assert.equal(previewResponse.status, 200);
  const previewPayload = await previewResponse.json();
  assert.equal(previewPayload.ok, true);
  assert.equal(previewPayload.dryRun, true);
  assert.equal(previewPayload.matchedCount, 2);
  assert.equal(previewPayload.revokedCount, 0);
  assert.deepEqual(
    previewPayload.candidates.map((record) => record.actorId).sort(),
    ["api-future-actor-a", "api-future-actor-b"]
  );

  const revokeResponse = await fetch(`${baseUrl}/v1/system/auth/revoke-tokens`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mimir-actor-id": "security-http",
      "x-mimir-actor-role": "operator",
      "x-mimir-source": "mimir-security-admin",
      "x-mimir-actor-token": "security-http-secret"
    },
    body: JSON.stringify({
      issuedByActorId: "security-http",
      lifecycleStatus: "future",
      reason: "security rotation"
    })
  });

  assert.equal(revokeResponse.status, 200);
  const revokePayload = await revokeResponse.json();
  assert.equal(revokePayload.ok, true);
  assert.equal(revokePayload.dryRun, false);
  assert.equal(revokePayload.matchedCount, 2);
  assert.equal(revokePayload.revokedCount, 2);
  assert.equal(revokePayload.alreadyRevokedCount, 0);

  const revokedListResponse = await fetch(
    `${baseUrl}/v1/system/auth/issued-tokens?includeRevoked=true&issuedByActorId=security-http&revokedByActorId=security-http&lifecycleStatus=revoked`,
    {
      headers: {
        "x-mimir-actor-id": "operator-http",
        "x-mimir-actor-role": "operator",
        "x-mimir-source": "mimir-api-admin",
        "x-mimir-actor-token": "operator-http-secret"
      }
    }
  );

  assert.equal(revokedListResponse.status, 200);
  const revokedListPayload = await revokedListResponse.json();
  assert.equal(revokedListPayload.ok, true);
  assert.deepEqual(
    revokedListPayload.issuedTokens.map((record) => record.actorId).sort(),
    ["api-future-actor-a", "api-future-actor-b"]
  );
  assert.equal(revokedListPayload.issuedTokens[0].revokedByActorId, "security-http");
  assert.equal(
    revokedListPayload.issuedTokens[0].revokedReason,
    "security rotation"
  );
});

test("mimir-api can introspect actor tokens through the protected auth route", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-api-introspect-token-"));
  const { createMimirApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")
    ).href
  );

  const api = createMimirApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "mimisbrunnr.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 0,
    logLevel: "error",
    auth: {
      mode: "enforced",
      allowAnonymousInternal: true,
      actorRegistry: [
        {
          actorId: "operator-http",
          actorRole: "operator",
          authToken: "operator-http-secret",
          source: "mimir-api-admin",
          allowedTransports: ["http"],
          allowedAdminActions: ["issue_auth_token", "inspect_auth_token"]
        },
        {
          actorId: "validate-note-http",
          actorRole: "orchestrator",
          source: "mimir-api",
          allowedTransports: ["http"],
          allowedCommands: ["validate_note"]
        }
      ],
      issuerSecret: "api-issuer-secret",
      issuedTokenRequireRegistryMatch: true
    }
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();
  const baseUrl = apiBaseUrl(api);

  const issueResponse = await fetch(`${baseUrl}/v1/system/auth/issue-token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mimir-actor-id": "operator-http",
      "x-mimir-actor-role": "operator",
      "x-mimir-source": "mimir-api-admin",
      "x-mimir-actor-token": "operator-http-secret"
    },
    body: JSON.stringify({
      actorId: "validate-note-http",
      actorRole: "orchestrator",
      source: "mimir-api",
      allowedTransports: ["http"],
      allowedCommands: ["validate_note"],
      ttlMinutes: 60
    })
  });

  assert.equal(issueResponse.status, 200);
  const issuedPayload = await issueResponse.json();

  const response = await fetch(`${baseUrl}/v1/system/auth/introspect-token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mimir-actor-id": "operator-http",
      "x-mimir-actor-role": "operator",
      "x-mimir-source": "mimir-api-admin",
      "x-mimir-actor-token": "operator-http-secret"
    },
    body: JSON.stringify({
      token: issuedPayload.issuedToken,
      expectedTransport: "http",
      expectedCommand: "validate_note"
    })
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.inspection.tokenKind, "issued");
  assert.equal(payload.inspection.valid, true);
  assert.equal(payload.inspection.authorization.transportAllowed, true);
  assert.equal(payload.inspection.authorization.commandAllowed, true);
  assert.equal(payload.inspection.matchedActor.actorId, "validate-note-http");
});

test("mimir-api revokes issued actor tokens and rejects them immediately afterward", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-api-revoke-token-"));
  const revocationPath = path.join(root, "config", "revoked-issued-token-ids.json");
  const { createMimirApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")
    ).href
  );
  const issuerSecret = "api-revoke-secret";
  const api = createMimirApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "mimisbrunnr.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 0,
    logLevel: "error",
    auth: {
      mode: "enforced",
      allowAnonymousInternal: true,
      actorRegistry: [
        {
          actorId: "operator-http",
          actorRole: "operator",
          authToken: "operator-http-secret",
          source: "mimir-api-admin",
          allowedTransports: ["http"],
          allowedAdminActions: [
            "issue_auth_token",
            "revoke_auth_token",
            "view_issued_tokens"
          ]
        },
        {
          actorId: "validate-note-http",
          actorRole: "orchestrator",
          source: "mimir-api",
          allowedTransports: ["http"],
          allowedCommands: ["validate_note"]
        }
      ],
      issuerSecret,
      issuedTokenRequireRegistryMatch: true,
      issuedTokenRevocationPath: revocationPath,
      revokedIssuedTokenIds: []
    }
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();
  const baseUrl = apiBaseUrl(api);

  const issueResponse = await fetch(`${baseUrl}/v1/system/auth/issue-token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mimir-actor-id": "operator-http",
      "x-mimir-actor-role": "operator",
      "x-mimir-source": "mimir-api-admin",
      "x-mimir-actor-token": "operator-http-secret"
    },
    body: JSON.stringify({
      actorId: "validate-note-http",
      actorRole: "orchestrator",
      source: "mimir-api",
      allowedTransports: ["http"],
      allowedCommands: ["validate_note"],
      ttlMinutes: 60
    })
  });

  assert.equal(issueResponse.status, 200);
  const issuePayload = await issueResponse.json();
  assert.equal(issuePayload.ok, true);
  const issuedToken = issuePayload.issuedToken;

  const revokeResponse = await fetch(`${baseUrl}/v1/system/auth/revoke-token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mimir-actor-id": "operator-http",
      "x-mimir-actor-role": "operator",
      "x-mimir-source": "mimir-api-admin",
      "x-mimir-actor-token": "operator-http-secret"
    },
    body: JSON.stringify({
      token: issuedToken,
      reason: "compromised"
    })
  });

  assert.equal(revokeResponse.status, 200);
  const revokePayload = await revokeResponse.json();
  assert.equal(revokePayload.ok, true);
  assert.equal(typeof revokePayload.revokedTokenId, "string");
  assert.equal(revokePayload.persisted, true);

  const issuedTokensResponse = await fetch(
    `${baseUrl}/v1/system/auth/issued-tokens?includeRevoked=true`,
    {
      headers: {
        "x-mimir-actor-id": "operator-http",
        "x-mimir-actor-role": "operator",
        "x-mimir-source": "mimir-api-admin",
        "x-mimir-actor-token": "operator-http-secret"
      }
    }
  );

  assert.equal(issuedTokensResponse.status, 200);
  const issuedTokensPayload = await issuedTokensResponse.json();
  assert.equal(issuedTokensPayload.ok, true);
  assert.equal(issuedTokensPayload.summary.total, 1);
  assert.equal(issuedTokensPayload.issuedTokens.length, 1);
  assert.equal(issuedTokensPayload.issuedTokens[0].lifecycleStatus, "revoked");
  assert.equal(issuedTokensPayload.issuedTokens[0].revokedReason, "compromised");
  assert.equal(issuedTokensPayload.issuedTokens[0].revokedByActorId, "operator-http");
  assert.equal(issuedTokensPayload.issuedTokens[0].revokedByActorRole, "operator");
  assert.equal(issuedTokensPayload.issuedTokens[0].revokedBySource, "mimir-api-admin");
  assert.equal(issuedTokensPayload.issuedTokens[0].revokedByTransport, "http");

  const historyResponse = await fetch(`${baseUrl}/v1/history/query`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mimir-actor-id": "operator-http",
      "x-mimir-actor-role": "operator",
      "x-mimir-source": "mimir-api-admin",
      "x-mimir-actor-token": "operator-http-secret"
    },
    body: JSON.stringify({
      actor: {
        actorId: "operator-http",
        actorRole: "operator",
        source: "mimir-api-admin",
        authToken: "operator-http-secret"
      },
      actorId: "operator-http",
      actionType: "issue_auth_token",
      limit: 20
    })
  });

  assert.equal(historyResponse.status, 200);
  const historyPayload = await historyResponse.json();
  assert.equal(historyPayload.ok, true);
  assert.equal(historyPayload.data.entries.length, 1);
  const issueAudit = historyPayload.data.entries[0];
  assert.equal(issueAudit.actorId, "operator-http");
  assert.equal(issueAudit.actionType, "issue_auth_token");
  assert.equal(issueAudit.detail.tokenId, revokePayload.revokedTokenId);
  assert.equal(issueAudit.detail.targetActorId, "validate-note-http");
  assert.equal(issueAudit.detail.targetActorRole, "orchestrator");
  assert.equal(issueAudit.detail.targetSource, "mimir-api");
  assert.equal(issueAudit.detail.transport, "http");
  assert.equal(issueAudit.detail.command, "issue-token");
  assert.equal(issueAudit.detail.hasAllowedCommands, true);
  assert.equal(issueAudit.detail.hasAllowedAdminActions, false);
  assert.equal(issueAudit.detail.hasAllowedCorpora, false);

  const revokeHistoryResponse = await fetch(`${baseUrl}/v1/history/query`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mimir-actor-id": "operator-http",
      "x-mimir-actor-role": "operator",
      "x-mimir-source": "mimir-api-admin",
      "x-mimir-actor-token": "operator-http-secret"
    },
    body: JSON.stringify({
      actor: {
        actorId: "operator-http",
        actorRole: "operator",
        source: "mimir-api-admin",
        authToken: "operator-http-secret"
      },
      actorId: "operator-http",
      actionType: "revoke_auth_token",
      limit: 20
    })
  });

  assert.equal(revokeHistoryResponse.status, 200);
  const revokeHistoryPayload = await revokeHistoryResponse.json();
  assert.equal(revokeHistoryPayload.ok, true);
  assert.equal(revokeHistoryPayload.data.entries.length, 1);
  const revokeAudit = revokeHistoryPayload.data.entries[0];
  assert.equal(revokeAudit.actorId, "operator-http");
  assert.equal(revokeAudit.actionType, "revoke_auth_token");
  assert.equal(revokeAudit.detail.tokenId, revokePayload.revokedTokenId);
  assert.equal(revokeAudit.detail.reason, "compromised");
  assert.equal(revokeAudit.detail.transport, "http");
  assert.equal(revokeAudit.detail.command, "revoke-token");
  assert.equal(revokeAudit.detail.recordedTokenFound, true);
  assert.equal(revokeAudit.detail.alreadyRevoked, false);

  const validateResponse = await fetch(`${baseUrl}/v1/notes/validate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mimir-actor-token": issuedToken
    },
    body: JSON.stringify({
      actor: {
        actorId: "validate-note-http",
        actorRole: "orchestrator",
        source: "mimir-api",
        authToken: issuedToken
      },
      targetCorpus: "mimisbrunnr",
      notePath: "mimisbrunnr/decision/revoked-token-note.md",
      validationMode: "promotion",
      frontmatter: {
        noteId: randomUUID(),
        title: "Revoked Token Note",
        project: "mimir",
        type: "decision",
        status: "promoted",
        updated: currentDateIso(),
        summary: "Revoked issued tokens should fail immediately.",
        tags: ["project/mimir", "domain/orchestration", "status/promoted"],
        scope: "auth",
        corpusId: "mimisbrunnr",
        currentState: false
      },
      body: [
        "## Context",
        "",
        "Revoked auth context.",
        "",
        "## Decision",
        "",
        "Revoked auth decision.",
        "",
        "## Rationale",
        "",
        "Revoked auth rationale.",
        "",
        "## Consequences",
        "",
        "Revoked auth consequences."
      ].join("\n")
    })
  });

  assert.equal(validateResponse.status, 401);
  const validatePayload = await validateResponse.json();
  assert.equal(validatePayload.error.code, "unauthorized");
});

test("mimir-api exposes temporal freshness reports through the system freshness route", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-api-freshness-"));
  const sqlitePath = path.join(root, "state", "mimisbrunnr.sqlite");
  await seedTemporalValidityNote(sqlitePath, {
    noteId: "expiring-api-freshness-note",
    notePath: "mimisbrunnr/reference/expiring-api-freshness-note.md",
    validFrom: addDaysIso(currentDateIso(), -7),
    validUntil: addDaysIso(currentDateIso(), 3),
    summary: "API freshness route should show expiring refresh candidates."
  });

  const { createMimirApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")
    ).href
  );

  const api = createMimirApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath,
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 0,
    logLevel: "error"
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();
  const baseUrl = apiBaseUrl(api);

  const response = await fetch(
    `${baseUrl}/v1/system/freshness?expiringWithinDays=7&limitPerCategory=5`
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.freshness.expiringSoonCurrentStateNotes, 1);
  assert.equal(payload.freshness.limitPerCategory, 5);
  assert.equal(
    payload.freshness.expiringSoonCurrentState[0].noteId,
    "expiring-api-freshness-note"
  );
  assert.equal(payload.freshness.expiringSoonCurrentState[0].state, "expiring_soon");
});

test("mimir-api creates governed refresh drafts through the temporal freshness route", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-api-refresh-draft-"));
  const seeded = await seedCanonicalTemporalNote(root, {
    title: "API Refresh Workflow",
    scope: "api-refresh-workflow",
    validFrom: addDaysIso(currentDateIso(), -30),
    validUntil: addDaysIso(currentDateIso(), -1)
  });

  const { createMimirApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")
    ).href
  );

  const api = createMimirApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "mimisbrunnr.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 0,
    logLevel: "error"
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();
  const baseUrl = apiBaseUrl(api);

  const response = await fetch(
    `${baseUrl}/v1/system/freshness/refresh-draft`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        noteId: seeded.noteId,
        bodyHints: ["Refresh the expired API guidance."]
      })
    }
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.sourceNoteId, seeded.noteId);
  assert.equal(payload.data.sourceState, "expired");
  assert.deepEqual(payload.data.frontmatter.supersedes, [seeded.noteId]);
});

test("mimir-api exposes direct context-packet assembly over HTTP", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-api-packet-"));
  const { createMimirApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")
    ).href
  );

  const api = createMimirApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "mimisbrunnr.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 0,
    logLevel: "error"
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();
  const baseUrl = apiBaseUrl(api);

  const response = await fetch(`${baseUrl}/v1/context/packet`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      intent: "architecture_recall",
      budget: {
        maxTokens: 320,
        maxSources: 2,
        maxRawExcerpts: 1,
        maxSummarySentences: 2
      },
      includeRawExcerpts: false,
      candidates: [
        {
          noteType: "architecture",
          score: 0.84,
          summary: "HTTP route can assemble a bounded packet directly.",
          scope: "architecture",
          qualifiers: ["bounded retrieval"],
          tags: ["project/mimir"],
          stalenessClass: "current",
          provenance: {
            noteId: "note-http-1",
            notePath: "mimisbrunnr/architecture/http-packet.md",
            headingPath: ["Summary"]
          }
        }
      ]
    })
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.packet.packetType, "implementation");
  assert.equal(payload.packet.evidence[0].noteId, "note-http-1");
});

test("mimir-api rejects malformed request payloads at ingress", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-api-invalid-"));
  const { createMimirApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")
    ).href
  );

  const api = createMimirApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "mimisbrunnr.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 0,
    logLevel: "error"
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();
  const baseUrl = apiBaseUrl(api);

  const response = await fetch(`${baseUrl}/v1/context/search`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      query: "invalid budget",
      corpusIds: ["mimisbrunnr"],
      budget: {
        maxTokens: "320",
        maxSources: 2,
        maxRawExcerpts: 1,
        maxSummarySentences: 2
      }
    })
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "validation_failed");
});

test("mimir-api enforces registered actor tokens when auth mode is enforced", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-api-auth-"));
  const { createMimirApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")
    ).href
  );

  const api = createMimirApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "mimisbrunnr.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 0,
    logLevel: "error",
    auth: {
      mode: "enforced",
      allowAnonymousInternal: true,
      actorRegistry: [
        {
          actorId: "validate-note-http",
          actorRole: "orchestrator",
          authToken: "http-secret",
          source: "mimir-api",
          allowedTransports: ["http"],
          allowedCommands: ["validate_note"]
        }
      ]
    }
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();
  const baseUrl = apiBaseUrl(api);

  const unauthenticated = await fetch(`${baseUrl}/v1/notes/validate`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      targetCorpus: "mimisbrunnr",
      notePath: "mimisbrunnr/decision/auth-note.md",
      validationMode: "promotion",
      frontmatter: {
        noteId: randomUUID(),
        title: "Auth Note",
        project: "mimir",
        type: "decision",
        status: "promoted",
        updated: currentDateIso(),
        summary: "Should require a token.",
        tags: ["project/mimir", "domain/orchestration", "status/promoted"],
        scope: "auth",
        corpusId: "mimisbrunnr",
        currentState: false
      },
      body: [
        "## Context",
        "",
        "Auth context.",
        "",
        "## Decision",
        "",
        "Auth decision.",
        "",
        "## Rationale",
        "",
        "Auth rationale.",
        "",
        "## Consequences",
        "",
        "Auth consequences."
      ].join("\n")
    })
  });

  assert.equal(unauthenticated.status, 401);
  const unauthenticatedPayload = await unauthenticated.json();
  assert.equal(unauthenticatedPayload.error.code, "unauthorized");

  const authenticated = await fetch(`${baseUrl}/v1/notes/validate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mimir-actor-token": "http-secret"
    },
    body: JSON.stringify({
      actor: {
        actorId: "validate-note-http",
        actorRole: "orchestrator",
        source: "mimir-api",
        authToken: "http-secret"
      },
      targetCorpus: "mimisbrunnr",
      notePath: "mimisbrunnr/decision/auth-note.md",
      validationMode: "promotion",
      frontmatter: {
        noteId: randomUUID(),
        title: "Auth Note",
        project: "mimir",
        type: "decision",
        status: "promoted",
        updated: currentDateIso(),
        summary: "Should validate once authenticated.",
        tags: ["project/mimir", "domain/orchestration", "status/promoted"],
        scope: "auth",
        corpusId: "mimisbrunnr",
        currentState: false
      },
      body: [
        "## Context",
        "",
        "Auth context.",
        "",
        "## Decision",
        "",
        "Auth decision.",
        "",
        "## Rationale",
        "",
        "Auth rationale.",
        "",
        "## Consequences",
        "",
        "Auth consequences."
      ].join("\n")
    })
  });

  assert.equal(authenticated.status, 200);
  const authenticatedPayload = await authenticated.json();
  assert.equal(authenticatedPayload.valid, true);
});

test("mimir-api loads a file-backed actor registry and honors rotated credential windows", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-api-auth-file-"));
  const registryPath = path.join(root, "config", "actor-registry.json");
  await fsMkdir(path.dirname(registryPath), { recursive: true });
  const now = Date.now();
  await writeFile(
    registryPath,
    JSON.stringify(
      {
        actors: [
          {
            actorId: "validate-note-http",
            actorRole: "orchestrator",
            authTokens: [
              {
                token: "expired-http-secret",
                label: "previous",
                validUntil: new Date(now - 60_000).toISOString()
              },
              {
                token: "current-http-secret",
                label: "current",
                validFrom: new Date(now - 60_000).toISOString(),
                validUntil: new Date(now + 3_600_000).toISOString()
              }
            ],
            source: "mimir-api",
            allowedTransports: ["http"],
            allowedCommands: ["validate_note"]
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  const { createMimirApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")
    ).href
  );
  const { loadEnvironment } = await import(
    pathToFileURL(
      path.join(process.cwd(), "packages", "infrastructure", "dist", "index.js")
    ).href
  );

  const api = createMimirApiServer(
    loadEnvironment({
      ...process.env,
      MAB_NODE_ENV: "test",
      MAB_VAULT_ROOT: path.join(root, "vault", "canonical"),
      MAB_STAGING_ROOT: path.join(root, "vault", "staging"),
      MAB_SQLITE_PATH: path.join(root, "state", "mimisbrunnr.sqlite"),
      MAB_QDRANT_URL: "http://127.0.0.1:6333",
      MAB_QDRANT_COLLECTION: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
      MAB_EMBEDDING_PROVIDER: "hash",
      MAB_REASONING_PROVIDER: "heuristic",
      MAB_DRAFTING_PROVIDER: "disabled",
      MAB_RERANKER_PROVIDER: "local",
      MAB_API_HOST: "127.0.0.1",
      MAB_API_PORT: "0",
      MAB_LOG_LEVEL: "error",
      MAB_AUTH_MODE: "enforced",
      MAB_AUTH_ACTOR_REGISTRY_PATH: registryPath
    })
  );

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();
  const baseUrl = apiBaseUrl(api);

  const expired = await fetch(`${baseUrl}/v1/notes/validate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mimir-actor-token": "expired-http-secret"
    },
    body: JSON.stringify({
      targetCorpus: "mimisbrunnr",
      notePath: "mimisbrunnr/decision/auth-file-note.md",
      validationMode: "promotion",
      frontmatter: {
        noteId: randomUUID(),
        title: "Auth File Note",
        project: "mimir",
        type: "decision",
        status: "promoted",
        updated: currentDateIso(),
        summary: "File-backed auth should reject expired credentials.",
        tags: ["project/mimir", "domain/orchestration", "status/promoted"],
        scope: "auth",
        corpusId: "mimisbrunnr",
        currentState: false
      },
      body: [
        "## Context",
        "",
        "Auth context.",
        "",
        "## Decision",
        "",
        "Auth decision.",
        "",
        "## Rationale",
        "",
        "Auth rationale.",
        "",
        "## Consequences",
        "",
        "Auth consequences."
      ].join("\n")
    })
  });

  assert.equal(expired.status, 401);
  const expiredPayload = await expired.json();
  assert.equal(expiredPayload.error.code, "unauthorized");
  assert.match(expiredPayload.error.message, /expired|inactive/i);

  const current = await fetch(`${baseUrl}/v1/notes/validate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mimir-actor-token": "current-http-secret"
    },
    body: JSON.stringify({
      targetCorpus: "mimisbrunnr",
      notePath: "mimisbrunnr/decision/auth-file-note.md",
      validationMode: "promotion",
      frontmatter: {
        noteId: randomUUID(),
        title: "Auth File Note",
        project: "mimir",
        type: "decision",
        status: "promoted",
        updated: currentDateIso(),
        summary: "File-backed auth should accept active credentials.",
        tags: ["project/mimir", "domain/orchestration", "status/promoted"],
        scope: "auth",
        corpusId: "mimisbrunnr",
        currentState: false
      },
      body: [
        "## Context",
        "",
        "Auth context.",
        "",
        "## Decision",
        "",
        "Auth decision.",
        "",
        "## Rationale",
        "",
        "Auth rationale.",
        "",
        "## Consequences",
        "",
        "Auth consequences."
      ].join("\n")
    })
  });

  assert.equal(current.status, 200);
  const currentPayload = await current.json();
  assert.equal(currentPayload.valid, true);
});

test("mimir-api accepts centrally issued actor tokens for registered actors", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-api-issued-token-"));
  const { createMimirApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")
    ).href
  );
  const { issueActorAccessToken } = await import(
    pathToFileURL(
      path.join(process.cwd(), "packages", "infrastructure", "dist", "index.js")
    ).href
  );

  const issuerSecret = "issued-token-secret";
  const api = createMimirApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "mimisbrunnr.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 0,
    logLevel: "error",
    auth: {
      mode: "enforced",
      allowAnonymousInternal: true,
      actorRegistry: [
        {
          actorId: "validate-note-http",
          actorRole: "orchestrator",
          source: "mimir-api",
          allowedTransports: ["http"],
          allowedCommands: ["validate_note"]
        }
      ],
      issuerSecret,
      issuedTokenRequireRegistryMatch: true
    }
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();
  const baseUrl = apiBaseUrl(api);

  const issuedToken = issueActorAccessToken(
    {
      actorId: "validate-note-http",
      actorRole: "orchestrator",
      source: "mimir-api",
      allowedTransports: ["http"],
      allowedCommands: ["validate_note"],
      validUntil: new Date(Date.now() + 3_600_000).toISOString(),
      issuedAt: new Date().toISOString()
    },
    issuerSecret
  );

  const response = await fetch(`${baseUrl}/v1/notes/validate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mimir-actor-token": issuedToken
    },
    body: JSON.stringify({
      actor: {
        actorId: "validate-note-http",
        actorRole: "orchestrator",
        source: "mimir-api",
        authToken: issuedToken
      },
      targetCorpus: "mimisbrunnr",
      notePath: "mimisbrunnr/decision/issued-token-note.md",
      validationMode: "promotion",
      frontmatter: {
        noteId: randomUUID(),
        title: "Issued Token Note",
        project: "mimir",
        type: "decision",
        status: "promoted",
        updated: currentDateIso(),
        summary: "Issued tokens should work for registered operators.",
        tags: ["project/mimir", "domain/orchestration", "status/promoted"],
        scope: "auth",
        corpusId: "mimisbrunnr",
        currentState: false
      },
      body: [
        "## Context",
        "",
        "Issued-token auth context.",
        "",
        "## Decision",
        "",
        "Issued-token auth decision.",
        "",
        "## Rationale",
        "",
        "Issued-token auth rationale.",
        "",
        "## Consequences",
        "",
        "Issued-token auth consequences."
      ].join("\n")
    })
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.valid, true);
});

test("mimir-api lists and reads namespace nodes through the shared context namespace service", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-api-namespace-"));
  const { createMimirApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")
    ).href
  );

  const api = createMimirApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "mimisbrunnr.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 0,
    logLevel: "error"
  });

  const canonical = await seedCanonicalTemporalNote(root, {
    title: "API Namespace Canonical Node",
    scope: "api-namespace",
    validFrom: addDaysIso(currentDateIso(), -14),
    validUntil: addDaysIso(currentDateIso(), 14)
  });
  const staging = await seedStagingDraft(root, {
    title: "API Namespace Staging Node",
    scope: "api-namespace"
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();
  const baseUrl = apiBaseUrl(api);

  const treeResponse = await fetch(`${baseUrl}/v1/context/tree`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      ownerScope: "mimisbrunnr",
      authorityStates: ["canonical", "staging"]
    })
  });

  assert.equal(treeResponse.status, 200);
  const treePayload = await treeResponse.json();
  assert.equal(treePayload.ok, true);
  assert.ok(
    treePayload.data.nodes.some(
      (node) =>
        node.uri === `mimir://mimisbrunnr/note/${canonical.noteId}` &&
        node.authorityState === "canonical"
    )
  );
  assert.ok(
    treePayload.data.nodes.some(
      (node) =>
        node.uri === `mimir://mimisbrunnr/note/${staging.draftNoteId}` &&
        node.authorityState === "staging"
    )
  );

  const nodeResponse = await fetch(`${baseUrl}/v1/context/node`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      uri: `mimir://mimisbrunnr/note/${canonical.noteId}`
    })
  });

  assert.equal(nodeResponse.status, 200);
  const nodePayload = await nodeResponse.json();
  assert.equal(nodePayload.ok, true);
  assert.equal(nodePayload.data.node.uri, `mimir://mimisbrunnr/note/${canonical.noteId}`);
  assert.equal(nodePayload.data.node.authorityState, "canonical");
});

test("mimir-api exposes coding execution through the root orchestrator", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-api-coding-"));
  const repoRoot = path.join(root, "repo");
  await fsMkdir(path.join(repoRoot, ".git"), { recursive: true });
  await fsMkdir(path.join(repoRoot, "src"), { recursive: true });
  await writeFile(
    path.join(repoRoot, "src", "foo.py"),
    'def greet(name: str) -> str:\n    return f"Hello, {name}"\n',
    "utf8"
  );
  const { createMimirApiServer } = await import(
    pathToFileURL(path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")).href
  );

  const api = createMimirApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "mimisbrunnr.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    providerEndpoints: {
      dockerOllamaBaseUrl: "http://127.0.0.1:1"
    },
    apiHost: "127.0.0.1",
    apiPort: 0,
    logLevel: "error"
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();
  const baseUrl = apiBaseUrl(api);

  const response = await fetch(`${baseUrl}/v1/coding/execute`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      taskType: "propose_fix",
      task: "Fix the writer promotion bug.",
      context: "The bug affects writer promotion.",
      repoRoot,
      filePath: "src/foo.py"
    })
  });

  assert.equal(response.status, 422);
  const payload = await response.json();
  assert.equal(payload.status, "fail");
  assert.doesNotMatch(payload.reason, /allowed_patch_root|LOCAL_EXPERT_REPO_ROOT/i);
});

function cliEnvironment(root, overrides = {}) {
  return {
    ...process.env,
    MAB_NODE_ENV: "test",
    MAB_VAULT_ROOT: path.join(root, "vault", "canonical"),
    MAB_STAGING_ROOT: path.join(root, "vault", "staging"),
    MAB_SQLITE_PATH: path.join(root, "state", "mimisbrunnr.sqlite"),
    MAB_QDRANT_URL: "http://127.0.0.1:6333",
    MAB_QDRANT_COLLECTION: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    MAB_EMBEDDING_PROVIDER: "hash",
    MAB_REASONING_PROVIDER: "heuristic",
    MAB_DRAFTING_PROVIDER: "disabled",
    MAB_RERANKER_PROVIDER: "local",
    MAB_LOG_LEVEL: "error",
    ...overrides
  };
}

function buildCliAdminActor(overrides = {}) {
  return {
    actorId: "operator-cli",
    actorRole: "operator",
    source: "mimir-cli-admin",
    authToken: "current-operator-token",
    ...overrides
  };
}

function buildCliAdminRegistryEntry(allowedAdminActions, overrides = {}) {
  return {
    actorId: "operator-cli",
    actorRole: "operator",
    source: "mimir-cli-admin",
    allowedTransports: ["cli"],
    allowedAdminActions,
    authTokens: [
      {
        token: "current-operator-token",
        validUntil: new Date(Date.now() + 3_600_000).toISOString()
      }
    ],
    ...overrides
  };
}

function runNodeCommand(scriptPath, args, env, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function apiBaseUrl(api) {
  const address = api.server.address();
  assert.ok(address && typeof address === "object" && typeof address.port === "number");
  return `http://127.0.0.1:${address.port}`;
}

function currentDateIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(dateIso, days) {
  const date = new Date(`${dateIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function seedTemporalValidityNote(sqlitePath, input) {
  const { SqliteMetadataControlStore } = await import(
    pathToFileURL(
      path.join(process.cwd(), "packages", "infrastructure", "dist", "index.js")
    ).href
  );
  const store = new SqliteMetadataControlStore(sqlitePath);

  try {
    await store.upsertNote({
      noteId: input.noteId,
      corpusId: "mimisbrunnr",
      notePath: input.notePath,
      noteType: "reference",
      lifecycleState: "promoted",
      revision: currentDateIso(),
      updatedAt: currentDateIso(),
      currentState: true,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      summary: input.summary,
      scope: "temporal-validity",
      tags: ["project/mimir", "status/current"],
      contentHash: `sha256:${input.noteId}`,
      semanticSignature: input.noteId
    });
  } finally {
    store.close();
  }
}

async function seedCanonicalTemporalNote(root, input) {
  const [seeded] = await seedCanonicalTemporalNotes(root, [input]);
  return seeded;
}

async function seedCanonicalTemporalNotes(root, inputs) {
  const { buildServiceContainer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "packages", "infrastructure", "dist", "index.js")
    ).href
  );

  const container = buildServiceContainer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "mimisbrunnr.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    logLevel: "error"
  });
  try {
    const seeded = [];
    for (const input of inputs) {
      const draft = await container.services.stagingDraftService.createDraft({
        actor: testActor("writer"),
        targetCorpus: "mimisbrunnr",
        noteType: "reference",
        title: input.title,
        sourcePrompt: `Refresh seed for ${input.title}`,
        supportingSources: [],
        bodyHints: [
          `This canonical note exists only to exercise the refresh workflow for ${input.title}.`,
          `It should become a governed staging refresh draft for scope ${input.scope} when its validity expires.`
        ],
        frontmatterOverrides: {
          scope: input.scope,
          validFrom: input.validFrom,
          validUntil: input.validUntil
        }
      });

      assert.equal(draft.ok, true);

      const promoted = await container.services.promotionOrchestratorService.promoteDraft({
        actor: testActor("orchestrator"),
        draftNoteId: draft.data.draftNoteId,
        targetCorpus: "mimisbrunnr",
        promoteAsCurrentState: true
      });

      assert.equal(promoted.ok, true);
      seeded.push({ noteId: promoted.data.promotedNoteId });
    }

    return seeded;
  } finally {
    container.dispose();
  }
}

async function seedStagingDraft(root, input) {
  const { buildServiceContainer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "packages", "infrastructure", "dist", "index.js")
    ).href
  );

  const container = buildServiceContainer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "mimisbrunnr.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    logLevel: "error"
  });

  try {
    const draft = await container.services.stagingDraftService.createDraft({
      actor: testActor("writer"),
      targetCorpus: "mimisbrunnr",
      noteType: "reference",
      title: input.title,
      sourcePrompt: `Seed staging draft for ${input.title}`,
      supportingSources: [],
      bodyHints: [
        `This staging draft exists only to exercise the namespace browse surface for ${input.title}.`,
        `It should remain a staging authority node for scope ${input.scope}.`
      ],
      frontmatterOverrides: {
        scope: input.scope
      }
    });

    assert.equal(draft.ok, true);
    return { draftNoteId: draft.data.draftNoteId };
  } finally {
    container.dispose();
  }
}

function testActor(role) {
  return {
    actorId: `${role}-actor`,
    actorRole: role,
    transport: "internal",
    source: "transport-test-seed",
    requestId: randomUUID(),
    initiatedAt: new Date().toISOString(),
    toolName: "seed"
  };
}
