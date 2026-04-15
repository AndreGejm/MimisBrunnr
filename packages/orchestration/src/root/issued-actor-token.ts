import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { ActorRole, TransportKind } from "@mimir/contracts";
import type { OrchestratorCommand } from "../routing/task-family-router.js";
import type { AdministrativeAction } from "./administrative-action.js";

const TOKEN_PREFIX = "mab1";

export interface IssuedActorTokenClaims {
  tokenId?: string;
  actorId: string;
  actorRole: ActorRole;
  source?: string;
  allowedTransports?: TransportKind[];
  allowedCommands?: OrchestratorCommand[];
  allowedAdminActions?: AdministrativeAction[];
  allowedCorpora?: string[];
  validFrom?: string;
  validUntil?: string;
  issuedAt: string;
}

export function issueActorAccessToken(
  claims: IssuedActorTokenClaims,
  issuerSecret: string
): string {
  const normalizedClaims = normalizeClaims({
    ...claims,
    tokenId: claims.tokenId?.trim() || randomUUID()
  });
  const payload = Buffer.from(JSON.stringify(normalizedClaims), "utf8").toString(
    "base64url"
  );
  const signature = signPayload(payload, issuerSecret);
  return `${TOKEN_PREFIX}.${payload}.${signature}`;
}

export function verifyActorAccessToken(
  token: string,
  issuerSecret: string
): IssuedActorTokenClaims {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
    throw new Error("Actor access token is malformed.");
  }

  const [, payload, signature] = parts;
  const expectedSignature = signPayload(payload, issuerSecret);
  const actualBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error("Actor access token signature is invalid.");
  }

  const parsed = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8")
  ) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Actor access token payload is invalid.");
  }

  return normalizeClaims(parsed as IssuedActorTokenClaims);
}

function normalizeClaims(claims: IssuedActorTokenClaims): IssuedActorTokenClaims {
  return {
    tokenId: claims.tokenId?.trim() || undefined,
    actorId: claims.actorId.trim(),
    actorRole: claims.actorRole,
    source: claims.source?.trim() || undefined,
    allowedTransports: claims.allowedTransports?.length
      ? [...claims.allowedTransports]
      : undefined,
    allowedCommands: claims.allowedCommands?.length
      ? [...claims.allowedCommands]
      : undefined,
    allowedAdminActions: claims.allowedAdminActions?.length
      ? [...claims.allowedAdminActions]
      : undefined,
    allowedCorpora: claims.allowedCorpora?.length
      ? [...claims.allowedCorpora]
      : undefined,
    validFrom: claims.validFrom?.trim() || undefined,
    validUntil: claims.validUntil?.trim() || undefined,
    issuedAt: claims.issuedAt.trim()
  };
}

function signPayload(payload: string, issuerSecret: string): string {
  return createHmac("sha256", issuerSecret).update(payload).digest("base64url");
}
