import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  EMBEDDING_DIM,
  MIN_CHUNK_SIZE,
  chunkText,
  contentHash,
  distanceToSimilarity,
  estimateTokens,
  ftsQuery,
} from './chunk.mjs'

const MAX_IMPORT_ERRORS = 20

function clamp(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function likeEscape(value) {
  return String(value).replace(/[\\%_]/g, match => `\\${match}`)
}

function normalizeImportArray(payload, key) {
  if (Array.isArray(payload)) return payload
  const value = payload && typeof payload === 'object' ? payload[key] : undefined
  return Array.isArray(value) ? value : []
}

/**
 * SQLite + sqlite-vec memory backend, ported from pi-mempalace 0.2.1.
 *
 * Native modules are loaded lazily so a missing or unbuildable dependency
 * degrades only this plugin. Callers await `open()` once; all query methods
 * stay synchronous afterwards, which matches better-sqlite3 semantics.
 */
export class MemoryStore {
  constructor(options = {}) {
    if (!options.memoryDir) throw new Error('dsh-mempalace: memoryDir is required')
    this.memoryDir = path.resolve(options.memoryDir)
    this.embed = options.embed
    if (typeof this.embed !== 'function') throw new Error('dsh-mempalace: embed function is required')
    this.embeddingDim = options.embeddingDim ?? EMBEDDING_DIM
    if (this.embeddingDim !== EMBEDDING_DIM) {
      throw new Error(`dsh-mempalace: embeddingDim must be ${EMBEDDING_DIM} for Xenova/all-MiniLM-L6-v2`)
    }
    this.chunkSize = options.chunkSize ?? CHUNK_SIZE
    this.chunkOverlap = options.chunkOverlap ?? CHUNK_OVERLAP
    this.minChunkSize = options.minChunkSize ?? MIN_CHUNK_SIZE
    this.logger = options.logger ?? console
    this.db = null
    this.opened = false
    this.opening = null
    this.ftsEnabled = false
    this.lastEmbeddingError = null
    this.l1Cache = new Map()
    this.stmts = {}
  }

  get dbPath() {
    return path.join(this.memoryDir, 'memories.db')
  }

  get storePath() {
    return path.join(this.memoryDir, 'memories.jsonl')
  }

  get identityPath() {
    return path.join(this.memoryDir, 'identity.txt')
  }

  async open() {
    if (this.opened) return this
    if (this.opening) return this.opening
    this.opening = (async () => {
      fs.mkdirSync(this.memoryDir, { recursive: true })
      const databaseModule = await import('better-sqlite3')
      const Database = databaseModule.default ?? databaseModule
      const vecModule = await import('sqlite-vec')
      const loadVec = vecModule.load ?? vecModule.default?.load
      if (typeof loadVec !== 'function') throw new Error('sqlite-vec did not export load()')

      this.db = new Database(this.dbPath)
      loadVec(this.db)
      this.db.pragma('journal_mode = WAL')
      this.#createSchema()
      this.#migrateLegacyColumns()
      this.#prepare()
      this.#prepareFts()
      this.opened = true
      if (fs.existsSync(this.storePath) && this.countAll() === 0) this.migrateFromJsonl()
      return this
    })()
    try {
      return await this.opening
    } finally {
      this.opening = null
    }
  }

  #createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL UNIQUE,
        project TEXT NOT NULL DEFAULT 'general',
        topic TEXT NOT NULL DEFAULT 'general',
        source TEXT NOT NULL DEFAULT 'auto-capture',
        timestamp TEXT NOT NULL,
        session_id TEXT NOT NULL DEFAULT '',
        importance REAL DEFAULT 0.5,
        chunk_index INTEGER DEFAULT 0,
        parent_id TEXT DEFAULT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
      CREATE INDEX IF NOT EXISTS idx_memories_topic ON memories(topic);
      CREATE INDEX IF NOT EXISTS idx_memories_timestamp ON memories(timestamp);
      CREATE INDEX IF NOT EXISTS idx_memories_content_hash ON memories(content_hash);

      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        entity_type TEXT DEFAULT 'unknown',
        properties TEXT DEFAULT '{}',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
      CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);

      CREATE TABLE IF NOT EXISTS triples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        valid_from TEXT,
        valid_to TEXT,
        confidence REAL DEFAULT 1.0,
        source_memory_id TEXT,
        project TEXT DEFAULT 'general',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (subject) REFERENCES entities(id),
        FOREIGN KEY (object) REFERENCES entities(id)
      );
      CREATE INDEX IF NOT EXISTS idx_triples_subject ON triples(subject);
      CREATE INDEX IF NOT EXISTS idx_triples_object ON triples(object);
      CREATE INDEX IF NOT EXISTS idx_triples_predicate ON triples(predicate);
      CREATE INDEX IF NOT EXISTS idx_triples_valid ON triples(valid_from, valid_to);
      CREATE INDEX IF NOT EXISTS idx_triples_project ON triples(project);
    `)

    try {
      this.db.exec(`CREATE VIRTUAL TABLE vec_memories USING vec0(embedding float[${this.embeddingDim}])`)
    } catch (error) {
      if (!String(error?.message ?? error).includes('already exists')) throw error
    }
  }

  #migrateLegacyColumns() {
    for (const sql of [
      'ALTER TABLE memories ADD COLUMN chunk_index INTEGER DEFAULT 0',
      'ALTER TABLE memories ADD COLUMN parent_id TEXT DEFAULT NULL',
      'ALTER TABLE memories ADD COLUMN embedded INTEGER NOT NULL DEFAULT 1',
    ]) {
      try { this.db.exec(sql) } catch { /* column already exists */ }
    }
  }

  #prepareFts() {
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
          content, content='memories', content_rowid='rowid', tokenize='unicode61'
        );
        CREATE TRIGGER IF NOT EXISTS memories_fts_ai AFTER INSERT ON memories BEGIN
          INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
        END;
        CREATE TRIGGER IF NOT EXISTS memories_fts_ad AFTER DELETE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
        END;
        CREATE TRIGGER IF NOT EXISTS memories_fts_au AFTER UPDATE OF content ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
          INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
        END;
      `)
      const indexed = this.db.prepare('SELECT COUNT(*) AS cnt FROM memories_fts').get().cnt
      const stored = this.countAll()
      if (indexed !== stored) this.db.exec("INSERT INTO memories_fts(memories_fts) VALUES ('rebuild')")
      this.ftsEnabled = true
    } catch (error) {
      this.ftsEnabled = false
      this.logger.warn?.(`dsh-mempalace: FTS5 unavailable, keyword fallback disabled: ${error?.message ?? error}`)
    }
  }

  #prepare() {
    const db = this.db
    this.stmts.insertMemory = db.prepare(`
      INSERT INTO memories (id, content, content_hash, project, topic, source, timestamp, session_id, importance, chunk_index, parent_id, embedded)
      VALUES (@id, @content, @content_hash, @project, @topic, @source, @timestamp, @session_id, @importance, @chunk_index, @parent_id, @embedded)
    `)
    this.stmts.insertVec = db.prepare('INSERT INTO vec_memories (rowid, embedding) VALUES (?, ?)')
    this.stmts.deleteVec = db.prepare('DELETE FROM vec_memories WHERE rowid = ?')
    this.stmts.findByHash = db.prepare('SELECT id FROM memories WHERE content_hash = ?')
    this.stmts.findById = db.prepare('SELECT * FROM memories WHERE id = ?')
    this.stmts.deleteMemory = db.prepare('DELETE FROM memories WHERE id = ?')
    this.stmts.countAll = db.prepare('SELECT COUNT(*) AS cnt FROM memories')
    this.stmts.hasId = db.prepare('SELECT 1 FROM memories WHERE id = ? LIMIT 1')
  }

  countAll() {
    return this.stmts.countAll.get().cnt
  }

  #embeddingFor(text) {
    return (async () => {
      try {
        const vector = await this.embed(text)
        if (!(vector instanceof Float32Array) || vector.length !== this.embeddingDim) {
          throw new Error(`embedding length ${vector?.length ?? 0} != ${this.embeddingDim}`)
        }
        this.lastEmbeddingError = null
        return { vector, embedded: 1 }
      } catch (error) {
        this.lastEmbeddingError = error?.message ?? String(error)
        return { vector: new Float32Array(this.embeddingDim), embedded: 0 }
      }
    })()
  }

  #insertMemoryAndVec(row) {
    const insert = this.db.transaction(() => {
      const info = this.stmts.insertMemory.run(row)
      const rowid = Number(info.lastInsertRowid)
      this.stmts.insertVec.run(BigInt(rowid), row.embedding)
      return rowid
    })
    return insert()
  }

  #invalidateL1() {
    this.l1Cache.clear()
  }

  invalidateWakeup() {
    this.l1Cache.clear()
  }

  get size() {
    return this.countAll()
  }

  has(id) {
    return Boolean(this.stmts.hasId.get(id))
  }

  async store(input) {
    const content = String(input?.content ?? '').trim()
    if (!content) throw new Error('Empty content')
    const project = String(input.project || 'general')
    const topic = String(input.topic || 'general')
    const source = String(input.source || 'auto-capture')
    const timestamp = input.timestamp || new Date().toISOString()
    const sessionId = String(input.session_id || '')
    const importance = clamp(input.importance, 0, 1, 0.5)

    const chunks = chunkText(content, {
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap,
      minChunkSize: this.minChunkSize,
    })

    if (chunks.length === 1) {
      const hash = contentHash(content)
      const id = `mem_${hash}`
      if (this.stmts.findByHash.get(hash)) return { status: 'duplicate', id }
      const { vector, embedded } = await this.#embeddingFor(content)
      this.#insertMemoryAndVec({
        id,
        content,
        content_hash: hash,
        project,
        topic,
        source,
        timestamp,
        session_id: sessionId,
        importance,
        chunk_index: 0,
        parent_id: null,
        embedded,
        embedding: vector,
      })
      this.#invalidateL1()
      return { status: 'stored', id }
    }

    const baseHash = contentHash(content)
    const parentId = `mem_${baseHash}_c0`
    let stored = false
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index]
      const hash = contentHash(chunk)
      if (this.stmts.findByHash.get(hash)) continue
      const { vector, embedded } = await this.#embeddingFor(chunk)
      try {
        this.#insertMemoryAndVec({
          id: `mem_${baseHash}_c${index}`,
          content: chunk,
          content_hash: hash,
          project,
          topic,
          source,
          timestamp,
          session_id: sessionId,
          importance,
          chunk_index: index,
          parent_id: index === 0 ? null : parentId,
          embedded,
          embedding: vector,
        })
        stored = true
      } catch (error) {
        this.logger.warn?.(`dsh-mempalace: skipped chunk ${index}: ${error?.message ?? error}`)
      }
    }
    this.#invalidateL1()
    return { status: stored ? 'stored' : 'duplicate', id: parentId }
  }

  async batchStore(items) {
    if (!Array.isArray(items) || items.length === 0) throw new Error('No items provided')
    const results = []
    let stored = 0
    let duplicates = 0
    for (const item of items) {
      if (!String(item?.content ?? '').trim()) continue
      const result = await this.store(item)
      results.push(result)
      if (result.status === 'stored') stored += 1
      else duplicates += 1
    }
    return { stored, duplicates, results }
  }

  async search(query, options = {}) {
    const text = String(query ?? '').trim()
    if (!text) throw new Error('Empty query')
    const project = options.project || null
    const topic = options.topic || null
    const limit = clamp(options.n_results, 1, 20, 5)
    let semantic = null
    try {
      const vector = await this.embed(text)
      if (vector instanceof Float32Array && vector.length === this.embeddingDim) {
        semantic = this.#searchSemantic(vector, project, topic, limit)
      }
    } catch (error) {
      this.lastEmbeddingError = error?.message ?? String(error)
    }

    if (semantic && semantic.length > 0) {
      const missing = limit - semantic.length
      const extra = missing > 0 && this.ftsEnabled
        ? this.#searchKeyword(text, project, topic, missing, true).filter(
          row => !semantic.some(found => found.id === row.id),
        )
        : []
      return {
        query: text,
        filters: { project, topic },
        mode: extra.length > 0 ? 'mixed' : 'semantic',
        results: [...semantic, ...extra].slice(0, limit),
      }
    }

    if (this.ftsEnabled) {
      return {
        query: text,
        filters: { project, topic },
        mode: 'keyword',
        results: this.#searchKeyword(text, project, topic, limit, false),
      }
    }

    throw new Error(this.lastEmbeddingError
      ? `语义检索不可用（${this.lastEmbeddingError}），且关键字索引未启用`
      : '语义检索不可用，且关键字索引未启用')
  }

  #searchSemantic(vector, project, topic, limit) {
    const hasFilters = Boolean(project || topic)
    const candidateLimit = hasFilters ? Math.max(limit * 10, 50) : limit
    const vecRows = this.db.prepare(`
      SELECT rowid, distance FROM vec_memories
      WHERE embedding MATCH ? ORDER BY distance LIMIT ?
    `).all(vector, candidateLimit)
    if (vecRows.length === 0) return []

    const distances = new Map(vecRows.map(row => [row.rowid, row.distance]))
    const placeholders = vecRows.map(() => '?').join(',')
    const rows = this.db.prepare(`
      SELECT rowid, id, content, project, topic, source, timestamp, importance, chunk_index, parent_id
      FROM memories WHERE rowid IN (${placeholders}) AND embedded = 1
    `).all(...vecRows.map(row => row.rowid))

    return rows
      .filter(row => (!project || row.project === project) && (!topic || row.topic === topic))
      .map(row => ({
        id: row.id,
        text: row.content,
        project: row.project,
        topic: row.topic,
        source: row.source,
        timestamp: row.timestamp,
        importance: row.importance,
        chunk_index: row.chunk_index,
        parent_id: row.parent_id,
        similarity: Math.round(distanceToSimilarity(distances.get(row.rowid) ?? Infinity) * 10000) / 10000,
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
  }

  #searchKeyword(text, project, topic, limit, onlyUnembedded) {
    const match = ftsQuery(text)
    if (!match) return []
    const conditions = ['memories_fts MATCH ?']
    const params = [match]
    if (project) { conditions.push('m.project = ?'); params.push(project) }
    if (topic) { conditions.push('m.topic = ?'); params.push(topic) }
    if (onlyUnembedded) conditions.push('m.embedded = 0')
    try {
      const rows = this.db.prepare(`
        SELECT m.rowid, m.id, m.content, m.project, m.topic, m.source, m.timestamp,
               m.importance, m.chunk_index, m.parent_id, bm25(memories_fts) AS rank
        FROM memories_fts
        JOIN memories m ON m.rowid = memories_fts.rowid
        WHERE ${conditions.join(' AND ')}
        ORDER BY rank LIMIT ?
      `).all(...params, limit)
      return rows.map(row => ({
        id: row.id,
        text: row.content,
        project: row.project,
        topic: row.topic,
        source: row.source,
        timestamp: row.timestamp,
        importance: row.importance,
        chunk_index: row.chunk_index,
        parent_id: row.parent_id,
        similarity: Math.round(Math.min(1, 1 / (1 + Math.abs(row.rank))) * 10000) / 10000,
      }))
    } catch (error) {
      this.logger.warn?.(`dsh-mempalace: FTS query failed: ${error?.message ?? error}`)
      return this.#searchLike(text, project, topic, limit, onlyUnembedded)
    }
  }

  #searchLike(text, project, topic, limit, onlyUnembedded) {
    const conditions = ["content LIKE ? ESCAPE '\\'"]
    const params = [`%${likeEscape(text)}%`]
    if (project) { conditions.push('project = ?'); params.push(project) }
    if (topic) { conditions.push('topic = ?'); params.push(topic) }
    if (onlyUnembedded) conditions.push('embedded = 0')
    const rows = this.db.prepare(`
      SELECT rowid, id, content, project, topic, source, timestamp, importance, chunk_index, parent_id
      FROM memories WHERE ${conditions.join(' AND ')}
      ORDER BY timestamp DESC LIMIT ?
    `).all(...params, limit)
    return rows.map(row => ({
      id: row.id,
      text: row.content,
      project: row.project,
      topic: row.topic,
      source: row.source,
      timestamp: row.timestamp,
      importance: row.importance,
      chunk_index: row.chunk_index,
      parent_id: row.parent_id,
      similarity: 0,
    }))
  }

  listMemories(options = {}) {
    const conditions = []
    const params = []
    if (options.project) { conditions.push('project = ?'); params.push(options.project) }
    if (options.topic) { conditions.push('topic = ?'); params.push(options.topic) }
    if (options.source) { conditions.push('source = ?'); params.push(options.source) }
    if (options.q) {
      conditions.push("content LIKE ? ESCAPE '\\'")
      params.push(`%${likeEscape(options.q)}%`)
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = clamp(options.limit, 1, 100, 20)
    const offset = Math.max(0, Number(options.offset) || 0)
    const order = options.sort === 'oldest'
      ? 'timestamp ASC, rowid ASC'
      : options.sort === 'importance'
        ? 'importance DESC, timestamp DESC'
        : 'timestamp DESC, rowid DESC'
    const total = this.db.prepare(`SELECT COUNT(*) AS cnt FROM memories ${where}`).get(...params).cnt
    const items = this.db.prepare(`
      SELECT id, content, project, topic, source, timestamp, session_id, importance,
             chunk_index, parent_id, embedded
      FROM memories ${where} ORDER BY ${order} LIMIT ? OFFSET ?
    `).all(...params, limit, offset)
    return { items, total, limit, offset }
  }

  recall(options = {}) {
    const project = options.project || null
    const topic = options.topic || null
    const limit = clamp(options.n_results, 1, 50, 10)
    const conditions = []
    const params = []
    if (project) { conditions.push('project = ?'); params.push(project) }
    if (topic) { conditions.push('topic = ?'); params.push(topic) }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = this.db.prepare(`
      SELECT id, content, project, topic, source, timestamp
      FROM memories ${where} ORDER BY timestamp DESC LIMIT ?
    `).all(...params, limit)
    return {
      filters: { project, topic },
      count: rows.length,
      results: rows.map(row => ({
        id: row.id,
        text: row.content,
        project: row.project,
        topic: row.topic,
        source: row.source,
        timestamp: row.timestamp,
        similarity: 0,
      })),
    }
  }

  wakeup(options = {}) {
    const project = options.project || null
    const maxTokens = clamp(options.max_tokens, 64, 8000, 800)
    const maxChars = maxTokens * 4
    const key = project ?? '*'
    const cached = this.l1Cache.get(key)
    if (cached) return cached

    const parts = []
    if (fs.existsSync(this.identityPath)) {
      const identity = fs.readFileSync(this.identityPath, 'utf-8').trim()
      if (identity) parts.push(`## Identity\n${identity.slice(0, Math.min(2000, maxChars))}`)
    }
    parts.push(this.#generateL1(project, maxChars))
    const text = parts.join('\n').slice(0, maxChars)
    const result = { text, token_estimate: estimateTokens(text) }
    this.l1Cache.set(key, result)
    return result
  }

  #generateL1(project, maxChars) {
    if (this.countAll() === 0) return '\n## Recent context\nNo memories stored yet.'
    const where = project ? 'WHERE project = ?' : ''
    const params = project ? [project] : []
    const rows = this.db.prepare(`
      SELECT content, project, topic FROM memories ${where}
      ORDER BY importance DESC, timestamp DESC LIMIT 15
    `).all(...params)
    if (rows.length === 0) return '\n## Recent context\nNo memories stored yet.'

    const grouped = {}
    for (const row of rows) {
      const name = row.project || 'general'
      if (!grouped[name]) grouped[name] = []
      grouped[name].push(row)
    }
    const lines = ['\n## Recent context']
    let used = 0
    for (const [name, entries] of Object.entries(grouped).sort()) {
      if (used > maxChars) break
      lines.push(`\n[${name}]`)
      for (const row of entries.slice(0, 5)) {
        let snippet = String(row.content).trim().replace(/\n/g, ' ')
        if (snippet.length > 200) snippet = `${snippet.slice(0, 197)}...`
        const topic = row.topic && row.topic !== 'general' ? `[${row.topic}] ` : ''
        const line = `  - ${topic}${snippet}`
        used += line.length
        if (used > maxChars) {
          lines.push('  ... (use memory_search for more)')
          break
        }
        lines.push(line)
      }
    }
    return lines.join('\n')
  }

  status() {
    const projects = this.groupedCounts('project')
    return {
      memory_dir: this.memoryDir,
      store_path: this.dbPath,
      identity_exists: fs.existsSync(this.identityPath),
      total_memories: this.countAll(),
      projects,
      storage_size_kb: this.getStorageSizeKb(),
      fts_enabled: this.ftsEnabled,
      embedding_error: this.lastEmbeddingError,
    }
  }

  listProjects() {
    const status = this.status()
    return { projects: status.projects, total: status.total_memories }
  }

  delete(id) {
    const key = String(id ?? '').trim()
    if (!key) throw new Error('No id provided')
    const row = this.stmts.findById.get(key)
    if (!row) throw new Error(`Memory not found: ${key}`)
    const remove = this.db.transaction(() => {
      this.stmts.deleteVec.run(BigInt(row.rowid))
      this.stmts.deleteMemory.run(key)
    })
    remove()
    this.#invalidateL1()
    return { status: 'deleted', id: key }
  }

  computeStats() {
    const total = this.countAll()
    if (total === 0) {
      return {
        total: 0, projects: {}, topics: {}, sources: {}, sessions: 0,
        oldest: null, newest: null, timeline: {}, avgContentLength: 0,
        storageSizeKb: this.getStorageSizeKb(),
      }
    }
    const sessions = this.db.prepare(
      "SELECT COUNT(DISTINCT session_id) AS cnt FROM memories WHERE session_id != ''",
    ).get().cnt
    const oldest = this.db.prepare('SELECT MIN(timestamp) AS val FROM memories').get().val
    const newest = this.db.prepare('SELECT MAX(timestamp) AS val FROM memories').get().val
    const timeline = {}
    for (const row of this.db.prepare(
      'SELECT SUBSTR(timestamp, 1, 10) AS day, COUNT(*) AS cnt FROM memories GROUP BY day ORDER BY day',
    ).all()) timeline[row.day] = row.cnt
    const avg = this.db.prepare('SELECT AVG(LENGTH(content)) AS val FROM memories').get().val
    return {
      total,
      projects: this.groupedCounts('project'),
      topics: this.groupedCounts('topic'),
      sources: this.groupedCounts('source'),
      sessions,
      oldest,
      newest,
      timeline,
      avgContentLength: Math.round(avg || 0),
      storageSizeKb: this.getStorageSizeKb(),
    }
  }

  groupedCounts(column) {
    if (!['project', 'topic', 'source'].includes(column)) throw new Error('unsupported group column')
    const result = {}
    for (const row of this.db.prepare(
      `SELECT ${column} AS name, COUNT(*) AS cnt FROM memories GROUP BY ${column}`,
    ).all()) result[row.name || 'general'] = row.cnt
    return result
  }

  getStorageSizeKb() {
    let bytes = 0
    for (const suffix of ['', '-wal', '-shm']) {
      try { bytes += fs.statSync(`${this.dbPath}${suffix}`).size } catch { /* absent */ }
    }
    return Math.round((bytes / 1024) * 10) / 10
  }

  discoverTunnels() {
    const rows = this.db.prepare(`
      SELECT topic, project, COUNT(*) AS cnt FROM memories
      WHERE topic != 'general' GROUP BY topic, project ORDER BY cnt DESC
    `).all()
    const byTopic = {}
    for (const row of rows) {
      if (!byTopic[row.topic]) byTopic[row.topic] = []
      byTopic[row.topic].push({ project: row.project, count: row.cnt })
    }
    const tunnels = []
    for (const [topic, projects] of Object.entries(byTopic)) {
      if (projects.length < 2) continue
      for (let i = 0; i < projects.length; i += 1) {
        for (let j = i + 1; j < projects.length; j += 1) {
          const [a, b] = [projects[i], projects[j]].sort((x, y) => x.project.localeCompare(y.project))
          tunnels.push({
            topic,
            projects: [a.project, b.project],
            memoryCounts: [a.count, b.count],
          })
        }
      }
    }
    return tunnels
  }

  getPalaceGraph() {
    const projects = this.groupedCounts('project')
    const tunnels = this.discoverTunnels()
    return {
      nodes: Object.entries(projects).map(([name, count]) => ({
        name,
        memoryCount: count,
        topics: this.#projectTopics(name),
      })),
      edges: tunnels.map(tunnel => ({
        topic: tunnel.topic,
        projectA: tunnel.projects[0],
        projectB: tunnel.projects[1],
        strength: tunnel.memoryCounts[0] + tunnel.memoryCounts[1],
      })),
    }
  }

  #projectTopics(project) {
    return this.db.prepare(
      "SELECT DISTINCT topic FROM memories WHERE project = ? AND topic != 'general'",
    ).all(project).map(row => row.topic)
  }

  traverseTunnel(topic, projectA, projectB, nResults) {
    const limit = clamp(nResults, 1, 50, 10)
    return this.db.prepare(`
      SELECT id, content, project, topic, source, timestamp, importance, chunk_index, parent_id
      FROM memories WHERE topic = ? AND project IN (?, ?)
      ORDER BY timestamp DESC LIMIT ?
    `).all(topic, projectA, projectB, limit).map(row => ({
      id: row.id,
      text: row.content,
      project: row.project,
      topic: row.topic,
      source: row.source,
      timestamp: row.timestamp,
      importance: row.importance,
      chunk_index: row.chunk_index,
      parent_id: row.parent_id,
      similarity: 0,
    }))
  }

  listRooms(project) {
    const rows = project
      ? this.db.prepare('SELECT topic, COUNT(*) AS cnt FROM memories WHERE project = ? GROUP BY topic ORDER BY cnt DESC').all(project)
      : this.db.prepare('SELECT topic, COUNT(*) AS cnt FROM memories GROUP BY topic ORDER BY cnt DESC').all()
    const stmt = this.db.prepare('SELECT DISTINCT project FROM memories WHERE topic = ?')
    return rows.map(row => ({
      topic: row.topic,
      count: row.cnt,
      projects: stmt.all(row.topic).map(entry => entry.project),
    }))
  }

  getTaxonomy() {
    const rows = this.db.prepare(`
      SELECT project, topic, COUNT(*) AS cnt FROM memories
      GROUP BY project, topic ORDER BY project, cnt DESC
    `).all()
    const grouped = {}
    for (const row of rows) {
      if (!grouped[row.project]) grouped[row.project] = { topics: [], total: 0 }
      grouped[row.project].topics.push({ topic: row.topic, count: row.cnt })
      grouped[row.project].total += row.cnt
    }
    return Object.entries(grouped)
      .map(([project, value]) => ({ project, topics: value.topics, total: value.total }))
      .sort((a, b) => b.total - a.total)
  }

  async checkDuplicate(content, threshold = 0.9) {
    const text = String(content ?? '').trim()
    if (!text) return { isDuplicate: false, hashMatch: false, semanticMatch: null }
    const hash = contentHash(text)
    if (this.stmts.findByHash.get(hash)) {
      return { isDuplicate: true, hashMatch: true, semanticMatch: null }
    }
    try {
      const result = await this.search(text, { n_results: 1 })
      const first = result.results[0]
      if (first && first.similarity >= threshold) {
        return { isDuplicate: true, hashMatch: false, semanticMatch: first }
      }
    } catch { /* semantic unavailable: hash is the only signal */ }
    return { isDuplicate: false, hashMatch: false, semanticMatch: null }
  }

  addEntity(input) {
    const name = String(input?.name ?? '').trim()
    if (!name) throw new Error('Entity name is required')
    const id = input.id || `ent_${contentHash(name.toLowerCase())}`
    const existing = this.db.prepare('SELECT id FROM entities WHERE id = ?').get(id)
    const properties = input.properties === undefined ? null : JSON.stringify(input.properties)
    const type = input.entity_type || null
    if (existing) {
      this.db.prepare(`
        UPDATE entities SET name = ?,
          entity_type = COALESCE(?, entity_type),
          properties = COALESCE(?, properties)
        WHERE id = ?
      `).run(name, type, properties, id)
      return { status: 'updated', id }
    }
    this.db.prepare(
      'INSERT INTO entities (id, name, entity_type, properties, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, name, type || 'unknown', properties || '{}', new Date().toISOString())
    return { status: 'created', id }
  }

  addTriple(input) {
    const subject = String(input?.subject ?? '').trim()
    const predicate = String(input?.predicate ?? '').trim()
    const object = String(input?.object ?? '').trim()
    if (!subject || !predicate || !object) throw new Error('subject, predicate and object are required')
    const subjectId = this.addEntity({ name: subject }).id
    const objectId = this.addEntity({ name: object }).id
    const info = this.db.prepare(`
      INSERT INTO triples (subject, predicate, object, valid_from, valid_to, confidence, source_memory_id, project, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      subjectId,
      predicate,
      objectId,
      input.valid_from || null,
      input.valid_to || null,
      clamp(input.confidence, 0, 1, 1),
      input.source_memory_id || null,
      input.project || 'general',
      new Date().toISOString(),
    )
    return { status: 'created', id: Number(info.lastInsertRowid) }
  }

  queryEntity(name, options = {}) {
    const entityId = `ent_${contentHash(String(name ?? '').toLowerCase())}`
    const entity = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(entityId)
    if (!entity) return { entity: null, facts: [] }
    let query = `
      SELECT t.*, s.name AS subject_name, o.name AS object_name
      FROM triples t JOIN entities s ON t.subject = s.id JOIN entities o ON t.object = o.id
      WHERE (t.subject = ? OR t.object = ?)
    `
    const params = [entityId, entityId]
    if (options.at_time) {
      query += ' AND (t.valid_from IS NULL OR t.valid_from <= ?) AND (t.valid_to IS NULL OR t.valid_to >= ?)'
      params.push(options.at_time, options.at_time)
    }
    if (options.project) { query += ' AND t.project = ?'; params.push(options.project) }
    query += ' ORDER BY t.created_at DESC'
    return {
      entity: {
        id: entity.id,
        name: entity.name,
        type: entity.entity_type,
        properties: JSON.parse(entity.properties || '{}'),
      },
      facts: this.db.prepare(query).all(...params).map(row => ({
        subject: row.subject_name,
        predicate: row.predicate,
        object: row.object_name,
        valid_from: row.valid_from,
        valid_to: row.valid_to,
        confidence: row.confidence,
        project: row.project,
        id: row.id,
      })),
    }
  }

  queryByPredicate(predicate, options = {}) {
    let query = `
      SELECT t.*, s.name AS subject_name, o.name AS object_name
      FROM triples t JOIN entities s ON t.subject = s.id JOIN entities o ON t.object = o.id
      WHERE t.predicate = ?
    `
    const params = [predicate]
    if (options.at_time) {
      query += ' AND (t.valid_from IS NULL OR t.valid_from <= ?) AND (t.valid_to IS NULL OR t.valid_to >= ?)'
      params.push(options.at_time, options.at_time)
    }
    if (options.project) { query += ' AND t.project = ?'; params.push(options.project) }
    query += ' ORDER BY t.created_at DESC'
    return this.db.prepare(query).all(...params).map(row => ({
      subject: row.subject_name,
      predicate: row.predicate,
      object: row.object_name,
      valid_from: row.valid_from,
      valid_to: row.valid_to,
      confidence: row.confidence,
      project: row.project,
      id: row.id,
    }))
  }

  invalidateTriple(tripleId, validTo) {
    const id = Number(tripleId)
    if (!Number.isInteger(id)) throw new Error('triple id must be an integer')
    const info = this.db.prepare('UPDATE triples SET valid_to = ? WHERE id = ?')
      .run(validTo || new Date().toISOString(), id)
    if (info.changes === 0) throw new Error(`Triple not found: ${id}`)
    return { status: 'invalidated', id }
  }

  knowledgeStats() {
    const entityCount = this.db.prepare('SELECT COUNT(*) AS cnt FROM entities').get().cnt
    const tripleCount = this.db.prepare('SELECT COUNT(*) AS cnt FROM triples').get().cnt
    const activeTriples = this.db.prepare('SELECT COUNT(*) AS cnt FROM triples WHERE valid_to IS NULL').get().cnt
    const entityTypes = {}
    for (const row of this.db.prepare('SELECT entity_type, COUNT(*) AS cnt FROM entities GROUP BY entity_type').all()) {
      entityTypes[row.entity_type] = row.cnt
    }
    const predicates = {}
    for (const row of this.db.prepare('SELECT predicate, COUNT(*) AS cnt FROM triples GROUP BY predicate ORDER BY cnt DESC LIMIT 20').all()) {
      predicates[row.predicate] = row.cnt
    }
    return { entityCount, tripleCount, activeTriples, entityTypes, predicates }
  }

  listEntities(options = {}) {
    const limit = clamp(options.limit, 1, 200, 50)
    const q = String(options.q ?? '').trim()
    const rows = q
      ? this.db.prepare('SELECT * FROM entities WHERE name LIKE ? ORDER BY name LIMIT ?').all(`%${likeEscape(q)}%`, limit)
      : this.db.prepare('SELECT * FROM entities ORDER BY name LIMIT ?').all(limit)
    const factCount = this.db.prepare('SELECT COUNT(*) AS cnt FROM triples WHERE subject = ? OR object = ?')
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      type: row.entity_type,
      properties: JSON.parse(row.properties || '{}'),
      facts: factCount.get(row.id, row.id).cnt,
    }))
  }

  kgTimeline(entity) {
    const base = `
      SELECT t.id, t.predicate, t.valid_from, t.valid_to, t.confidence, t.project, t.created_at,
             s.name AS subject_name, o.name AS object_name
      FROM triples t JOIN entities s ON t.subject = s.id JOIN entities o ON t.object = o.id
    `
    const rows = entity
      ? this.db.prepare(`${base} WHERE t.subject = ? OR t.object = ? ORDER BY COALESCE(t.valid_from, t.created_at) ASC`)
        .all(`ent_${contentHash(entity.toLowerCase())}`, `ent_${contentHash(entity.toLowerCase())}`)
      : this.db.prepare(`${base} ORDER BY COALESCE(t.valid_from, t.created_at) ASC`).all()
    return rows.map(row => ({
      id: row.id,
      subject: row.subject_name,
      predicate: row.predicate,
      object: row.object_name,
      valid_from: row.valid_from,
      valid_to: row.valid_to,
      confidence: row.confidence,
      project: row.project,
      created_at: row.created_at,
    }))
  }

  findTriple(subject, predicate, object) {
    return this.db.prepare(`
      SELECT id FROM triples
      WHERE subject = ? AND predicate = ? AND object = ? AND valid_to IS NULL
      ORDER BY created_at DESC LIMIT 1
    `).get(
      `ent_${contentHash(String(subject).toLowerCase())}`,
      predicate,
      `ent_${contentHash(String(object).toLowerCase())}`,
    )?.id ?? null
  }

  findAnyTriple(subject, predicate, object) {
    return this.db.prepare(`
      SELECT id FROM triples WHERE subject = ? AND predicate = ? AND object = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(
      `ent_${contentHash(String(subject).toLowerCase())}`,
      predicate,
      `ent_${contentHash(String(object).toLowerCase())}`,
    )?.id ?? null
  }

  async diaryWrite(input) {
    const agentName = String(input?.agent_name ?? 'agent').trim() || 'agent'
    const entry = String(input?.entry ?? '').trim()
    if (!entry) throw new Error('Diary entry is required')
    return this.store({
      content: entry,
      project: input.project || `diary-${agentName.toLowerCase().replace(/\s+/g, '_')}`,
      topic: input.topic || 'diary',
      source: 'diary',
      importance: 0.7,
      timestamp: new Date().toISOString(),
    })
  }

  diaryRead(input = {}) {
    const agentName = String(input.agent_name ?? 'agent').trim() || 'agent'
    const project = input.project || `diary-${agentName.toLowerCase().replace(/\s+/g, '_')}`
    const limit = clamp(input.last_n, 1, 100, 10)
    const rows = this.db.prepare(`
      SELECT * FROM (
        SELECT id, content, project, topic, source, timestamp
        FROM memories WHERE project = ? AND source = 'diary'
        ORDER BY timestamp DESC LIMIT ?
      ) ORDER BY timestamp ASC
    `).all(project, limit)
    return rows.map(row => ({
      id: row.id,
      text: row.content,
      project: row.project,
      topic: row.topic,
      source: row.source,
      timestamp: row.timestamp,
      similarity: 0,
    }))
  }

  exportAll() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      memories: this.db.prepare(`
        SELECT id, content, project, topic, source, timestamp, session_id, importance,
               chunk_index, parent_id, embedded
        FROM memories ORDER BY timestamp ASC
      `).all(),
      entities: this.db.prepare('SELECT id, name, entity_type, properties, created_at FROM entities').all(),
      triples: this.db.prepare(`
        SELECT id, subject, predicate, object, valid_from, valid_to, confidence,
               source_memory_id, project, created_at FROM triples ORDER BY id ASC
      `).all(),
    }
  }

  async importAll(payload) {
    const memories = normalizeImportArray(payload, 'memories')
    const entities = normalizeImportArray(payload, 'entities')
    const triples = normalizeImportArray(payload, 'triples')
    const summary = {
      memories: { stored: 0, duplicate: 0, skipped: 0 },
      entities: { created: 0, updated: 0, skipped: 0 },
      triples: { created: 0, duplicate: 0, skipped: 0 },
      errors: [],
    }
    const fail = (message) => {
      if (summary.errors.length < MAX_IMPORT_ERRORS) summary.errors.push(message)
    }

    for (const [index, item] of memories.entries()) {
      if (!item || typeof item.content !== 'string' || !item.content.trim()) {
        summary.memories.skipped += 1
        continue
      }
      try {
        const result = await this.store({
          content: item.content,
          project: item.project,
          topic: item.topic,
          source: item.source || 'import',
          timestamp: item.timestamp,
          session_id: item.session_id || '',
          importance: item.importance,
        })
        if (result.status === 'stored') summary.memories.stored += 1
        else summary.memories.duplicate += 1
      } catch (error) {
        summary.memories.skipped += 1
        fail(`memory[${index}]: ${error?.message ?? error}`)
      }
    }

    for (const [index, item] of entities.entries()) {
      if (!item || typeof item.name !== 'string' || !item.name.trim()) {
        summary.entities.skipped += 1
        continue
      }
      try {
        const result = this.addEntity({
          id: typeof item.id === 'string' ? item.id : undefined,
          name: item.name,
          entity_type: item.entity_type || item.type,
          properties: item.properties,
        })
        summary.entities[result.status] += 1
      } catch (error) {
        summary.entities.skipped += 1
        fail(`entity[${index}]: ${error?.message ?? error}`)
      }
    }

    const nameById = new Map(
      this.db.prepare('SELECT id, name FROM entities').all().map(row => [row.id, row.name]),
    )
    for (const [index, item] of triples.entries()) {
      if (!item || typeof item.predicate !== 'string') {
        summary.triples.skipped += 1
        continue
      }
      const subject = item.subject_name || nameById.get(item.subject) || item.subject
      const object = item.object_name || nameById.get(item.object) || item.object
      if (!subject || !object) {
        summary.triples.skipped += 1
        continue
      }
      if (this.findAnyTriple(subject, item.predicate, object)) {
        summary.triples.duplicate += 1
        continue
      }
      try {
        this.addTriple({
          subject,
          predicate: item.predicate,
          object,
          valid_from: item.valid_from,
          valid_to: item.valid_to,
          confidence: item.confidence,
          source_memory_id: item.source_memory_id,
          project: item.project,
        })
        summary.triples.created += 1
      } catch (error) {
        summary.triples.skipped += 1
        fail(`triple[${index}]: ${error?.message ?? error}`)
      }
    }

    this.#invalidateL1()
    return summary
  }

  async reindex() {
    const rows = this.db.prepare('SELECT rowid, content FROM memories WHERE embedded = 0 ORDER BY rowid').all()
    const result = { total: rows.length, updated: 0, failed: 0, errors: [] }
    for (const row of rows) {
      try {
        const vector = await this.embed(row.content)
        if (!(vector instanceof Float32Array) || vector.length !== this.embeddingDim) {
          throw new Error('embedding shape mismatch')
        }
        const update = this.db.transaction(() => {
          this.stmts.deleteVec.run(BigInt(row.rowid))
          this.stmts.insertVec.run(BigInt(row.rowid), vector)
          this.db.prepare('UPDATE memories SET embedded = 1 WHERE rowid = ?').run(row.rowid)
        })
        update()
        result.updated += 1
      } catch (error) {
        result.failed += 1
        if (result.errors.length < MAX_IMPORT_ERRORS) result.errors.push(error?.message ?? String(error))
      }
    }
    return result
  }

  checkpoint() {
    this.db.pragma('wal_checkpoint(TRUNCATE)')
    return { status: 'checkpointed' }
  }

  vacuum() {
    this.db.exec('VACUUM')
    return { status: 'vacuumed' }
  }

  migrateFromJsonl(jsonlPath = this.storePath) {
    if (!fs.existsSync(jsonlPath)) return { migrated: 0 }
    const lines = fs.readFileSync(jsonlPath, 'utf-8').trim().split('\n').filter(Boolean)
    let migrated = 0
    const insert = this.db.transaction(() => {
      for (const line of lines) {
        let memory
        try { memory = JSON.parse(line) } catch { continue }
        if (!memory?.content || !memory?.id) continue
        const hash = contentHash(memory.content)
        if (this.stmts.findByHash.get(hash)) continue
        let vector
        try {
          const buffer = Buffer.from(memory.embedding, 'base64')
          vector = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
        } catch { continue }
        if (vector.length !== this.embeddingDim) continue
        try {
          this.#insertMemoryAndVec({
            id: memory.id,
            content: memory.content,
            content_hash: hash,
            project: memory.metadata?.project || 'general',
            topic: memory.metadata?.topic || 'general',
            source: memory.metadata?.source || 'import',
            timestamp: memory.metadata?.timestamp || new Date().toISOString(),
            session_id: memory.metadata?.session_id || '',
            importance: 0.5,
            chunk_index: 0,
            parent_id: null,
            embedded: 1,
            embedding: vector,
          })
          migrated += 1
        } catch { /* duplicate or corrupt row */ }
      }
    })
    insert()
    try { fs.renameSync(jsonlPath, `${jsonlPath}.bak`) } catch { /* leave original */ }
    if (migrated > 0) this.#invalidateL1()
    return { migrated }
  }

  async backup(destination) {
    const target = path.resolve(destination)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    await this.db.backup(target)
    return { path: target, sizeKb: Math.round((fs.statSync(target).size / 1024) * 10) / 10 }
  }

  close() {
    if (!this.db) return
    try { this.db.pragma('wal_checkpoint(TRUNCATE)') } catch { /* best effort */ }
    this.db.close()
    this.db = null
    this.opened = false
    this.l1Cache.clear()
  }
}
