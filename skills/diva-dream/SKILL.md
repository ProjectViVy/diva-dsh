---
name: diva-dream
description: Use when a DIVA Dream or manual refine Ticket requests evidence-backed persona proposals and skill candidates for human approval.
metadata:
  author: diva-dsh
  role: evolution-workflow
---

# Dream refinement

Your Session works through one tool, `dream_refine`; it has no shell, no file tools
and no network. The tool is bound to this Ticket: it resolves the request itself, so
no request or ticket ID is ever an argument you pass.

Work only within the current ordinary Ticket and its mandate. Startup conditions
create an input, not permission to accept work, bypass a pause, or publish assets.

## The run

1. `{command: "claim"}` freezes the request and returns how much material there is:
   ref counts per source session, never the material itself.
2. `{command: "evidence"}` lists the sessions. Then page one session at a time with
   `{command: "evidence", session, offset, limit}` (30 refs by default, 80 at most),
   and read a single event in full with `{command: "evidence", ref}`. Read all of it
   before planning: 300 refs over several sessions is normal.
3. `{command: "baseline"}` returns the persona revision and the skill entries a plan
   may change.
4. `{command: "plan", plan: {...}}` submits the plan below. It is immutable once
   accepted.
5. `{command: "execute"}` stages the planned candidates. A human approves or rejects
   them in the evolution panel; nothing becomes live on this path.
6. `{command: "status"}` reports the run's phase and per-candidate state.

Keep source event IDs and digests in every derived claim. Separate observed results,
user statements, inference and contradictions. Do not count recaps, copied archives
or this Dream's own output as new primary evidence. Synthesize each session
independently before comparing across sessions. Record material not actually read as
deferred. Prefer project-scoped skills; global claims need cross-project support. An
empty result is valid.

## The plan

```json
{
  "factCards": [{"sessionId": "source-session", "refs": ["event:sha256"], "insight": "Observed facts, inferences and contradictions"}],
  "coverage": ["event:sha256"],
  "candidates": []
}
```

Every fact card cites refs of its own session; every coverage ID must appear in a
fact card's refs, and every candidate's `refs` must be drawn from coverage.

A skill candidate has `kind: "skill"`, `skillId`, `entry: {content, description?, files?}`,
and `expectedDigest` from baseline (null for a new skill); one plan changes each skill
at most once. A persona candidate has `kind: "persona"`, `files`,
`expectedBaseRevision`, `expectedDraftDigest` from baseline, and `summary`. Preserve
the owner's exact baseline fields; never invent missing values. No useful change means
an empty candidates array with honest fact cards and coverage of the evidence actually
analyzed.

## Boundaries

Never edit live skills, persona drafts, revision pointers, decisions or published
versions directly, and never present a candidate as validated or active before the
owner reports a publication. Persona proposals are approved in the persona panel, skill
candidates in the evolution panel; `execute` only stages them.

Keep the Ticket result precise: distinguish request admission, analysis, candidate
creation, waiting for approval, blocking and actual publication.
