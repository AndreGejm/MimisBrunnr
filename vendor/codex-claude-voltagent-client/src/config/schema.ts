import { z } from "zod";

const nonBlankString = z.string().refine((value) => value.trim().length > 0, {
  message: "must not be blank"
});

export const clientRuntimeModeSchema = z.enum([
  "local-only",
  "voltagent-default",
  "voltagent+claude-manual",
  "voltagent+claude-auto"
]);

export const claudeSkillPackSchema = z.strictObject({
  skillPackId: nonBlankString,
  skills: z.array(nonBlankString).min(1)
});

export const claudeEscalationProfileSchema = z.strictObject({
  profileId: nonBlankString,
  roleId: nonBlankString,
  skillPackId: nonBlankString,
  model: nonBlankString,
  fallback: z.array(nonBlankString).default([]),
  escalationReasons: z.array(nonBlankString).min(1),
  outputMode: z.enum(["structured", "text"]).default("structured"),
  timeouts: z.strictObject({
    totalMs: z.number().int().positive(),
    modelMs: z.number().int().positive()
  }),
  retries: z.number().int().min(0).max(3).default(0)
});

export const clientConfigSchema = z.strictObject({
  configVersion: z.literal(1).default(1),
  mimir: z.strictObject({
    serverCommand: z.array(nonBlankString).min(1),
    serverArgs: z.array(nonBlankString).default([]),
    transport: z.enum(["stdio"]).default("stdio")
  }),
  skills: z.strictObject({
    rootPaths: z.array(nonBlankString).min(1)
  }),
  models: z.strictObject({
    primary: nonBlankString,
    fallback: z.array(nonBlankString).default([])
  }),
  runtime: z
    .strictObject({
      mode: clientRuntimeModeSchema.default("local-only"),
      trustedWorkspaceRoots: z.array(nonBlankString).default([])
    })
    .default({
      mode: "local-only",
      trustedWorkspaceRoots: []
    }),
  claude: z
    .strictObject({
      enabled: z.boolean().default(false),
      skillPacks: z.array(claudeSkillPackSchema).default([]),
      profiles: z.array(claudeEscalationProfileSchema).default([])
    })
    .default({
      enabled: false,
      skillPacks: [],
      profiles: []
    })
}).superRefine((config, ctx) => {
  if (
    config.runtime.mode !== "local-only" &&
    config.runtime.trustedWorkspaceRoots.length === 0
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["runtime", "trustedWorkspaceRoots"],
      message:
        "trustedWorkspaceRoots must contain at least one workspace root when runtime mode is not local-only"
    });
  }

  if (
    (config.runtime.mode === "voltagent+claude-manual" ||
      config.runtime.mode === "voltagent+claude-auto") &&
    !config.claude.enabled
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["claude", "enabled"],
      message:
        "claude.enabled must be true when runtime mode uses Claude escalation"
    });
  }

  const seenSkillPackIds = new Set<string>();
  for (const [index, skillPack] of config.claude.skillPacks.entries()) {
    if (seenSkillPackIds.has(skillPack.skillPackId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["claude", "skillPacks", index, "skillPackId"],
        message: `Duplicate Claude skill pack id: ${skillPack.skillPackId}`
      });
      continue;
    }

    seenSkillPackIds.add(skillPack.skillPackId);

    const seenSkills = new Set<string>();
    for (const [skillIndex, skillId] of skillPack.skills.entries()) {
      if (seenSkills.has(skillId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["claude", "skillPacks", index, "skills", skillIndex],
          message: `Duplicate Claude skill id in skill pack ${skillPack.skillPackId}: ${skillId}`
        });
        continue;
      }

      seenSkills.add(skillId);
    }
  }

  const seenProfileIds = new Set<string>();
  for (const [index, profile] of config.claude.profiles.entries()) {
    if (seenProfileIds.has(profile.profileId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["claude", "profiles", index, "profileId"],
        message: `Duplicate Claude profile id: ${profile.profileId}`
      });
    } else {
      seenProfileIds.add(profile.profileId);
    }

    if (!seenSkillPackIds.has(profile.skillPackId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["claude", "profiles", index, "skillPackId"],
        message: `Unknown Claude skillPackId: ${profile.skillPackId}`
      });
    }
  }

  if (
    config.runtime.mode === "voltagent+claude-auto" &&
    config.claude.profiles.length === 0
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["claude", "profiles"],
      message:
        "At least one Claude profile is required when runtime mode is voltagent+claude-auto"
    });
  }
});

export type ClientConfig = z.infer<typeof clientConfigSchema>;
export type ClientRuntimeMode = z.infer<typeof clientRuntimeModeSchema>;
export type ClaudeSkillPack = z.infer<typeof claudeSkillPackSchema>;
export type ClaudeEscalationProfile = z.infer<
  typeof claudeEscalationProfileSchema
>;
