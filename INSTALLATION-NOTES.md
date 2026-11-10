# Local installation

Project cloned on 2026-11-09. Runtime and authenticated panel verified at http://127.0.0.1:3082.

Run `npm start`, `npm run status`, or `npm run stop` in this directory. `npm start` prints the current login link. Model credentials and external accounts are not configured.

Local compatibility adjustments:
- scripts/lib/source.mjs: convert the tsx --import path to a file URL on Windows (issue #1).
- patches/superagent-windows.patch: select PowerShell for the orchestrator on Windows; bundle rebuilt with the project patches.
- plugins/dsh-continual-harness/_shared: local junction to ../_shared so emitted JavaScript resolves shared IPC.
- scripts/lib/surfcore-component-pins.json: pin bridge.js to the verified clean commit instead of an unpublished author workspace change; pinned source bytes restored from Git for newline-sensitive hashes.

Validation:
- DSH artifact build: 7 gates passed.
- Native SQLite and sqlite-vec installation probe passed.
- Startup: runtime ready, errors empty, GitHub integration off.
- Authenticated panel: HTTP 200.
- Full repository test run was not green; see .artifacts/installation-tests-final.log. Some failures are Windows path/ESM URL/newline handling and plugin tests.
- Startup logged a dsh-vivy-tone prompts HTTP 404; core runtime nevertheless reached ready.

Test totals:
```
ℹ tests 1238
ℹ pass 1083
ℹ fail 149
ℹ skipped 6
ℹ duration_ms 67644.8938
```

Failed test names (as reported):

- QQ alignment scan retries rotation before writing any candidates
- the internal handler answers the component surface
- 挂上了（面板 401 = 会话中间件在拦）→ 退出码 0 并给出下一步
- 没挂上（asr 404 而对照 voice 401）→ 退出码 1 且点名"重启"
- 路由在了但 connection 服务缺失（503）→ 不许说成"没挂上"
- 插件入口导出契约：名字、两个必需服务、apply
- project loader exposes message feed pagination without changing IDs
- DM peek runs through the project loader without advancing either cursor mode
- owner DM peek does not advance the cursor when the latest message is from self
- initializing or updating all-person DM mode preserves the owner cursor
- malformed DM session responses cannot initialize the all-person baseline
- invalid DM cursor contents are preserved by polling, baseline and acknowledgement
- DM baseline preserves the previous cursor if atomic publication fails
- migrated Bilibili watch history combines platform records with independent memory through the real loader
- migration copies public feed and legacy session inputs into the memory inbox and records verified sources
- moving a project rewrites only its own pinned profile links and matching lock specifiers
- profile dependency relocation resumes after interruption between its two files
- profile dependency relocation leaves unrelated links sharing an old path prefix untouched
- relocated profile links pass a real offline frozen pnpm install
- paths default inside the project home and only accept absolute overrides
- the state directory is 0700, the database 0600, and durability pragmas are set
- the declared append-only and domain guards all exist in the schema
- updating or deleting a stored evidence row is refused by the database itself
- a snapshot backup is readable, private, and refused while writes are still pending
- recordEvidence stores one row and returns its content address
- replaying the same evidence is idempotent even with a different clock
- a dedupe key reused with different content conflicts instead of overwriting
- a dedupe key is derived when absent and a ticket stays optional
- evidence must carry a locator and a summary
- derived material must cite evidence that is already stored
- a record over the configured ceiling is refused before it reaches the file
- an unusable subject or a foreign subject closes the loop with zero rows
- a proposal needs a ticket and a candidate that belongs to one owner
- the candidate body stays outside the store and only its digest is recorded
- replaying a proposal is idempotent and rewriting its head version conflicts
- a proposal must stand on stored evidence, and derived material alone is not enough
- the ticket of a proposal may not disagree with the evidence it cites
- advancing a proposal needs the current digest and appends a version row
- an unknown or terminal proposal cannot be advanced
- a validation binds to the proposal head it actually checked
- the verdict must be stated, and a failed one is still kept
- a publish needs a passed validation bound to the proposal head
- the library itself refuses a live publish without a matching passed validation
- an owner without versioned writes keeps the candidate a proposal
- a live publication must carry the owner reference and only its declared fields
- publishing marks the proposal published and appends one live row
- one validation supports exactly one publication
- a stale expectedLivePublicationId conflicts and writes nothing
- a second live row for one asset is refused by the library
- rollback appends a new live row and keeps every historical row
- publish-knowledge commits through the owner and records its reference
- generic publish and rollback refuse MemPalace without the owner API
- rollback-knowledge rolls the owner back and records the new revision
- a rolled-back owner revision is never recorded as a live publication
- an expectedLiveDigest that disagrees with the live publication conflicts before the owner commits
- publish-knowledge forwards the caller anchor so the store re-checks it after the owner commit
- a failed rollback record is reconciled by retrying with the same commitKey
- a failed owner reference compensates the commit and records nothing
- an owner RPC error is reconciled through status, never retried
- verifyHistory recomputes digests, links and guards
- verifyHistory reports a record whose stored digest no longer matches
- getRecord reads the head version and can replay the whole history
- listByTicket groups every kind that shares one ticket
- a ticket query walks the index instead of scanning the history
- records of another subject never surface in a query
- listing proposals filters by state and clamps the page size
- listing publications and validations keeps one row per record
- GET /store describes the database without ever failing the panel
- the record routes keep the loopback, origin and session guards
- POST /evidence and GET /evidence round-trip one record
- the write routes reject junk bodies and stale expectations
- the panel can follow one ticket end to end through the API
- GET /verify sweeps the store and clamps its budget
- a body over the ceiling is refused with 413 and nothing is written
- POST /publish-knowledge and /rollback-knowledge use the configured owner
- the evolution CSS keeps every selector prefixed and only animates evo-in
- the internal endpoint opens the store lazily and only behind the component token
- a refused cross-domain edit becomes one Evidence and one Proposal, digest only
- every owned kind in one refinement is handed over separately
- a missing ticket writes the ledger, raises nothing, and creates no Proposal
- the pending ledger drains on the next forward and the file is deleted
- replaying the same candidate adds no second row
- an unavailable Evolution defers the ticket-bearing candidate and load drains it
- 路径安全：越界、编码绕过、非法编码都拿不到文件
- 工具层：schema 能被宿主的真校验器接受
- records, updates and restores from another subject are rejected
- QQ public sync retries a snapshot when the bridge rotates the feed during reading
- reopening the store keeps the archive columns and stays idempotent
- the same archive_id cannot be written twice, even across chunked bodies
- archive rows are derived from archive_id and chain their chunks
- an archived body coexists with an auto-captured copy of the same text
- reindex keeps archived content byte-identical
- archive lookup answers by archive_id and a deleted ledger row reads back as absent
- rows that disagree on digest are reported as a conflict, never a receipt
- a knowledge commit stores one live revision with a digest
- the same commit key replays the first revision and never writes twice
- a commit compares and swaps on the expected revision
- every required check must pass before a commit is applied
- invalidation and rollback change only validity, never delete history
- rolling back to zero revokes every commit in the range
- status can resolve commit keys for unknown-outcome reconciliation
- an omitted expected revision tracks the head revision
- a reused commit key with different content writes nothing
- service writes entities, triples and invalidations through one ledger
- knowledge tools write through the ledger and report the revision
- lists knowledge commits newest first with scope and limit filters
- legacy config is backed up byte-for-byte and rewritten without retired keys
- identity.txt is backed up and archived without leaving a live persona file
- an existing archive copy is reused only when its bytes match
- memory store round trip covers search, pagination, duplicates and wake-up
- long content is chunked with parent links and remains searchable
- palace graph, tunnels, rooms and taxonomy group multi-project topics
- temporal knowledge graph supports entities, facts, invalidation and timelines
- diary reads the latest entries in chronological order
- export and import round-trip memories, entities and triples
- missing embeddings degrade to keyword search and reindex restores vectors
- closing and reopening the store keeps persisted memories
- memory names MemPalace only in the single component call
- MemPalace retires identity.txt only in the one-time migration
- MemPalace no longer reads identity.txt
- the record layer is the only place that opens a database
- the mutation scanner detects a synthetic violation
- standalone mempalace installation confines caches and temporary files to the project
- a fresh profile receives a local state directory and requested port
- setup relocates its own profile state path after the whole project moves
- a build patch is restored even when the build fails
- the build patch handles mixed line endings across source files
- setup initializes an empty nested submodule at the recorded commit
- multiple build patches apply in order and restore in reverse
- a later patch failure restores the earlier patches
- the pinned SurfCore sources carry the ingest anchors exactly once and stay untouched
- a moved project can rebuild its own SurfCore adapter links
- Bilibili night planning honors zero limits and appends events to the local diary log
- Bilibili selftest reads the project configuration and fails when dependency checks fail
- Bilibili dependency probe preserves existing files and cleans up its own temporary directory
- the actual SurfCore loader applies the role-free alignment brief transformation
- SurfCore startup restores only globally enabled extension activation without starting platforms
- Bilibili wake prompt uses project-local tool and diary paths without role cards
- transformed SurfCore host starts offline and rejects removed management routes
- configuration
- voice core audio library resolution stays inside the library
- installer child uses project-local home, temporary and package cache paths
- a startup timeout reports cleanup failure and keeps the workers tracked
- offline voice pack import preserves its source and repairs paths in the final project directory
- offline import accepts the project-local Python layout produced by online installation
- a bundled voice pack repairs its paths after moving the project directory
- synthesis talks to the selected loopback engine and stores audio inside its own state directory
- voice preview uses the selected local route and writes only into the voice cache
- 宿主半边满足 Loader 契约（设置页逻辑全在浏览器端）
- failing tests:
- resolves the state directory the same way for the plugin and the CLI
