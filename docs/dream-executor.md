# Dream executor

AutoDream's worker is a dedicated execution mode, not an ordinary repository worker: it reads frozen
evidence and submits candidates for human approval, and it cannot touch the workspace.

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

A Ticket is a Dream ticket when its **origin Input** carries Evolution's marker:
`trigger.meta.input.layer === 'evolution'` and `externalEventId` starts with `dream_`
(`plugins/dsh-evolution/src/dream.mjs` submits it that way). Title text and the `human` flag are not
used: a manual refine is human-originated too.

`patches/superagent-dream.patch` adds `DREAM_TOOLS` and selects it in `Sessions#workOnly`:

```ts
const DREAM_TOOLS = ['skill', 'dream_refine']
```

Everything else the Executor Session could use — `read`, `write`, `edit`, `glob`, `grep`, `bash`,
`pwsh`, `job_*`, `web_*`, `subagent`, `todo_write` — is masked by the existing `tools.restrict`
mechanism. The Executor's own ticket tools (`orchestrator_ack`, reports) are not masked, so the worker
can still accept and report its Assignment.

Detection is fail-safe in one direction only: if `dream_refine` is not registered (plugin disabled),
the Dream session is left with `skill` alone and cannot claim anything. It never falls back to the
workspace tool set.

## The tool

`dream_refine` is registered by `plugins/dsh-evolution` (its `dream-tool.mjs`) and needs no request or
ticket argument: the worker Session ID is `worker-<ticketId>`, and every call resolves the request
through `Ticket` → origin Input → frozen request. `authorize()` in `dream.mjs` re-checks liveness,
subject and ticket ownership on every call.

| command | effect |
| --- | --- |
| `claim` | freezes the run, returns ref counts per source session (not the material); binds this ticket to that request |
| `evidence` | no session: list sessions; with `session/offset/limit`: a page of 30 (max 80) refs; with `ref`: one event in full (≤6 kB) |
| `baseline` | persona revision and skill entries a plan may change |
| `plan` | submits the plan object inline; the journal freezes it and stages each candidate through its owner |
| `execute` | moves candidates to `pending_review`; never publishes |
| `status` | this run's phase and per-candidate state |

The material is read once per request and cached in process memory for the pages that follow. Every
command after `claim` carries the bound request id: one Ticket may own several Dream Inputs (the
2026-11-10 run owned two), and without that binding `authorize()` would fall back to "the first request
this Ticket owns".

Owner staging must keep that binding too. The candidate handed to `/candidates` (harness) or
`/candidates/stage` (Laputa) carries `requestId`, and each owner forwards it into its own
`/dream/authorize` call; otherwise a Ticket with an older Dream Input authorizes against that older
run and every staging attempt fails with `Exact skill entry absent from frozen Dream plan`. `baseline`
calls the Laputa channel with an empty body on purpose: a body-less internal call is a `GET`, and that
channel only serves `POST` (`Unknown Laputa owner operation`).

## What stays the same

- Admission, Ticket creation and retries belong to Superagent; Evolution only submits the Input.
- Skill candidates are published by a human in the evolution panel's `审批` tab; persona proposals in
  Laputa's persona panel. `execute` stages and stops.
- `scripts/dream-refine.mjs` remains as a debugging CLI for a human with a shell; Dream Sessions no
  longer receive it.

## Verification

- `patches/superagent-dream.patch` applies after the other eleven patches and the bundle rebuilds
  (`npm run build:bundle`, exit 0), which type-checks it.
- `tests/dream-tool.test.mjs` covers ticket binding, paging, detail, plan pass-through, execute and
  refusal of a non-Dream Session.
- `tests/source-runtime.test.mjs` pins the manifest order including the new patch.

## Limits

- A running instance keeps the old Executor until `npm run stop && npm start`; the patch changes
  Superagent, so a restart is required (`npm run build:bundle` already rebuilt the bundle).
- The tool's page size is a context-budget guard, not a security boundary; the boundary is the absence
  of shell and file tools.
- If `dsh-evolution` is disabled, Dream Sessions can do nothing at all — intended, and visible as a
  blocked Ticket rather than a silent regression.

## Rollback

Remove `superagent-dream.patch` from `patches/superagent-patches.json`, restore the test's list, and run
`npm run build:bundle` — the source tree is never edited directly, the patch only exists at build time.
