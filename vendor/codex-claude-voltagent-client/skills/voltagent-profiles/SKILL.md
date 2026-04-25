---
name: VoltAgent Profiles
description: List configured Claude profiles and their resolved skill packs for the repo-local plugin shell.
---

# VoltAgent Profiles

Run:

```powershell
node .\plugins\codex-voltagent-default\scripts\profiles.mjs --config <path-to-client-config.json>
```

This prints JSON describing the configured Claude profiles, role ids, skill-pack
ids, and resolved skills.
