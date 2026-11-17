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
   and read a single event in full with `{command: "evidence", ref}`. A large snapshot
   (thousands of refs over dozens of sessions) cannot be read in full inside one run:
   page the sessions that carry the decision, and record every session you only
   sampled as deferred in its fact card's `insight`. Never present unread material
   as evidence.
3. `{command: "baseline"}` returns the persona revision and the skill entries a plan
   may change.
4. `{command: "plan", plan: {...}}` submits the plan below. It is immutable once
   accepted; a **refused** plan freezes nothing, so fix the item the error names and
   submit again. A plan whose `candidates` array is empty is a valid analyzed no-op
   and settles the run immediately.
5. `{command: "execute"}` hands the planned candidates to the panel. It is required
   only when the plan has candidates: without it the run keeps holding the only
   refinement slot until its deadline and is then recorded as blocked. A human
   approves or rejects them in the evolution panel; nothing becomes live on this path.
6. `{command: "status"}` reports the run's phase and per-candidate state.

Keep source event IDs and digests in every derived claim. Separate observed results,
user statements, inference and contradictions. Do not count recaps, copied archives
or this Dream's own output as new primary evidence. Synthesize each session
independently before comparing across sessions. Record material not actually read as
deferred. Prefer project-scoped skills; global claims need cross-project support. An
empty result is valid.

## Ref discipline

- A ref id is **exactly** `event:` followed by 64 lowercase hex characters. Nothing
  else is an id.
- An `evidence` line reads `seq=193 event:<64 hex> …`. The `seq` is the event's
  position in its session log, never part of the id: `event:193:<hex>` names nothing.
- Copy ids from the output. Never retype or reconstruct a digest from memory; if you
  cannot recall one, re-read that page instead of guessing.
- A fact card may cite only refs of its own `sessionId`. A candidate's `refs` must be
  a subset of `coverage`.

## The plan

```json
{
  "factCards": [{"sessionId": "<source session id>", "refs": ["event:<64 hex>"], "insight": "Observed facts, inferences and contradictions"}],
  "coverage": ["event:<64 hex>"],
  "candidates": [{
    "kind": "skill",
    "skillId": "diva-existing-or-new-skill",
    "expectedDigest": null,
    "refs": ["event:<64 hex>"],
    "entry": {"content": "# …the whole skill body…", "description": "one line"}
  }]
}
```

Every fact card cites refs of its own session; every coverage ID must appear in a
fact card's refs; every candidate must carry its own nonempty `refs` array drawn from
`coverage`. A candidate without `refs` is refused.

A skill candidate has `kind: "skill"`, `skillId`, `entry: {content, description?, files?}`,
`refs`, and `expectedDigest` from baseline (null for a new skill); one plan changes
each skill at most once. A persona candidate has `kind: "persona"`, `files`,
`expectedBaseRevision`, `expectedDraftDigest` from baseline, `summary` and `refs`.
Preserve the owner's exact baseline fields; never invent missing values. No useful
change means an empty `candidates` array with honest fact cards and coverage of the
evidence actually analyzed.

## Boundaries

Never edit live skills, persona drafts, revision pointers, decisions or published
versions directly, and never present a candidate as validated or active before the
owner reports a publication. Persona proposals are approved in the persona panel, skill
candidates in the evolution panel; `execute` only stages them.

Keep the Ticket result precise: distinguish request admission, analysis, candidate
creation, waiting for approval, blocking and actual publication.
