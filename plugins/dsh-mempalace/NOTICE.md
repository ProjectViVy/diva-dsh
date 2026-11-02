# Upstream notice

`dsh-mempalace` is a DeepSeek Harness port of **pi-mempalace** 0.2.1.

- Upstream: <https://github.com/Jabbslad/pi-mempalace>
- License: MIT
- Ported files: the SQLite + sqlite-vec data layer and tool semantics from
  `extensions/pi-mempalace/memory_store.ts` and `extensions/pi-mempalace/index.ts`.
- Replaced: the pi terminal extension, TUI overlay, typebox schemas, and pi
  lifecycle hooks. The dsh port uses Cordis lifecycle, dsh tools/commands,
  a local HTTP API, and a web management panel.

The upstream project is MIT-licensed. This port keeps the upstream storage
schema and retrieval behaviour so existing pi-mempalace data can be imported
through the panel or `POST /dsh-mempalace/api/import`.
