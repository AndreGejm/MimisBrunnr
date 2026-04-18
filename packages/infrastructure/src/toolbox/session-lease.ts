import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  ActorContext,
  CompiledToolboxPolicy,
  RuntimeCommandToolboxPolicy,
  RuntimeCliCommandName,
  ToolboxSessionLeaseClaims
} from "@mimir/contracts";
import {
  getRuntimeCommandToolboxPolicy
} from "@mimir/contracts";
import { SqliteToolboxSessionLeaseStore } from "../sqlite/sqlite-toolbox-session-lease-store.js";

const TOKEN_PREFIX = "mabtl1";

export interface ToolboxSessionPolicyEnforcerOptions {
  policy?: CompiledToolboxPolicy;
  activeProfileId?: string;
  clientId?: string;
  enforcementMode: "off" | "audit" | "enforced";
  issuer: string;
  audience: string;
  issuerSecret?: string;
  leaseStore?: SqliteToolboxSessionLeaseStore;
  clockSkewToleranceMs?: number;
}

export class ToolboxSessionPolicyError extends Error {
  constructor(
    readonly code: "unauthorized" | "forbidden",
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ToolboxSessionPolicyError";
  }

  toServiceError() {
    return {
      code: this.code,
      message: this.message,
      details: this.details
    };
  }
}

export class ToolboxSessionPolicyEnforcer {
  constructor(private readonly options: ToolboxSessionPolicyEnforcerOptions) {}

  authorize(command: RuntimeCliCommandName, actor: ActorContext): void {
    if (
      this.options.enforcementMode === "off" ||
      !actor.toolboxSessionMode ||
      actor.toolboxSessionMode === "legacy-direct"
    ) {
      return;
    }

    if (!this.options.policy || !this.options.activeProfileId || !this.options.issuerSecret) {
      if (this.options.enforcementMode === "audit") {
        return;
      }

      throw new ToolboxSessionPolicyError(
        "forbidden",
        "Toolbox session enforcement is enabled, but toolbox policy configuration is incomplete."
      );
    }

    if (!actor.sessionPolicyToken?.trim()) {
      throw new ToolboxSessionPolicyError(
        "unauthorized",
        "Toolbox-scoped sessions must provide a valid session policy token."
      );
    }

    let claims: ToolboxSessionLeaseClaims;
    try {
      claims = verifyToolboxSessionLease(
        actor.sessionPolicyToken,
        this.options.issuerSecret
      );
    } catch (error) {
      throw new ToolboxSessionPolicyError(
        "unauthorized",
        error instanceof Error ? error.message : "Toolbox session lease is invalid."
      );
    }

    if (claims.issuer !== this.options.issuer) {
      throw new ToolboxSessionPolicyError("forbidden", "Session policy issuer mismatch.");
    }
    if (claims.audience !== this.options.audience) {
      throw new ToolboxSessionPolicyError("forbidden", "Session policy audience mismatch.");
    }

    if (
      actor.toolboxProfileId &&
      this.options.activeProfileId &&
      actor.toolboxProfileId !== this.options.activeProfileId
    ) {
      throw new ToolboxSessionPolicyError(
        "forbidden",
        "Actor toolbox profile does not match the active toolbox profile."
      );
    }

    const expectedClientId = actor.toolboxClientId ?? this.options.clientId;
    if (expectedClientId && claims.clientId !== expectedClientId) {
      throw new ToolboxSessionPolicyError("forbidden", "Session policy client binding mismatch.");
    }

    const expectedProfileId = actor.toolboxProfileId ?? this.options.activeProfileId;
    if (claims.approvedProfile !== expectedProfileId) {
      throw new ToolboxSessionPolicyError("forbidden", "Session policy profile binding mismatch.");
    }
    if (claims.approvedProfile !== this.options.activeProfileId) {
      throw new ToolboxSessionPolicyError(
        "forbidden",
        "Session policy does not match the current active toolbox profile."
      );
    }

    if (claims.manifestRevision !== this.options.policy.manifestRevision) {
      throw new ToolboxSessionPolicyError("forbidden", "Session policy manifest revision mismatch.");
    }

    const expectedProfile = this.options.policy.profiles[claims.approvedProfile];
    if (!expectedProfile) {
      throw new ToolboxSessionPolicyError("forbidden", "Approved toolbox profile is unknown.");
    }
    if (claims.profileRevision !== expectedProfile.profileRevision) {
      throw new ToolboxSessionPolicyError("forbidden", "Session policy profile revision mismatch.");
    }

    if (this.options.leaseStore?.isLeaseRevoked(claims.leaseId ?? "")) {
      throw new ToolboxSessionPolicyError("unauthorized", "Session policy token has been revoked.");
    }

    assertLeaseLifecycleClaims(claims, this.options.clockSkewToleranceMs ?? 30_000);

    const commandPolicy = getRuntimeCommandToolboxPolicy(command);
    if (!commandPolicy) {
      return;
    }

    assertCommandPolicySatisfied(command, commandPolicy, claims, this.options.policy);
  }
}

export function issueToolboxSessionLease(
  claims: ToolboxSessionLeaseClaims,
  issuerSecret: string
): string {
  const normalizedClaims = normalizeClaims({
    ...claims,
    leaseId: claims.leaseId?.trim() || randomUUID()
  });
  const payload = Buffer.from(JSON.stringify(normalizedClaims), "utf8").toString(
    "base64url"
  );
  const signature = signPayload(payload, issuerSecret);
  return `${TOKEN_PREFIX}.${payload}.${signature}`;
}

export function verifyToolboxSessionLease(
  token: string,
  issuerSecret: string
): ToolboxSessionLeaseClaims {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
    throw new Error("Toolbox session lease is malformed.");
  }

  const [, payload, signature] = parts;
  const expectedSignature = signPayload(payload, issuerSecret);
  const actualBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error("Toolbox session lease signature is invalid.");
  }

  const parsed = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8")
  ) as ToolboxSessionLeaseClaims;

  return normalizeClaims(parsed);
}

function normalizeClaims(claims: ToolboxSessionLeaseClaims): ToolboxSessionLeaseClaims {
  return {
    version: 1,
    leaseId: claims.leaseId?.trim() || undefined,
    sessionId: claims.sessionId.trim(),
    issuer: claims.issuer.trim(),
    audience: claims.audience.trim(),
    clientId: claims.clientId.trim(),
    approvedProfile: claims.approvedProfile.trim(),
    approvedCategories: [...new Set(claims.approvedCategories.map((value) => value.trim()))].sort(),
    deniedCategories: [...new Set(claims.deniedCategories.map((value) => value.trim()))].sort(),
    trustClass: claims.trustClass.trim(),
    manifestRevision: claims.manifestRevision.trim(),
    profileRevision: claims.profileRevision.trim(),
    issuedAt: claims.issuedAt.trim(),
    expiresAt: claims.expiresAt.trim(),
    nonce: claims.nonce.trim()
  };
}

function signPayload(payload: string, issuerSecret: string): string {
  return createHmac("sha256", issuerSecret).update(payload).digest("base64url");
}

function assertCommandPolicySatisfied(
  command: RuntimeCliCommandName,
  commandPolicy: RuntimeCommandToolboxPolicy,
  claims: ToolboxSessionLeaseClaims,
  policy: CompiledToolboxPolicy
): void {
  const trustClass = policy.trustClasses[claims.trustClass];
  const minimumTrustClass = policy.trustClasses[commandPolicy.minimumTrustClass];
  if (!trustClass || !minimumTrustClass) {
    throw new ToolboxSessionPolicyError("forbidden", "Toolbox trust class policy is incomplete.");
  }

  if (trustClass.level < minimumTrustClass.level) {
    throw new ToolboxSessionPolicyError(
      "forbidden",
      `Toolbox session trust class '${claims.trustClass}' is too weak for '${command}'.`
    );
  }

  for (const category of commandPolicy.allOfCategories) {
    if (!claims.approvedCategories.includes(category) || claims.deniedCategories.includes(category)) {
      throw new ToolboxSessionPolicyError(
        "forbidden",
        `Toolbox session does not allow required category '${category}' for '${command}'.`
      );
    }
  }

  if (commandPolicy.anyOfCategories?.length) {
    const anyMatched = commandPolicy.anyOfCategories.some(
      (category) =>
        claims.approvedCategories.includes(category) &&
        !claims.deniedCategories.includes(category)
    );
    if (!anyMatched) {
      throw new ToolboxSessionPolicyError(
        "forbidden",
        `Toolbox session does not satisfy optional category requirements for '${command}'.`
      );
    }
  }

}

function assertLeaseLifecycleClaims(
  claims: ToolboxSessionLeaseClaims,
  clockSkewToleranceMs: number
): void {
  const issuedAt = Date.parse(claims.issuedAt);
  const expiresAt = Date.parse(claims.expiresAt);
  const now = Date.now();

  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
    throw new ToolboxSessionPolicyError(
      "unauthorized",
      "Toolbox session lease timestamps are invalid."
    );
  }

  if (issuedAt - now > clockSkewToleranceMs) {
    throw new ToolboxSessionPolicyError(
      "unauthorized",
      "Toolbox session lease is not yet valid."
    );
  }

  if (now - expiresAt > clockSkewToleranceMs) {
    throw new ToolboxSessionPolicyError(
      "unauthorized",
      "Toolbox session lease has expired."
    );
  }
}
