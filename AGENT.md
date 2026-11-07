# Agent instructions

## Completion marker

When all of the user's active requests are complete, end the final response with:

```text
-------------------
AWAITING FURTHER INPUT
```

Do not add this marker to progress updates or while requested work is still in progress, including delegated work. State any verification limits in the completion summary before the marker.

## Continuous commits

Commit completed, coherent milestones throughout the work so progress can be tracked in Git. Do not leave all changes uncommitted until the end of a long task.

- Verify each milestone with the relevant tests or checks before committing, and report any verification limits.
- Use descriptive commit messages and keep unrelated changes separate.
- Integrate and verify delegated changes before committing them; never commit another agent's unfinished work blindly.
- For this project, the user requests regular pushes of verified milestone commits so collaborators can follow progress.
- Inspect the configured source remote and branch before pushing; never publish through the `local` remote. Use ordinary, non-force pushes only.
- If a push fails because of permissions or diverging history, report the blocker rather than rewriting shared history.

## Subagent roles

Pick the agent type by risk, not by habit. Model ids change between tools, so the type is what this file fixes; if the harness lets you choose a model, use the strongest available one for the high-risk rows and a fast one for the rest.

| Work | Agent type | Notes |
| --- | --- | --- |
| Gateway proxy, integration API, listener, credential and cache code | `task` (strongest model) + a `security-reviewer` pass before commit | Anything that can write to the gateway or exposes a port |
| Home Assistant component | `task` (strongest model), then `reviewer` | Cannot run HA here: list every HA API relied on |
| Frontend features and test rewrites | `task` | Follow DESIGN.md and PRODUCT.md; use the `impeccable` skill for UI work |
| Read-only research (docs, OpenAPI, code reading) | `scout` or `task` with no edits | Cite URLs; say what was not verified |
| Mechanical edits (renames, doc sync) | `sonic` | Only when the change is fully specified |

Rules: give each agent separate file ownership and a written contract for shared shapes (message them with `write agent://<name>` when a shape changes); integrate, run the full suites and look at screenshots before committing; never commit another agent's unfinished work.

## Real gateway and safety

- Until the official installer handover, the installation must not be disturbed. Never call configuration, commissioning, calibration, job, scene or reset endpoints. Writes to loads happen only on entities the user has named for testing, one at a time, after a read-only look.
- Blinds are moved only when the user confirms the travel path is clear.
- Never read, print or log `.env`, `data/credentials/` or tokens. Talk to the running app on 127.0.0.1 instead of reading secret files.
- The integration API stays read-only unless `WISER_INTEGRATION_CONTROL=1` is set for a supervised test, and is switched off again afterwards.
- Capture unknown gateway messages with the Diagnostics "Gateway events (raw)" panel; never invent an undocumented event or endpoint format.
