import type { AuditHistoryService } from "@mimir/application";
import type { ActorContext } from "@mimir/contracts";

interface AuthControlAuditResult {
  warnings: string[];
}

interface RecordIssuedAuthTokenAuditInput {
  auditHistoryService: AuditHistoryService;
  administrativeActor: ActorContext;
  tokenId: string;
  targetActorId: string;
  targetActorRole: string;
  targetSource?: string;
  command: string;
  validFrom?: string;
  validUntil?: string;
  hasAllowedCommands: boolean;
  hasAllowedAdminActions: boolean;
  hasAllowedCorpora: boolean;
}

interface RecordAuthIssuerControlAuditInput {
  auditHistoryService: AuditHistoryService;
  administrativeActor: ActorContext;
  targetActorId: string;
  targetActorRole: string;
  enabled: boolean;
  allowIssueAuthToken: boolean;
  allowRevokeAuthToken: boolean;
  validFrom?: string;
  validUntil?: string;
  reason?: string;
}

interface RecordRevokedAuthTokenAuditInput {
  auditHistoryService: AuditHistoryService;
  administrativeActor: ActorContext;
  tokenId: string;
  command: string;
  reason?: string;
  alreadyRevoked: boolean;
  persisted: boolean;
  recordedTokenFound: boolean;
  bulkSelection?: Record<string, unknown>;
  matchedCount?: number;
}

export async function recordIssuedAuthTokenAudit(
  input: RecordIssuedAuthTokenAuditInput
): Promise<AuthControlAuditResult> {
  const recorded = await input.auditHistoryService.recordAction({
    actionType: "issue_auth_token",
    actorId: input.administrativeActor.actorId,
    actorRole: input.administrativeActor.actorRole,
    source: input.administrativeActor.source,
    toolName: input.administrativeActor.toolName,
    occurredAt: new Date().toISOString(),
    outcome: "accepted",
    affectedNoteIds: [],
    affectedChunkIds: [],
    detail: compactDetail({
      tokenId: input.tokenId,
      targetActorId: input.targetActorId,
      targetActorRole: input.targetActorRole,
      targetSource: input.targetSource,
      transport: input.administrativeActor.transport,
      command: input.command,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      hasAllowedCommands: input.hasAllowedCommands,
      hasAllowedAdminActions: input.hasAllowedAdminActions,
      hasAllowedCorpora: input.hasAllowedCorpora
    })
  });

  return recorded.ok
    ? { warnings: [] }
    : { warnings: [recorded.error.message] };
}

export async function recordAuthIssuerControlAudit(
  input: RecordAuthIssuerControlAuditInput
): Promise<AuthControlAuditResult> {
  const recorded = await input.auditHistoryService.recordAction({
    actionType: "manage_auth_issuers",
    actorId: input.administrativeActor.actorId,
    actorRole: input.administrativeActor.actorRole,
    source: input.administrativeActor.source,
    toolName: input.administrativeActor.toolName,
    occurredAt: new Date().toISOString(),
    outcome: "accepted",
    affectedNoteIds: [],
    affectedChunkIds: [],
    detail: compactDetail({
      targetActorId: input.targetActorId,
      targetActorRole: input.targetActorRole,
      enabled: input.enabled,
      allowIssueAuthToken: input.allowIssueAuthToken,
      allowRevokeAuthToken: input.allowRevokeAuthToken,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      reason: input.reason,
      transport: input.administrativeActor.transport
    })
  });

  return recorded.ok
    ? { warnings: [] }
    : { warnings: [recorded.error.message] };
}

export async function recordRevokedAuthTokenAudit(
  input: RecordRevokedAuthTokenAuditInput
): Promise<AuthControlAuditResult> {
  const recorded = await input.auditHistoryService.recordAction({
    actionType: "revoke_auth_token",
    actorId: input.administrativeActor.actorId,
    actorRole: input.administrativeActor.actorRole,
    source: input.administrativeActor.source,
    toolName: input.administrativeActor.toolName,
    occurredAt: new Date().toISOString(),
    outcome: "accepted",
    affectedNoteIds: [],
    affectedChunkIds: [],
    detail: compactDetail({
      tokenId: input.tokenId,
      reason: input.reason,
      transport: input.administrativeActor.transport,
      command: input.command,
      alreadyRevoked: input.alreadyRevoked,
      persisted: input.persisted,
      recordedTokenFound: input.recordedTokenFound,
      bulkSelection: input.bulkSelection,
      matchedCount: input.matchedCount
    })
  });

  return recorded.ok
    ? { warnings: [] }
    : { warnings: [recorded.error.message] };
}

function compactDetail(
  detail: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(detail).filter(([, value]) => value !== undefined)
  );
}
