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

## Subagent model preferences

- Use GPT-6.1 Sol (`gpt-6.1-sol`) for Sol assignments, not GPT-6 Sol.
- Keep GPT-6 Luna (`gpt-6-luna`) for Luna assignments such as requirements, documentation, and UX.
- Use Astra only where the complexity warrants it.
- Give agents separate ownership areas; integrate and verify their results before committing.
