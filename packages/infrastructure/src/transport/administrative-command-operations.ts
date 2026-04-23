import type { ActorContext } from "@mimir/contracts";
import { issueActorAccessToken } from "@mimir/orchestration";
import type { ServiceContainer } from "../bootstrap/build-service-container.js";
import { FileIssuedTokenRevocationStore } from "../auth/file-issued-token-revocation-store.js";
import { SqliteAuthIssuerControlStore } from "../sqlite/sqlite-auth-issuer-control-store.js";
import { recordIssuedAuthTokenAudit, recordRevokedAuthTokenAudit } from "./auth-control-audit.js";
import { executeBulkIssuedTokenRevocation } from "./auth-control-bulk-revocation.js";
import {
  AuthIssuerLifecycleService,
  type ListAuthIssuerControlsRequest,
  type SetAuthIssuerStateRequest
} from "./auth-control-issuer-lifecycle.js";
import type {
  InspectActorTokenControlRequest,
  IssueActorTokenControlRequest,
  ListIssuedActorTokensControlRequest,
  RevokeActorTokenControlRequest,
  RevokeIssuedActorTokensControlRequest
} from "./auth-control-validation.js";
import type { FreshnessStatusRequest } from "./administrative-command-inputs.js";
import { TransportValidationError } from "./transport-validation-error.js";

export function getAdministrativeAuthStatus(
  container: ServiceContainer,
  administrativeActor: ActorContext
): {
  ok: true;
  auth: ReturnType<ServiceContainer["authPolicy"]["getRegistrySummary"]>;
  issuedTokens: ReturnType<ServiceContainer["ports"]["issuedTokenStore"]["getIssuedTokenSummary"]>;
} {
  container.authPolicy.authorizeAdministrativeAction(
    "view_auth_status",
    administrativeActor
  );

  return {
    ok: true,
    auth: container.authPolicy.getRegistrySummary(),
    issuedTokens: container.ports.issuedTokenStore.getIssuedTokenSummary()
  };
}

export async function listAdministrativeAuthIssuers(
  container: ServiceContainer,
  administrativeActor: ActorContext,
  request: ListAuthIssuerControlsRequest = {}
): Promise<{
  ok: true;
  asOf: string;
  summary: ReturnType<AuthIssuerLifecycleService["listIssuerControls"]>["summary"];
  issuers: ReturnType<AuthIssuerLifecycleService["listIssuerControls"]>["issuers"];
}> {
  container.authPolicy.authorizeAdministrativeAction(
    "view_auth_issuers",
    administrativeActor
  );

  return withAuthIssuerLifecycleService(container, async (issuerLifecycleService) => ({
    ok: true,
    ...issuerLifecycleService.listIssuerControls(request)
  }));
}

export function listAdministrativeIssuedTokens(
  container: ServiceContainer,
  administrativeActor: ActorContext,
  request: ListIssuedActorTokensControlRequest = {}
): {
  ok: true;
  issuedTokens: ReturnType<ServiceContainer["ports"]["issuedTokenStore"]["listIssuedTokens"]>;
  summary: ReturnType<ServiceContainer["ports"]["issuedTokenStore"]["getIssuedTokenSummary"]>;
} {
  container.authPolicy.authorizeAdministrativeAction(
    "view_issued_tokens",
    administrativeActor
  );

  return {
    ok: true,
    issuedTokens: container.ports.issuedTokenStore.listIssuedTokens(request),
    summary: container.ports.issuedTokenStore.getIssuedTokenSummary(request)
  };
}

export async function issueAdministrativeAuthToken(
  container: ServiceContainer,
  administrativeActor: ActorContext,
  request: IssueActorTokenControlRequest,
  options: {
    commandLabel: string;
  }
): Promise<{
  ok: true;
  issuedToken: string;
  claims: IssueActorTokenControlRequest & { issuedAt: string; validUntil?: string };
  warnings?: string[];
}> {
  return withAuthIssuerLifecycleService(container, async (issuerLifecycleService) => {
    container.authPolicy.authorizeAdministrativeAction(
      "issue_auth_token",
      administrativeActor
    );
    issuerLifecycleService.assertAdministrativeActionAllowed(
      administrativeActor,
      "issue_auth_token"
    );

    const issuerSecret = requireIssuerSecret(container.env.auth.issuerSecret);
    const issuedAt = new Date().toISOString();
    const validUntil =
      request.validUntil ??
      (request.ttlMinutes !== undefined
        ? new Date(Date.now() + request.ttlMinutes * 60_000).toISOString()
        : undefined);

    const issuedToken = issueActorAccessToken(
      {
        actorId: request.actorId,
        actorRole: request.actorRole,
        source: request.source,
        allowedTransports: request.allowedTransports,
        allowedCommands: request.allowedCommands,
        allowedAdminActions: request.allowedAdminActions,
        allowedCorpora: request.allowedCorpora,
        validFrom: request.validFrom,
        validUntil,
        issuedAt
      },
      issuerSecret
    );

    const warnings: string[] = [];
    const inspection = container.authPolicy.inspectToken(issuedToken);
    if (inspection.tokenKind === "issued" && inspection.claims?.tokenId) {
      container.ports.issuedTokenStore.recordIssuedToken(inspection.claims, {
        issuedBy: {
          actorId: administrativeActor.actorId,
          actorRole: administrativeActor.actorRole,
          source: administrativeActor.source,
          transport: administrativeActor.transport
        }
      });
      warnings.push(
        ...(await recordIssuedAuthTokenAudit({
          auditHistoryService: container.services.auditHistoryService,
          administrativeActor,
          tokenId: inspection.claims.tokenId,
          targetActorId: request.actorId,
          targetActorRole: request.actorRole,
          targetSource: request.source,
          command: options.commandLabel,
          validFrom: request.validFrom,
          validUntil,
          hasAllowedCommands: (request.allowedCommands?.length ?? 0) > 0,
          hasAllowedAdminActions: (request.allowedAdminActions?.length ?? 0) > 0,
          hasAllowedCorpora: (request.allowedCorpora?.length ?? 0) > 0
        })).warnings
      );
    }

    return {
      ok: true,
      issuedToken,
      claims: {
        ...request,
        issuedAt,
        validUntil
      },
      ...(warnings.length > 0 ? { warnings } : {})
    };
  });
}

export function inspectAdministrativeAuthToken(
  container: ServiceContainer,
  administrativeActor: ActorContext,
  request: InspectActorTokenControlRequest
): {
  ok: true;
  inspection: ReturnType<ServiceContainer["authPolicy"]["inspectToken"]>;
} {
  container.authPolicy.authorizeAdministrativeAction(
    "inspect_auth_token",
    administrativeActor
  );

  return {
    ok: true,
    inspection: container.authPolicy.inspectToken(request.token, {
      asOf: request.asOf,
      expectedTransport: request.expectedTransport,
      expectedCommand: request.expectedCommand,
      expectedAdministrativeAction: request.expectedAdministrativeAction
    })
  };
}

export async function revokeAdministrativeAuthToken(
  container: ServiceContainer,
  administrativeActor: ActorContext,
  request: RevokeActorTokenControlRequest,
  options: {
    commandLabel: string;
  }
): Promise<{
  ok: true;
  revokedTokenId: string;
  alreadyRevoked: boolean;
  persisted: boolean;
  recordedTokenFound: boolean;
  reason?: string;
  warnings?: string[];
}> {
  return withAuthIssuerLifecycleService(container, async (issuerLifecycleService) => {
    container.authPolicy.authorizeAdministrativeAction(
      "revoke_auth_token",
      administrativeActor
    );
    issuerLifecycleService.assertAdministrativeActionAllowed(
      administrativeActor,
      "revoke_auth_token"
    );

    const revocationStore = await FileIssuedTokenRevocationStore.create(
      requireIssuedTokenRevocationPath(
        container.env.auth.issuedTokenRevocationPath
      ),
      container.authPolicy.getRevokedIssuedTokenIds()
    );
    const tokenId = resolveIssuedTokenIdForRevocation(
      request,
      container.authPolicy
    );
    const revocation = await revocationStore.revokeTokenId(tokenId);
    container.authPolicy.revokeIssuedTokenId(tokenId);
    const ledgerRevocation = container.ports.issuedTokenStore.markTokenRevoked(
      tokenId,
      {
        reason: request.reason,
        revokedBy: {
          actorId: administrativeActor.actorId,
          actorRole: administrativeActor.actorRole,
          source: administrativeActor.source,
          transport: administrativeActor.transport
        }
      }
    );
    const warnings = (
      await recordRevokedAuthTokenAudit({
        auditHistoryService: container.services.auditHistoryService,
        administrativeActor,
        tokenId,
        command: options.commandLabel,
        reason: request.reason,
        alreadyRevoked: revocation.alreadyRevoked,
        persisted: revocation.persisted,
        recordedTokenFound: ledgerRevocation.found
      })
    ).warnings;

    return {
      ok: true,
      revokedTokenId: tokenId,
      alreadyRevoked: revocation.alreadyRevoked,
      persisted: revocation.persisted,
      recordedTokenFound: ledgerRevocation.found,
      reason: request.reason,
      ...(warnings.length > 0 ? { warnings } : {})
    };
  });
}

export async function revokeAdministrativeAuthTokens(
  container: ServiceContainer,
  administrativeActor: ActorContext,
  request: RevokeIssuedActorTokensControlRequest,
  options: {
    commandLabel: string;
  }
): Promise<{
  ok: true;
  dryRun: boolean;
  matchedCount: number;
  revokedCount: number;
  alreadyRevokedCount: number;
  candidates: Awaited<ReturnType<typeof executeBulkIssuedTokenRevocation>>["candidates"];
  warnings?: string[];
}> {
  return withAuthIssuerLifecycleService(container, async (issuerLifecycleService) => {
    container.authPolicy.authorizeAdministrativeAction(
      "revoke_auth_tokens",
      administrativeActor
    );
    issuerLifecycleService.assertAdministrativeActionAllowed(
      administrativeActor,
      "revoke_auth_tokens"
    );

    const revocationStore = request.dryRun
      ? undefined
      : await FileIssuedTokenRevocationStore.create(
          requireIssuedTokenRevocationPath(
            container.env.auth.issuedTokenRevocationPath
          ),
          container.authPolicy.getRevokedIssuedTokenIds()
        );
    const result = await executeBulkIssuedTokenRevocation({
      request,
      issuedTokenStore: container.ports.issuedTokenStore,
      authPolicy: container.authPolicy,
      administrativeActor,
      auditHistoryService: container.services.auditHistoryService,
      command: options.commandLabel,
      revocationStore
    });

    return {
      ok: true,
      ...result
    };
  });
}

export async function setAdministrativeAuthIssuerState(
  container: ServiceContainer,
  administrativeActor: ActorContext,
  request: SetAuthIssuerStateRequest
): Promise<{
  ok: true;
  issuer: Awaited<ReturnType<AuthIssuerLifecycleService["setIssuerState"]>>;
}> {
  container.authPolicy.authorizeAdministrativeAction(
    "manage_auth_issuers",
    administrativeActor
  );

  return withAuthIssuerLifecycleService(container, async (issuerLifecycleService) => ({
    ok: true,
    issuer: await issuerLifecycleService.setIssuerState(
      request,
      administrativeActor
    )
  }));
}

export async function getAdministrativeFreshnessStatus(
  container: ServiceContainer,
  administrativeActor: ActorContext,
  request: FreshnessStatusRequest
): Promise<{
  ok: true;
  freshness: Awaited<ReturnType<ServiceContainer["ports"]["metadataControlStore"]["getTemporalValidityReport"]>>;
}> {
  container.authPolicy.authorizeAdministrativeAction(
    "view_freshness_status",
    administrativeActor
  );

  return {
    ok: true,
    freshness: await container.ports.metadataControlStore.getTemporalValidityReport(
      request
    )
  };
}

async function withAuthIssuerLifecycleService<T>(
  container: ServiceContainer,
  callback: (issuerLifecycleService: AuthIssuerLifecycleService) => Promise<T>
): Promise<T> {
  const issuerControlStore = new SqliteAuthIssuerControlStore(
    container.env.sqlitePath
  );
  const issuerLifecycleService = new AuthIssuerLifecycleService(
    container.authPolicy,
    issuerControlStore,
    container.services.auditHistoryService
  );

  try {
    return await callback(issuerLifecycleService);
  } finally {
    issuerControlStore.close();
  }
}

function requireIssuerSecret(value?: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new TransportValidationError(
      "Invalid auth control field 'issuerSecret': MAB_AUTH_ISSUER_SECRET must be configured to issue actor access tokens.",
      {
        field: "issuerSecret",
        problem:
          "MAB_AUTH_ISSUER_SECRET must be configured to issue actor access tokens"
      }
    );
  }

  return normalized;
}

function requireIssuedTokenRevocationPath(filePath?: string): string {
  const normalized = filePath?.trim();
  if (!normalized) {
    throw new TransportValidationError(
      "Invalid auth control field 'revocationStore': MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_PATH must be configured to revoke actor access tokens.",
      {
        field: "revocationStore",
        problem:
          "MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_PATH must be configured to revoke actor access tokens"
      }
    );
  }

  return normalized;
}

function resolveIssuedTokenIdForRevocation(
  request: RevokeActorTokenControlRequest,
  authPolicy: ServiceContainer["authPolicy"]
): string {
  if (request.tokenId) {
    return request.tokenId;
  }

  const inspection = authPolicy.inspectToken(request.token ?? "");
  if (inspection.tokenKind !== "issued" || !inspection.claims?.tokenId) {
    throw new TransportValidationError(
      "Invalid auth control field 'token': must be a valid issued actor token.",
      {
        field: "token",
        problem: "must be a valid issued actor token"
      }
    );
  }

  return inspection.claims.tokenId;
}
