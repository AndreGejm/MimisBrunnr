import type { ActorContext } from "@mimir/contracts";
import type { ActorAuthorizationPolicy } from "@mimir/orchestration";
import { FileIssuedTokenRevocationStore } from "../auth/file-issued-token-revocation-store.js";
import type { AuditHistoryService } from "@mimir/application";
import type { IssuedTokenLifecycleRecord, SqliteIssuedTokenStore } from "../sqlite/sqlite-issued-token-store.js";
import type { RevokeIssuedActorTokensControlRequest } from "./auth-control-validation.js";
import { recordRevokedAuthTokenAudit } from "./auth-control-audit.js";

export interface BulkRevokedIssuedTokenCandidate {
  tokenId: string;
  actorId: string;
  actorRole: IssuedTokenLifecycleRecord["actorRole"];
  source?: string;
  lifecycleStatus: IssuedTokenLifecycleRecord["lifecycleStatus"];
  issuedByActorId?: string;
  revokedAt?: string;
  revokedByActorId?: string;
  revokedReason?: string;
}

export interface BulkRevokedIssuedTokensResult {
  dryRun: boolean;
  matchedCount: number;
  revokedCount: number;
  alreadyRevokedCount: number;
  candidates: BulkRevokedIssuedTokenCandidate[];
  warnings?: string[];
}

interface ExecuteBulkIssuedTokenRevocationInput {
  request: RevokeIssuedActorTokensControlRequest;
  issuedTokenStore: SqliteIssuedTokenStore;
  authPolicy: ActorAuthorizationPolicy;
  administrativeActor: ActorContext;
  auditHistoryService: AuditHistoryService;
  command: string;
  revocationStore?: FileIssuedTokenRevocationStore;
}

export async function executeBulkIssuedTokenRevocation(
  input: ExecuteBulkIssuedTokenRevocationInput
): Promise<BulkRevokedIssuedTokensResult> {
  const matches = input.issuedTokenStore.listIssuedTokens(input.request);
  if (input.request.dryRun) {
    return {
      dryRun: true,
      matchedCount: matches.length,
      revokedCount: 0,
      alreadyRevokedCount: 0,
      candidates: matches.map((record) => mapBulkRevocationCandidate(record))
    };
  }

  if (!input.revocationStore) {
    throw new Error("A revocation store is required to revoke issued actor tokens.");
  }

  const warnings = new Set<string>();
  const candidates: BulkRevokedIssuedTokenCandidate[] = [];
  let revokedCount = 0;
  let alreadyRevokedCount = 0;
  const bulkSelection = compactDetail({
    actorId: input.request.actorId,
    issuedByActorId: input.request.issuedByActorId,
    revokedByActorId: input.request.revokedByActorId,
    lifecycleStatus: input.request.lifecycleStatus
  });

  for (const record of matches) {
    const revocation = await input.revocationStore.revokeTokenId(record.tokenId);
    input.authPolicy.revokeIssuedTokenId(record.tokenId);
    const ledgerRevocation = input.issuedTokenStore.markTokenRevoked(record.tokenId, {
      reason: input.request.reason,
      revokedBy: {
        actorId: input.administrativeActor.actorId,
        actorRole: input.administrativeActor.actorRole,
        source: input.administrativeActor.source,
        transport: input.administrativeActor.transport
      }
    });
    const alreadyRevoked =
      revocation.alreadyRevoked || ledgerRevocation.alreadyRevoked;

    if (alreadyRevoked) {
      alreadyRevokedCount += 1;
    } else {
      revokedCount += 1;
    }

    const auditResult = await recordRevokedAuthTokenAudit({
      auditHistoryService: input.auditHistoryService,
      administrativeActor: input.administrativeActor,
      tokenId: record.tokenId,
      command: input.command,
      reason: input.request.reason,
      alreadyRevoked,
      persisted: revocation.persisted,
      recordedTokenFound: ledgerRevocation.found,
      bulkSelection,
      matchedCount: matches.length
    });

    for (const warning of auditResult.warnings) {
      warnings.add(warning);
    }

    candidates.push(
      alreadyRevoked
        ? mapBulkRevocationCandidate(record)
        : {
            ...mapBulkRevocationCandidate(record),
            lifecycleStatus: "revoked",
            revokedAt: new Date().toISOString(),
            revokedByActorId: input.administrativeActor.actorId,
            revokedReason: input.request.reason
          }
    );
  }

  return {
    dryRun: false,
    matchedCount: matches.length,
    revokedCount,
    alreadyRevokedCount,
    candidates,
    ...(warnings.size > 0 ? { warnings: [...warnings] } : {})
  };
}

function mapBulkRevocationCandidate(
  record: IssuedTokenLifecycleRecord
): BulkRevokedIssuedTokenCandidate {
  return {
    tokenId: record.tokenId,
    actorId: record.actorId,
    actorRole: record.actorRole,
    source: record.source,
    lifecycleStatus: record.lifecycleStatus,
    issuedByActorId: record.issuedByActorId,
    revokedAt: record.revokedAt,
    revokedByActorId: record.revokedByActorId,
    revokedReason: record.revokedReason
  };
}

function compactDetail(
  detail: Record<string, unknown>
): Record<string, unknown> | undefined {
  const entries = Object.entries(detail).filter(([, value]) => value !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
