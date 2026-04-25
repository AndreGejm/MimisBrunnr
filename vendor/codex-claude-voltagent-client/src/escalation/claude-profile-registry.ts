import type {
  ClaudeEscalationProfile,
  ClaudeSkillPack,
  ClientConfig
} from "../config/schema.js";

export interface ClaudeProfileResolution {
  profile: ClaudeEscalationProfile;
  skillPack: ClaudeSkillPack;
}

export class ClaudeProfileRegistry {
  readonly #profilesById: Map<string, ClaudeProfileResolution>;
  readonly #profilesByReason: Map<string, ClaudeProfileResolution[]>;

  constructor(resolutions: ClaudeProfileResolution[]) {
    this.#profilesById = new Map(
      resolutions.map((resolution) => [resolution.profile.profileId, resolution])
    );
    this.#profilesByReason = new Map();

    for (const resolution of resolutions) {
      for (const reason of resolution.profile.escalationReasons) {
        const existing = this.#profilesByReason.get(reason) ?? [];
        existing.push(resolution);
        this.#profilesByReason.set(reason, existing);
      }
    }
  }

  getProfile(profileId: string): ClaudeProfileResolution {
    const resolved = this.#profilesById.get(profileId);

    if (!resolved) {
      throw new Error(`Unknown Claude profile id: ${profileId}`);
    }

    return resolved;
  }

  listProfiles(): ClaudeProfileResolution[] {
    return Array.from(this.#profilesById.values());
  }

  findProfilesForReason(reason: string): ClaudeProfileResolution[] {
    return this.#profilesByReason.get(reason) ?? [];
  }
}

export function createClaudeProfileRegistry(
  config: ClientConfig["claude"]
): ClaudeProfileRegistry {
  const skillPacksById = new Map(
    config.skillPacks.map((skillPack) => [skillPack.skillPackId, skillPack])
  );
  const resolutions = config.profiles.map((profile) => {
    const skillPack = skillPacksById.get(profile.skillPackId);

    if (!skillPack) {
      throw new Error(`Unknown Claude skillPackId: ${profile.skillPackId}`);
    }

    return { profile, skillPack };
  });

  return new ClaudeProfileRegistry(resolutions);
}
