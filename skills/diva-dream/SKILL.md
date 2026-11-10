---
name: diva-dream
description: Use when a DIVA Dream or manual refine Ticket requests evidence-backed persona proposals and validated skill improvements.
metadata:
  author: diva-dsh
  role: evolution-workflow
---

# Dream refinement

Work only within the current ordinary Ticket and its mandate. Startup conditions
create an input, not permission to accept work, bypass a pause, or publish assets.

Use the component CLI command supplied by the request to read the immutable
material snapshot. Keep source event IDs and digests in every derived claim.
Separate observed results, user statements, inference and contradictions. Do not
count recaps, copied archives or this Dream's own output as new primary evidence.

Synthesize each session independently before comparing across sessions. Read
additional source references when necessary. Record material not actually read
as deferred. Prefer project-scoped skills; global claims need cross-project
support. An empty result is valid.

Run the supplied CLI with `--request REQUEST_ID --ticket YOUR_ACTUAL_TICKET_ID`.
Use `claim`, then `evidence` and `baseline`. Write a JSON plan in your ordinary
Ticket workspace, submit it with `plan --file ABSOLUTE_JSON_PATH`, and finally
call `execute`. The plan is immutable after submission. Its shape is:

```json
{
  "factCards": [{"sessionId": "source-session", "refs": ["event:sha256"], "insight": "Observed facts, inferences and contradictions"}],
  "coverage": ["event:sha256"],
  "candidates": []
}
```

Each candidate needs `refs` drawn from coverage. A skill candidate has
`kind: "skill"`, `skillId`, `entry: {content, description?, files?}`, and
`expectedDigest` from baseline (null for a new skill). A persona candidate has
`kind: "persona"`, `files`, `expectedBaseRevision`, `expectedDraftDigest` from
baseline, and `summary`. Preserve the owner's exact baseline fields. Never
invent missing values. No useful change means an empty candidates array with
honest fact cards and coverage of the evidence actually analyzed.

Submit candidates through the owner service. Never edit live skills, persona
drafts, revision pointers, test fixtures or validation receipts directly. Persona
candidates require the user's explicit approval in the persona panel. Skill
candidates must pass trusted structural, provenance, real isolated execution and
frozen holdout regression checks before their owner automatically enables them.
Self-reported success, missing tests, unavailable runners and incomplete results
are not a passing validation.

Keep the Ticket result precise: distinguish request admission, analysis,
candidate creation, validation, blocking and actual publication. Preserve owner
receipts, and reconcile uncertain commits instead of retrying writes blindly.
