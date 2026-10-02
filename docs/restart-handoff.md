---
title: Dashboard restart handoff
aliases:
  - Restart here
  - Dashboard backlog
tags:
  - wiser
  - dashboard
  - handoff
type: handoff
status: superseded
---

# Dashboard restart handoff

**Historical note:** this describes checkpoint `6257bf4`, before development resumed. The Svelte migration and cancellation fixes are now implemented; use [the current development handoff](development-handoff.md) instead. Instructions and unfinished-work descriptions below preserve the old checkpoint, not today's backlog.

## State of this checkpoint

**Development is paused at the user's request. All outstanding implementation agents were stopped. Do not resume their conversations or depend on their private worktrees. Start fresh from this repository when the user asks to restart.**

Branch: `checkpoint/wiser-poc-restart`.

This checkpoint preserves the existing vanilla-JavaScript POC and records the unfinished work. It is **not** a completed Svelte dashboard. Some interrupted agents reported successful builds in isolated worktrees, but those changes were never integrated or verified here and are not part of this checkpoint.

### Committed baseline

- Small Node HTTP backend in [server.js](../server.js), with no runtime dependencies.
- Vanilla frontend under `public/` in the historical checkpoint (replaced by `src/` in the current version).
- Gateway IP/hostname input; an existing Bearer token or physical-button pairing with a generated unique client username.
- Discovery, reported load states, on/off, dimming, and blind position targets.
- Read-only optional gateway, room, device, sensor, and HVAC data.
- Manual refresh and sequential polling.
- Credentials held in one shared server-memory session, never intentionally stored on disk or in browser storage.
- Localhost binding, Host/Origin checks, required `X-Wiser-Client` header, allowlisted reads/writes, target validation, and sanitized gateway errors.
- Fourteen automated backend tests using a fake gateway in [test/server.test.js](../test/server.test.js).
- Obsidian-compatible research and dashboard documentation.

Baseline milestone commits:

| Commit | Contents |
| --- | --- |
| `0ca12ac` | Product/API research |
| `eb8c316` | Completion marker and incremental-commit policy |
| `352fb89` | Vanilla local dashboard and backend tests |
| `0feb1ad` | Dashboard workflow and hardware-validation documentation |
| `48cba2c` | Regular verified milestone pushes |

The baseline test suite passed all **14 tests**. Browser interaction and real gateway behavior have **not** been validated. The known races below are not covered by that passing baseline.

## User decisions to preserve

- Build a small functional local POC, not a polished production controller.
- Configure the gateway address and authentication through the web interface.
- Use this POC as the foundation for a growing **Svelte + Vite** dashboard.
- Use **Tailwind + daisyUI**, built locally rather than loaded from a CDN.
- Keep the existing Node gateway backend and its tests.
- Organize the frontend into connection setup, entity controls, and resource inspection components.
- Keep documentation readable in Obsidian, with YAML frontmatter and relative Markdown links.
- Make and push verified milestone commits regularly.
- Use **GPT-6.1 Sol** for Sol assignments; **GPT-6 Luna** remains suitable for requirements, documentation, and UX. Astra is reserved for work whose complexity warrants it.
- Follow [AGENT.md](../AGENT.md). The user's global baseline also exists at `~/.codex/AGENTS.md` on Fabian's machine; it is not automatically available on every participant's machine or in every agent context.

## Workstream A: fix backend connection cancellation

Own the connection/session sections of `server.js` and related regression tests. Do not change frontend/static-serving code.

### Race 1: a partially received connect request outlives disconnect

The current connect handler awaits the JSON body before capturing the attempt's generation and resetting the session. An earlier request whose body is incomplete can finish after a successful disconnect, then establish a new session.

Reviewer reproduction:

1. Start `POST /api/connect` with only part of a valid JSON body over a raw HTTP connection.
2. Call `POST /api/disconnect` and wait for success.
3. Send the remainder of the original connect body.
4. The current implementation can return success and show a connected session.

Required fix: track the attempt relative to the session generation before awaiting body parsing; reject a stale request before it contacts the gateway or installs a session. Keep concurrent-connect behavior coherent.

Regression: hold the partial body deterministically, disconnect, finish the body, and assert connect is rejected, no pairing claim is sent, and the session remains disconnected.

### Race 2: an abandoned pairing request can retain credentials

If the browser aborts a complete pairing request while the gateway claim is pending, the server currently can finish pairing and retain the token even though its requester disappeared.

Required fix: tie a pending connect attempt to premature request/response closure, cancel its upstream work, and prevent session assignment. Cleanup must be conditional on that attempt's identity/generation so a late close cannot clear a newer session.

Regressions:

- Wait until the fake gateway receives `/api/account/claim`, abort the browser-side request, then release the claim response. The session must remain disconnected.
- A normally completed connect response followed by ordinary connection closure must **retain** the established session.
- Preserve existing disconnect, replacement-connect, and concurrent-request tests.

### Retained limitation

Hostname destinations are syntactically validated but not DNS-pinned. Gateway traffic is plain HTTP on a trusted LAN. This is documented, not fixed; do not describe Host/Origin protection for the local web app as protection against outbound DNS changes or LAN interception.

## Workstream B: rebuild the frontend migration

Use the current vanilla UI as the behavior reference, not missing patches from stopped agents.

1. Add Svelte, Vite, Tailwind, and daisyUI with a lockfile and ignored generated/dependency directories.
2. Split connection setup, load controls, and optional resource inspection into components.
3. Keep one production origin: build into `dist/`, then serve the built frontend and API through the existing localhost backend.
4. Change only the static-serving portion of the server while another worker owns session fixes. Preserve the API contract and security checks.
5. Provide a simple `npm install` then `npm start` workflow; document the chosen Node minimum (Node 22.12+ was planned for the migration).
6. Replace obsolete public assets only when the new frontend works.
7. Update the static-file regression test: it currently expects `/app.js` and `/style.css`; Vite emits hashed assets. Ensure tests have an explicit build prerequisite so a fresh checkout works.
8. Update README and [dashboard.md](dashboard.md) to describe the implemented workflow, not a future plan.

### UI acceptance criteria

- Separate **use existing token** and **pair new client** flows. Explain physical access and the approximately 30-second button-press window before pairing.
- Clear entered tokens after submission; never persist them, echo them in errors, or add debug logging.
- Show the connected host, operation progress, actionable errors, last successful update, and stale readings after refresh failures.
- Distinguish **target accepted** from **reported state**. A successful write followed by a failed refresh must not claim the device reached its target.
- Render on/off, brightness, and blind position readably; put raw gateway JSON in expandable diagnostics.
- Preserve explicit light targets and motor level only: `0 = open`, `10000 = closed`. No tilt, stop, calibration, HVAC writes, scene execution, or arbitrary proxy commands.
- Unknown and unused loads are read-only with an explanation.
- Failures of optional resources do not block core loads. Distinguish unsupported resources from transient errors where the backend provides that distinction.
- Use accessible labels, per-load context, keyboard controls, visible focus, and status/error announcements.
- Stop polling and reject stale results after disconnect/reconnect. Avoid overlapping page requests.
- Explain that all tabs share one server session; closing a tab does not forget an established token, and disconnect does not revoke the gateway account.

## Fresh-worker plan

Use two focused workers only if the work is parallelized:

| Worker | Ownership |
| --- | --- |
| GPT-6.1 Sol backend | Session/connection logic and cancellation regressions |
| GPT-6.1 Sol frontend | Frontend/config/lockfile, static serving, static test, run instructions |

Requirements and UX findings are already captured above. Additional research agents are not necessary to restart. Assign explicit ownership of the shared `server.js` and test file sections to avoid conflicting edits.

The parent should integrate, inspect, verify, commit, and push each coherent milestone. Do not treat a progress message about an isolated build as a delivered implementation.

## Verification before calling the next iteration complete

1. Run all backend regressions, including the new cancellation cases.
2. Run Svelte checks and a production build.
3. Start the built app and test the actual browser against a fake gateway: token connection, physical-pairing simulation, discovery, light/blind commands, errors, refresh, disconnect, and token cleanup.
4. Check narrow-screen and keyboard behavior.
5. Confirm local links/frontmatter and documented commands match the resulting repository.
6. Clearly distinguish simulated tests from real hardware testing. Follow [the hardware checklist](dashboard.md#safe-first-hardware-validation) only with access to the actual installation.

On the environment used for the baseline, Node/npm were absent from ordinary PATH; Node 22 was available through Nix. Google Chrome was installed. Follow the user's environment/tooling rules rather than installing system tools ad hoc.

## Publishing status

The configured source repository is `fabianw931/wiser-smart-home-integration` on GitHub. At handoff, SSH authentication on Fabian's machine was blocked (`Permission denied (publickey)`); GitHub CLI was not authenticated. Never force-push or substitute the `local` backlink for the source remote.

Check authentication and remote/branch state before retrying. The presence of a local checkpoint branch alone is not proof it has been pushed; report the actual push result separately.

Return to [the documentation index](index.md).
