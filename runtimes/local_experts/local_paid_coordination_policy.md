# Local-Paid Model Coordination Policy

## Purpose
Ensure safe, deterministic, and cost-efficient collaboration between:

- local model (`qwen3-coder:30b` via Ollama or Docker-hosted equivalent)
- paid model (stronger remote escalation target)

Primary goals, in strict priority order:

1. Prevent workspace corruption or unintended changes
2. Preserve context continuity across tasks, sessions, and workspaces
3. Minimize paid-token usage without reducing correctness
4. Ensure deterministic, inspectable behavior

## Core Operating Principle
The paid model is not the primary executor.

It acts as:

- supervisor
- router
- validator
- escalation handler

The local model is:

- primary code generator
- primary implementation engine
- first-pass reasoning layer

The paid model should intervene only when necessary.

## Context Persistence Rules

### Persistent mental model
The stronger supervisory path should maintain a persistent understanding of:

- project structure
- module boundaries
- naming conventions
- API contracts
- known limitations
- prior fixes and corrections

If uncertainty exists, request inspection rather than guessing.

### Workspace continuity
Across tasks, the system should:

- assume prior code still exists unless explicitly replaced
- avoid redefining existing structures unless required
- verify compatibility with previously generated modules
- detect drift between expected and actual structure

### No stateless regeneration
The supervisor path must not:

- regenerate entire modules unless explicitly required
- overwrite existing logic without verifying scope
- assume blank state between tasks

All changes should be incremental and scoped.

## Routing Rules

### Default rule
All tasks route to the local model unless an escalation condition is met.

### Allowed local tasks
Prefer local execution for:

- small to medium code generation
- isolated module creation
- test generation
- refactoring within a single file
- simple bug fixes
- deterministic transformations
- boilerplate generation
- schema or model definitions

### Mandatory escalation conditions
Escalate if any of the following are true:

Structural risk:

- multi-file changes with dependencies
- cross-module refactors
- API contract changes
- changes affecting build/config/runtime behavior

Safety risk:

- file system operations
- deletion or renaming of files
- scheduler/system integration
- subprocess execution logic
- patch application logic
- validation framework changes

Ambiguity:

- unclear requirements
- conflicting constraints
- missing context
- inconsistent prior outputs

Local model failure signals:

- explicit `ESCALATE:` marker
- repeated failed attempts
- invalid output format
- hallucinated APIs or fields
- inability to produce valid patch/code

### Anti-pattern
The stronger path must not:

- escalate preemptively without reason
- override local model results without analysis
- duplicate local work instead of correcting it
- act as primary generator for routine tasks

## Success Criteria
A correct run is one where:

- the local model performs most work
- the stronger path intervenes only when necessary
- context remains consistent across steps
- no unintended changes occur
- output integrates cleanly with existing code
- token usage is minimized without sacrificing correctness
