import { randomUUID } from "node:crypto";
import type { CompiledToolboxPolicy } from "@mimir/contracts";

export type ToolboxBrokerActivationCause =
  | "bootstrap"
  | "explicit_request"
  | "policy_auto"
  | "deactivation"
  | "idle_timeout"
  | "lease_expired";

export interface ToolboxBrokerSessionState {
  sessionId: string;
  clientId: string;
  runtimeMode: "broker-dynamic";
  activeProfileId: string;
  activeBands: string[];
  activeToolboxId: string | null;
  activationCause: ToolboxBrokerActivationCause;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  activatedAt: string;
  lastToolActivityAt: string | null;
}

export function createToolboxBrokerSessionState(input: {
  policy: CompiledToolboxPolicy;
  activeProfileId: string;
  clientId: string;
}): ToolboxBrokerSessionState {
  const profile = input.policy.profiles[input.activeProfileId];
  if (!profile) {
    throw new Error(`Unknown broker session profile '${input.activeProfileId}'.`);
  }

  const activatedAt = new Date().toISOString();
  return {
    sessionId: `toolbox-broker-${randomUUID()}`,
    clientId: input.clientId,
    runtimeMode: "broker-dynamic",
    activeProfileId: profile.id,
    activeBands: [...profile.includeBands],
    activeToolboxId: resolveIntentIdForProfile(input.policy, profile.id),
    activationCause: "bootstrap",
    leaseToken: null,
    leaseExpiresAt: null,
    activatedAt,
    lastToolActivityAt: null
  };
}

export function activateToolboxBrokerSession(
  state: ToolboxBrokerSessionState,
  input: {
    policy: CompiledToolboxPolicy;
    profileId: string;
    leaseToken?: string | null;
    leaseExpiresAt?: string | null;
    activationCause: ToolboxBrokerActivationCause;
    toolboxId?: string | null;
    clientId?: string;
  }
): ToolboxBrokerSessionState {
  const profile = input.policy.profiles[input.profileId];
  if (!profile) {
    throw new Error(`Unknown broker activation profile '${input.profileId}'.`);
  }

  return {
    ...state,
    clientId: input.clientId ?? state.clientId,
    activeProfileId: profile.id,
    activeBands: [...profile.includeBands],
    activeToolboxId:
      input.toolboxId
      ?? resolveIntentIdForProfile(input.policy, profile.id)
      ?? null,
    activationCause: input.activationCause,
    leaseToken: input.leaseToken ?? null,
    leaseExpiresAt: input.leaseExpiresAt ?? null,
    activatedAt: new Date().toISOString(),
    lastToolActivityAt: null
  };
}

export function touchToolboxBrokerSessionActivity(
  state: ToolboxBrokerSessionState,
  at = new Date().toISOString()
): ToolboxBrokerSessionState {
  return {
    ...state,
    lastToolActivityAt: at
  };
}

export function reconcileToolboxBrokerSessionState(
  state: ToolboxBrokerSessionState,
  input: {
    policy: CompiledToolboxPolicy;
    now?: Date;
  }
): {
  state: ToolboxBrokerSessionState;
  contracted: boolean;
} {
  if (state.activeBands.length === 0 || (state.activeBands.length === 1 && state.activeBands[0] === "bootstrap")) {
    return {
      state,
      contracted: false
    };
  }

  const bands = state.activeBands
    .map((bandId) => input.policy.bands[bandId])
    .filter(Boolean);
  const resolvedProfile =
    input.policy.profiles[state.activeProfileId]
    ?? Object.values(input.policy.profiles).find((profile) =>
      profile.includeBands.length === state.activeBands.length
      && profile.includeBands.every((bandId) => state.activeBands.includes(bandId))
    );
  const fallbackProfileId = resolvedProfile?.fallbackProfile ?? "bootstrap";
  const now = input.now ?? new Date();

  if (
    state.leaseExpiresAt
    && bands.some((band) => band.contraction.onLeaseExpiry)
    && now.getTime() >= new Date(state.leaseExpiresAt).getTime()
  ) {
    return {
      state: activateToolboxBrokerSession(state, {
        policy: input.policy,
        profileId: fallbackProfileId,
        activationCause: "lease_expired",
        toolboxId: null,
        leaseToken: null,
        leaseExpiresAt: null
      }),
      contracted: true
    };
  }

  const idleTimeoutSeconds = bands
    .filter((band) => band.contraction.taskAware && typeof band.contraction.idleTimeoutSeconds === "number")
    .map((band) => band.contraction.idleTimeoutSeconds as number)
    .sort((left, right) => left - right)[0];
  if (!idleTimeoutSeconds) {
    return {
      state,
      contracted: false
    };
  }

  const activityAt = state.lastToolActivityAt ?? state.activatedAt;
  if (now.getTime() - new Date(activityAt).getTime() < idleTimeoutSeconds * 1000) {
    return {
      state,
      contracted: false
    };
  }

  return {
    state: activateToolboxBrokerSession(state, {
      policy: input.policy,
      profileId: fallbackProfileId,
      activationCause: "idle_timeout",
      toolboxId: null,
      leaseToken: null,
      leaseExpiresAt: null
    }),
    contracted: true
  };
}

function resolveIntentIdForProfile(
  policy: CompiledToolboxPolicy,
  profileId: string
): string | null {
  const exactMatch = policy.intents[profileId];
  if (exactMatch?.targetProfile === profileId) {
    return exactMatch.id;
  }

  const intent = Object.values(policy.intents).find(
    (candidate) => candidate.targetProfile === profileId
  );
  return intent?.id ?? null;
}
