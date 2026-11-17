# Dream executor

AutoDream's refinement runs in its own Session type, not as an ordinary repository worker: it reads
frozen evidence and submits candidates for human approval, and it cannot touch the workspace.

## Why

The 2026-11-10 run (`run_433a1a53…`) finished with no candidates, but its worker had written nine
`.mjs` helpers and ~4.9 MB of dumps into its work directory inside the repository. The audit showed
**85 tool calls, none outside its work directory** — no source file was edited. The defect is still
real: the worker ran as a normal agent with `bash`/`pwsh`/`write`/`edit` and full workspace access, so
the only thing preventing a source edit was the model's good behaviour. A Dream also gets no benefit
from those tools: the 4.4 MB `evidence.json` does not fit into context, so the model wrote `digest.mjs`
and friends to page through it by hand.

Two consequences shaped the design:

1. Give the Dream domain tool paging and inline plan submission, so no helper scripts are needed.
2. Remove the tools that can write anywhere, so a source edit is impossible rather than discouraged.

## The mode

There is no ticket and no admission step in front of a refinement. `dsh-evolution` decides that a run
should happen, freezes the material, and creates the Session itself — the same five steps upstream's
webhook path uses for one incoming delivery (`@deepseek-ai/dsh-webhook` `createWebhookSession`):

1. resolve the agent preset and the permission preset;
2. `workspaceRegistry.create(path)` and attach the Session to it;
3. `agents.create({ sessionId, meta: { cwd, agentPreset }, setup })`, where `setup` mounts the preset
   into the Agent's own scope;
4. `permissionPresets.set(session, 'read-only')` and `sessionTitle.rename(session, …)`;
5. one follow-up user message that states the request id and the workflow.

`plugins/dsh-evolution/src/dream-session.mjs` owns that sequence. A Session is created only after the
request is journaled, so the journal is the single authority for what a later call may do.

### The preset

A Dream Session runs under its own agent preset, `dsh-autodream` (displayed as 「自动精炼」), declared
by `plugins/dsh-evolution/cordis.patch.yml` — the same `@deepseek-ai/dsh-agent-preset` row form the
built-in modes use. It carries the skills and the compaction a long paged read needs, and no shell or
file tools; it is not a hidden mode, so its description says whom it is for.

The preset bounds what *exists*, but a root-registered tool is still visible to every Session, so the
launcher narrows the surface in the Session's own scope:

```js
agentCtx.tools.restrict({ allow: ['skill'] })
agentCtx.tools.register(dreamToolDefinition(dream))
```

`tools.restrict()` only accepts names of global tools, which is why `dream_refine` is registered inside
the scope instead of being listed: a restriction never hides a scoped registration. Everything else —
`read`, `write`, `edit`, `glob`, `grep`, `bash`, `pwsh`, `job_*`, `web_*`, `subagent`, `todo_write` —
is masked. The Session also has no ticket tools, because there is no ticket.

Detection is fail-safe in one direction only: if `skill` is not a global tool, `restrict` throws and the
request is journaled as `failed` — it never falls back to the unrestricted surface. If the domain tool
cannot be registered, the Session is left with `skill` alone and can never claim.

## The tool

`dream_refine` is registered by `plugins/dsh-evolution` (its `dream-tool.mjs`) inside the Session scope
and needs no request argument: the calling Session id (`dream-<uuid>`) is the binding, and every call
resolves the frozen request through it. `authorize()` in `dream.mjs` matches
`request.agentSessionId === sessionId` and re-checks liveness, subject and the frozen plan on every call.

| command | effect |
| --- | --- |
| `claim` | creates the run record (2 h deadline) and returns ref counts per source session, not the material |
| `evidence` | no session: list sessions; with `session/offset/limit`: a page of 30 (max 80) refs; with `ref`: one event in full (≤6 kB) |
| `baseline` | persona revision and skill entries a plan may change |
| `plan` | submits the plan object inline; the journal freezes it and stages each candidate through its owner |
| `execute` | moves candidates to `pending_review`; never publishes |
| `status` | this run's phase and per-candidate state |

The material is read once per request and cached in the tool definition of that Session. Every command
after `claim` carries the bound request id, so an owner callback can be matched against exactly one
frozen run even though a Session could name another request.

Owner staging must keep that binding too. The candidate handed to `/candidates` (harness) or
`/candidates/stage` (Laputa) carries `requestId`, and each owner forwards it into its own
`/dream/authorize` call; without it a second run's older plan could authorize a candidate.
`baseline` calls the Laputa channel with an empty body on purpose: a body-less internal call is a
`GET`, and that channel only serves `POST` (`Unknown Laputa owner operation`).

## The schedule

`startDreamSchedule()` runs the eligibility check at application-ready and then every 15 minutes
(`ctx.effect` owns the timer). One check reads the journal, applies the gate — enabled, cooldown,
≥5 new sessions, ≥10 deduplicated primary events — and, only when every condition holds, scans the
evidence and creates one Session.

- The cooldown anchors on `max(lastCompletedAt, lastAttemptAt)`: a run that dies without completing
  must not be retried by the next tick.
- One refinement at a time: a request inside its 2 h deadline, whose run is not settled, holds the gate
  (`in_progress`) whatever its snapshot.
- `maintain()` settles a request that outlived its deadline as `timed_out`, marks its run `blocked`, and
  disposes the Agent. Nothing retries automatically.

## What stays the same

- Skill candidates are published by a human in the evolution panel's `审批` tab; persona proposals in
  Laputa's persona panel. `execute` stages and stops.
- `scripts/dream-refine.mjs` remains as a debugging CLI for a human with a shell; Dream Sessions do
  not receive it.
- The record store's `ticket_id` column stays: it is the external work-item id, and nothing writes to it
  from this path.

## Verification

- `npm run build:bundle` exits 0 with eleven Superagent patches; `git -C superagent status --short` is
  clean afterwards, and `git -C superagent grep -n "dsh-autodream"` is empty.
- `node --test plugins/dsh-evolution/tests/*.mjs` covers launch wiring, Session binding, paging, plan
  pass-through, the run deadline and the one-run gate.
- `node --test tests/dream-preset.test.mjs` pins the preset row, the launcher's tool surface and the
  absence of the retired patch.

## Limits

- A running instance keeps the previous build until `npm run stop && npm start`; the preset row and the
  launcher both ship with the plugin, so a restart is required.
- The tool's page size is a context-budget guard, not a security boundary; the boundary is the absence
  of shell and file tools.
- If `dsh-evolution` is disabled, no Dream Session is created at all.
- `owner-candidates.ts` in `dsh-continual-harness` is still the prepared (unwired) producer for the
  record store; the evolution panel's 「进化 → 进化记录」 therefore stays empty. See TODOLIST DV-EV-017.

## Rollback

Revert the plugin changes and `patches/superagent-patches.json` (which no longer lists a Dream patch),
then run `npm run build:bundle`. The retired build-time patch is kept out of the tree in
`.artifacts/retired/` for reference; the source tree is never edited directly.
