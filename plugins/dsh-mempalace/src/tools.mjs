import { normalizeProjectLabel, normalizeTopicLabel } from './store/chunk.mjs'

const MAX_TOOL_TEXT = 24_000
const MAX_GRAPH_TEXT = 12_000

const outputSchema = {
  type: 'object',
  properties: {
    text: { type: 'string', description: 'Model-facing summary of the result.' },
    data: { description: 'Structured result for diagnostics and UI consumers.' },
  },
  required: ['text'],
  additionalProperties: false,
}

function parameters(properties, required = []) {
  return { type: 'object', properties, required, additionalProperties: false }
}

function render(value) {
  return [{ type: 'text', text: String(value?.text ?? '') }]
}

function result(text, data) {
  return data === undefined ? { text } : { text, data }
}

function truncate(text, limit = MAX_TOOL_TEXT) {
  return text.length > limit
    ? `${text.slice(0, limit)}\n...[truncated at ${limit} characters; use the 记忆宫殿 panel for the full result]`
    : text
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function invalid(message) {
  const error = new Error(`INVALID_ARGS: ${message}`)
  error.code = 'INVALID_ARGS'
  throw error
}

function wrapError(error) {
  const hint = typeof error?.hint === 'string' && error.hint.length > 0 ? ` — ${error.hint}` : ''
  return new Error(`${errorMessage(error)}${hint}`)
}

function requireString(args, name, { max = 20_000 } = {}) {
  const value = typeof args?.[name] === 'string' ? args[name].trim() : ''
  if (!value) invalid(`"${name}" must be a non-empty string`)
  if (value.length > max) invalid(`"${name}" exceeds ${max} characters`)
  return value
}

function optionalString(args, name, { max = 200 } = {}) {
  if (args?.[name] === undefined || args?.[name] === null) return ''
  if (typeof args[name] !== 'string') invalid(`"${name}" must be a string`)
  const value = args[name].trim()
  if (value.length > max) invalid(`"${name}" exceeds ${max} characters`)
  return value
}

function optionalNumber(args, name, { min = -Infinity, max = Infinity } = {}) {
  if (args?.[name] === undefined || args?.[name] === null) return undefined
  const value = Number(args[name])
  if (!Number.isFinite(value)) invalid(`"${name}" must be a number`)
  if (value < min || value > max) invalid(`"${name}" must be between ${min} and ${max}`)
  return value
}

function formatMemory(item) {
  const score = typeof item.similarity === 'number' && item.similarity > 0
    ? ` (${(item.similarity * 100).toFixed(1)}% match)`
    : ''
  return `[${item.project}/${item.topic}]${score} ${item.timestamp}\n${item.text}`
}

function formatFacts(facts) {
  return facts.map(fact => {
    const span = [fact.valid_from, fact.valid_to].filter(Boolean).join(' → ')
    const validity = span ? ` [${span}]` : ''
    return `- ${fact.subject} ${fact.predicate} ${fact.object}${validity} (confidence ${fact.confidence}, ${fact.project})`
  }).join('\n')
}

/**
 * Build the tool definitions bound to one service instance.
 * @param {import('./service.mjs').MempalaceService} service
 * @returns {Array<Record<string, unknown>>}
 */
export function createTools(service) {
  function projectFor(args, exec, { defaultToSession = false } = {}) {
    const explicit = optionalString(args, 'project')
    if (explicit) return normalizeProjectLabel(explicit)
    if (!defaultToSession || exec?.agent === undefined) return ''
    return service.getSessionProject(exec.agent.session)
  }

  const definitions = [
    {
      name: 'memory_search',
      description:
        'Search stored memories with local semantic similarity, keyword search, or SQLite full-text fallback. '
        + 'Use it for past decisions, previous conversations, and "what did we decide about X" questions. '
        + 'Filter by project or topic when the question names one. Every result carries a similarity score '
        + 'and an id that memory_delete accepts. The response reports mode=keyword when the embedding model is unavailable.',
      parameters: parameters({
        query: { type: 'string', description: 'What to search for, in natural language.' },
        project: { type: 'string', description: 'Optional project filter.' },
        topic: { type: 'string', description: 'Optional topic filter.' },
        n_results: { type: 'integer', minimum: 1, maximum: 20, description: 'Results to return (default 5, max 20).' },
      }, ['query']),
      output: { schema: outputSchema, render },
      async execute(args, exec) {
        try {
          const query = requireString(args, 'query', { max: 2_000 })
          const search = await service.search(query, {
            project: projectFor(args, exec) || null,
            topic: optionalString(args, 'topic') || null,
            n_results: optionalNumber(args, 'n_results', { min: 1, max: 20 }),
          })
          if (search.results.length === 0) {
            return result(`No memories found for: "${query}"`, { mode: search.mode, count: 0 })
          }
          const text = [
            `Found ${search.results.length} memories for "${query}" (${search.mode} search):`,
            '',
            ...search.results.map(formatMemory),
          ].join('\n\n---\n\n')
          return result(truncate(text), { mode: search.mode, count: search.results.length, query })
        } catch (error) {
          throw wrapError(error)
        }
      },
    },
    {
      name: 'memory_save',
      description:
        'Explicitly save important information to persistent memory. Use it when the user says "remember this", '
        + 'or when a decision, preference, or durable fact is established. Include enough context to be useful '
        + 'in a later session. Set project and topic for organization; importance 0.0-1.0 controls wake-up ranking.',
      parameters: parameters({
        content: { type: 'string', description: 'The information to remember, with its context.' },
        project: { type: 'string', description: 'Project this belongs to (defaults to the session project).' },
        topic: { type: 'string', description: 'Topic category such as auth, database, or architecture.' },
        importance: { type: 'number', minimum: 0, maximum: 1, description: 'Importance weight 0.0-1.0 (default 0.8).' },
      }, ['content']),
      output: { schema: outputSchema, render },
      async execute(args, exec) {
        try {
          const content = requireString(args, 'content', { max: 20_000 })
          const project = projectFor(args, exec, { defaultToSession: true })
          const topic = optionalString(args, 'topic')
          const saved = await service.saveMemory({
            content,
            project: project || undefined,
            topic: topic ? normalizeTopicLabel(topic) : '',
            source: 'manual-save',
            importance: optionalNumber(args, 'importance', { min: 0, max: 1 }) ?? 0.8,
            session_id: String(exec?.agent?.session?.id ?? ''),
          })
          if (saved.status === 'duplicate') {
            return result(`This memory already exists (${saved.id}).`, { status: 'duplicate', id: saved.id })
          }
          return result(`Saved to memory (${saved.id}) in ${project || 'general'}/${topic || 'inferred'}.`, {
            status: 'stored', id: saved.id, project: project || 'general',
          })
        } catch (error) {
          throw wrapError(error)
        }
      },
    },
    {
      name: 'memory_recall',
      description:
        'Browse recent memories by project or topic metadata instead of semantic similarity. '
        + 'Use it for "what have we been working on in project X" questions. Defaults to the current session project '
        + 'so a bare call gives project context; pass an explicit project (including "general") to override.',
      parameters: parameters({
        project: { type: 'string', description: 'Project filter (defaults to the session project).' },
        topic: { type: 'string', description: 'Topic filter.' },
        n_results: { type: 'integer', minimum: 1, maximum: 50, description: 'Results to return (default 10, max 50).' },
      }, []),
      output: { schema: outputSchema, render },
      async execute(args, exec) {
        try {
          const project = projectFor(args, exec, { defaultToSession: true }) || null
          const topic = optionalString(args, 'topic') || null
          const recall = await service.recall({
            project,
            topic,
            n_results: optionalNumber(args, 'n_results', { min: 1, max: 50 }),
          })
          if (recall.results.length === 0) {
            return result(`No memories found for: ${[project, topic].filter(Boolean).join('/') || 'all'}`, { count: 0 })
          }
          const label = [project, topic].filter(Boolean).join('/') || 'all projects'
          const text = [
            `${recall.results.length} memories for ${label}:`,
            '',
            ...recall.results.map(formatMemory),
          ].join('\n\n---\n\n')
          return result(truncate(text), { count: recall.results.length, project, topic })
        } catch (error) {
          throw wrapError(error)
        }
      },
    },
    {
      name: 'memory_status',
      description:
        'Show the memory store overview: total memories, project distribution, storage size, embedding/keyword backend '
        + 'health, auto-capture and wake-up settings, knowledge-graph counts, and palace tunnel count.',
      parameters: parameters({}),
      output: { schema: outputSchema, render },
      async execute() {
        try {
          const snapshot = await service.statusSnapshot()
          const lines = ['## Memory Status', '']
          if (snapshot.state !== 'ready') {
            lines.push(`- **Backend**: ${snapshot.state}${snapshot.error ? ` — ${snapshot.error}` : ''}`)
            if (snapshot.hint) lines.push(`- **Hint**: ${snapshot.hint}`)
            return result(lines.join('\n'), snapshot)
          }
          const stats = snapshot.stats
          const store = snapshot.store
          lines.push(
            `- **Total memories**: ${stats.total}`,
            `- **Storage**: ${stats.storageSizeKb} KB`,
            `- **Sessions**: ${stats.sessions}`,
            `- **Embedding backend**: ${snapshot.models.embedding}${store.embedding_error ? ` (${store.embedding_error})` : ''}`,
            `- **Keyword index**: ${snapshot.fts.enabled ? 'enabled' : 'disabled'}`,
            `- **Auto-capture**: ${snapshot.config.autoCapture ? 'on' : 'off'}`,
            `- **Wake-up**: ${snapshot.config.wakeUpEnabled ? 'on' : 'off'}`,
            `- **Default project**: ${snapshot.config.defaultProject || '(session project)'}`,
          )
          if (store.identity_exists) lines.push('- **Identity**: configured')
          if (stats.oldest) lines.push(`- **Range**: ${stats.oldest} → ${stats.newest}`)
          const projects = Object.entries(stats.projects)
          if (projects.length > 0) {
            lines.push('', '### Projects')
            for (const [name, count] of projects.sort((a, b) => b[1] - a[1])) {
              lines.push(`- ${name}: ${count}`)
            }
          }
          const knowledge = await service.knowledgeStats().catch(() => null)
          if (knowledge && knowledge.entityCount > 0) {
            lines.push('', '### Knowledge Graph', `- Entities: ${knowledge.entityCount}`, `- Facts: ${knowledge.tripleCount} (${knowledge.activeTriples} active)`)
          }
          const palace = await service.palace().catch(() => null)
          if (palace && palace.edges.length > 0) {
            lines.push('', '### Palace Tunnels', `- ${palace.edges.length} tunnel(s) connect projects`)
          }
          return result(lines.join('\n'), snapshot)
        } catch (error) {
          throw wrapError(error)
        }
      },
    },
    {
      name: 'memory_graph',
      description:
        'Show the palace graph: projects are nodes and shared non-general topics create tunnel edges between them. '
        + 'Use it to discover cross-project relationships and to find a topic worth traversing with memory_tunnel.',
      parameters: parameters({}),
      output: { schema: outputSchema, render },
      async execute() {
        try {
          const graph = await service.palace()
          if (graph.nodes.length === 0) return result('No projects in the palace yet.', graph)
          const lines = ['## Palace Graph', '', '### Wings (projects)']
          for (const node of [...graph.nodes].sort((a, b) => b.memoryCount - a.memoryCount)) {
            const rooms = node.topics.length > 0 ? ` — rooms: ${node.topics.join(', ')}` : ''
            lines.push(`- **${node.name}** (${node.memoryCount} memories)${rooms}`)
          }
          lines.push('', '### Tunnels (shared topics)')
          if (graph.edges.length === 0) {
            lines.push('No tunnels yet: every topic is project-unique. Sharing a topic across projects creates a tunnel.')
          } else {
            for (const edge of [...graph.edges].sort((a, b) => b.strength - a.strength)) {
              lines.push(`- **${edge.projectA}** ↔ **${edge.projectB}** via "${edge.topic}" (${edge.strength} memories)`)
            }
          }
          return result(truncate(lines.join('\n'), MAX_GRAPH_TEXT), graph)
        } catch (error) {
          throw wrapError(error)
        }
      },
    },
    {
      name: 'memory_tunnel',
      description:
        'Traverse a palace tunnel: return recent memories on one shared topic from two projects. '
        + 'Use it after memory_graph reports a tunnel, to compare how the same concern appears in each project.',
      parameters: parameters({
        topic: { type: 'string', description: 'The shared topic to traverse.' },
        project_a: { type: 'string', description: 'First project.' },
        project_b: { type: 'string', description: 'Second project.' },
        n_results: { type: 'integer', minimum: 1, maximum: 50, description: 'Results to return (default 10, max 50).' },
      }, ['topic', 'project_a', 'project_b']),
      output: { schema: outputSchema, render },
      async execute(args) {
        try {
          const topic = normalizeTopicLabel(requireString(args, 'topic'))
          const projectA = normalizeProjectLabel(requireString(args, 'project_a'))
          const projectB = normalizeProjectLabel(requireString(args, 'project_b'))
          const hits = await service.tunnel(
            topic,
            projectA,
            projectB,
            optionalNumber(args, 'n_results', { min: 1, max: 50 }),
          )
          if (hits.length === 0) {
            return result(`No memories found in tunnel: ${projectA} ↔ ${projectB} via "${topic}".`, { count: 0 })
          }
          const text = [
            `## Tunnel: ${projectA} ↔ ${projectB} via "${topic}"`,
            '',
            ...hits.map(formatMemory),
          ].join('\n\n---\n\n')
          return result(truncate(text), { count: hits.length, topic, projects: [projectA, projectB] })
        } catch (error) {
          throw wrapError(error)
        }
      },
    },
    {
      name: 'knowledge_add',
      description:
        'Add a temporal fact (subject → predicate → object) to the knowledge graph. Use it when the user states a '
        + 'durable fact or decision. Set valid_from/valid_to for time-bounded facts. Common predicates: uses, '
        + 'depends_on, decided, prefers, created_by, replaces, implements.',
      parameters: parameters({
        subject: { type: 'string', description: 'Subject entity, e.g. myapp or Alice.' },
        predicate: { type: 'string', description: 'Relationship, e.g. uses or depends_on.' },
        object: { type: 'string', description: 'Object entity, e.g. PostgreSQL or React.' },
        valid_from: { type: 'string', description: 'ISO date when the fact became true.' },
        valid_to: { type: 'string', description: 'ISO date when the fact stopped being true.' },
        project: { type: 'string', description: 'Project context (defaults to the session project).' },
      }, ['subject', 'predicate', 'object']),
      output: { schema: outputSchema, render },
      async execute(args, exec) {
        try {
          const subject = requireString(args, 'subject', { max: 300 })
          const predicate = requireString(args, 'predicate', { max: 200 })
          const object = requireString(args, 'object', { max: 300 })
          const added = await service.addTriple({
            subject,
            predicate,
            object,
            valid_from: optionalString(args, 'valid_from', { max: 64 }) || null,
            valid_to: optionalString(args, 'valid_to', { max: 64 }) || null,
            project: projectFor(args, exec, { defaultToSession: true }) || 'general',
          })
          const since = optionalString(args, 'valid_from', { max: 64 })
          return result(
            `Added fact: **${subject}** ${predicate} **${object}**${since ? ` (since ${since})` : ''} (#${added.id}).`,
            added,
          )
        } catch (error) {
          throw wrapError(error)
        }
      },
    },
    {
      name: 'knowledge_query',
      description:
        'Query facts about an entity, optionally as of a point in time and within one project. '
        + 'Pass "at_time" to see what was true at that moment instead of every recorded fact.',
      parameters: parameters({
        entity: { type: 'string', description: 'Entity name to query.' },
        at_time: { type: 'string', description: 'ISO date/time to query as of.' },
        project: { type: 'string', description: 'Optional project filter.' },
      }, ['entity']),
      output: { schema: outputSchema, render },
      async execute(args) {
        try {
          const entity = requireString(args, 'entity', { max: 300 })
          const queried = await service.queryEntity(entity, {
            at_time: optionalString(args, 'at_time', { max: 64 }) || undefined,
            project: optionalString(args, 'project') || undefined,
          })
          if (!queried.entity) return result(`No entity found for "${entity}".`, queried)
          const facts = queried.facts
          if (facts.length === 0) return result(`Entity ${queried.entity.name} has no matching facts.`, queried)
          const text = [
            `## ${queried.entity.name} (${queried.entity.type})`,
            '',
            formatFacts(facts),
          ].join('\n')
          return result(truncate(text), queried)
        } catch (error) {
          throw wrapError(error)
        }
      },
    },
    {
      name: 'knowledge_status',
      description: 'Show knowledge-graph statistics: entity count, fact count, active facts, entity types, and top predicates.',
      parameters: parameters({}),
      output: { schema: outputSchema, render },
      async execute() {
        try {
          const stats = await service.knowledgeStats()
          const lines = [
            '## Knowledge Graph Status',
            '',
            `- **Entities**: ${stats.entityCount}`,
            `- **Facts**: ${stats.tripleCount} (${stats.activeTriples} active)`,
          ]
          const types = Object.entries(stats.entityTypes)
          if (types.length > 0) {
            lines.push('', '### Entity types')
            for (const [type, count] of types) lines.push(`- ${type}: ${count}`)
          }
          const predicates = Object.entries(stats.predicates)
          if (predicates.length > 0) {
            lines.push('', '### Top predicates')
            for (const [predicate, count] of predicates) lines.push(`- ${predicate}: ${count}`)
          }
          return result(lines.join('\n'), stats)
        } catch (error) {
          throw wrapError(error)
        }
      },
    },
    {
      name: 'memory_list_rooms',
      description: 'List topic rooms with memory counts, and the projects that contain each topic. Use it to orient before a filtered recall.',
      parameters: parameters({
        project: { type: 'string', description: 'Optional project filter.' },
      }, []),
      output: { schema: outputSchema, render },
      async execute(args) {
        try {
          const rooms = await service.rooms(optionalString(args, 'project') || undefined)
          if (rooms.length === 0) return result('No rooms yet: no memories stored for the selected scope.', rooms)
          const text = rooms.map(room => `- **${room.topic}**: ${room.count} memories — projects: ${room.projects.join(', ')}`).join('\n')
          return result(`## Rooms\n\n${text}`, rooms)
        } catch (error) {
          throw wrapError(error)
        }
      },
    },
    {
      name: 'memory_taxonomy',
      description: 'Show the full project → topic → count tree so you can choose a project/topic filter for search or recall.',
      parameters: parameters({}),
      output: { schema: outputSchema, render },
      async execute() {
        try {
          const tree = await service.taxonomy()
          if (tree.length === 0) return result('No memories stored yet.', tree)
          const lines = ['## Taxonomy']
          for (const project of tree) {
            lines.push(project.total === undefined
              ? `- **${project.project}**`
              : `- **${project.project}** (${project.total} memories)`)
            for (const topic of project.topics) lines.push(`  - ${topic.topic}: ${topic.count}`)
          }
          return result(truncate(lines.join('\n')), tree)
        } catch (error) {
          throw wrapError(error)
        }
      },
    },
    {
      name: 'memory_delete',
      description:
        'Delete one memory by id. Irreversible. Find the id with memory_search or memory_recall first, and confirm with the user before deleting anything they did not ask to remove.',
      parameters: parameters({
        id: { type: 'string', description: 'Memory id, as returned by search or recall.' },
      }, ['id']),
      output: { schema: outputSchema, render },
      async execute(args) {
        try {
          const id = requireString(args, 'id', { max: 300 })
          const deleted = await service.deleteMemory(id)
          return result(`Deleted memory ${deleted.id}.`, deleted)
        } catch (error) {
          throw wrapError(error)
        }
      },
    },
    {
      name: 'memory_check_duplicate',
      description:
        'Check whether content already exists, by exact content hash or by semantic similarity at a threshold. '
        + 'Call it before memory_save when the content may repeat an earlier memory.',
      parameters: parameters({
        content: { type: 'string', description: 'Content to check.' },
        threshold: { type: 'number', minimum: 0, maximum: 1, description: 'Similarity threshold (default 0.9).' },
      }, ['content']),
      output: { schema: outputSchema, render },
      async execute(args) {
        try {
          const content = requireString(args, 'content', { max: 20_000 })
          const checked = await service.checkDuplicate(
            content,
            optionalNumber(args, 'threshold', { min: 0, max: 1 }),
          )
          if (!checked.isDuplicate) return result('No duplicate found.', checked)
          if (checked.hashMatch) return result('Exact duplicate: identical content already exists.', checked)
          const match = checked.semanticMatch
          return result(
            `Similar memory found (${(match.similarity * 100).toFixed(1)}% match, ${match.project}/${match.topic}):\n${match.text}`,
            checked,
          )
        } catch (error) {
          throw wrapError(error)
        }
      },
    },
    {
      name: 'knowledge_invalidate',
      description:
        'Mark an active fact as no longer true by setting its valid_to timestamp. '
        + 'Use it when the user says a decision or dependency changed; do not delete history.',
      parameters: parameters({
        subject: { type: 'string', description: 'Subject entity of the active fact.' },
        predicate: { type: 'string', description: 'Predicate of the active fact.' },
        object: { type: 'string', description: 'Object entity of the active fact.' },
        ended: { type: 'string', description: 'ISO date when the fact ended (default now).' },
      }, ['subject', 'predicate', 'object']),
      output: { schema: outputSchema, render },
      async execute(args) {
        try {
          const subject = requireString(args, 'subject', { max: 300 })
          const predicate = requireString(args, 'predicate', { max: 200 })
          const object = requireString(args, 'object', { max: 300 })
          const invalidated = await service.invalidateFact(
            subject,
            predicate,
            object,
            optionalString(args, 'ended', { max: 64 }) || new Date().toISOString(),
          )
          if (invalidated.status === 'not_found') {
            invalid(`no active fact found for ${subject} ${predicate} ${object}; use knowledge_query to inspect it`)
          }
          return result(`Invalidated fact #${invalidated.id}: ${subject} ${predicate} ${object}.`, invalidated)
        } catch (error) {
          throw wrapError(error)
        }
      },
    },
    {
      name: 'knowledge_timeline',
      description:
        'Show chronological fact history, globally or for one entity. Includes active and invalidated facts ordered by validity start.',
      parameters: parameters({
        entity: { type: 'string', description: 'Optional entity to scope the timeline.' },
      }, []),
      output: { schema: outputSchema, render },
      async execute(args) {
        try {
          const entity = optionalString(args, 'entity', { max: 300 })
          const timeline = await service.timeline(entity || undefined)
          if (timeline.length === 0) {
            return result(entity ? `No facts found for "${entity}".` : 'No facts recorded yet.', timeline)
          }
          const text = timeline.map(fact => {
            const start = fact.valid_from || fact.created_at
            const end = fact.valid_to || 'present'
            return `- ${start} → ${end}: ${fact.subject} ${fact.predicate} ${fact.object} (${fact.project})`
          }).join('\n')
          return result(truncate(`## Timeline\n\n${text}`), timeline)
        } catch (error) {
          throw wrapError(error)
        }
      },
    },
    {
      name: 'memory_diary_write',
      description:
        'Write a private diary entry for this agent. Diary entries are stored as high-importance memories under '
        + 'diary-<agent> and are meant for reflections, lessons, and handoff notes rather than user facts.',
      parameters: parameters({
        agent_name: { type: 'string', description: 'Agent identity that owns the diary.' },
        entry: { type: 'string', description: 'Diary entry text.' },
        topic: { type: 'string', description: 'Optional diary topic (default "diary").' },
      }, ['agent_name', 'entry']),
      output: { schema: outputSchema, render },
      async execute(args) {
        try {
          const agentName = requireString(args, 'agent_name', { max: 100 })
          const entry = requireString(args, 'entry', { max: 20_000 })
          const written = await service.diaryWrite({
            agent_name: agentName,
            entry,
            topic: optionalString(args, 'topic', { max: 100 }) || undefined,
          })
          return result(`Diary entry stored for ${agentName} (${written.id}).`, written)
        } catch (error) {
          throw wrapError(error)
        }
      },
    },
    {
      name: 'memory_diary_read',
      description: 'Read the most recent diary entries for an agent, oldest first so the sequence reads chronologically.',
      parameters: parameters({
        agent_name: { type: 'string', description: 'Agent identity that owns the diary.' },
        last_n: { type: 'integer', minimum: 1, maximum: 100, description: 'Entries to return (default 10, max 100).' },
      }, ['agent_name']),
      output: { schema: outputSchema, render },
      async execute(args) {
        try {
          const agentName = requireString(args, 'agent_name', { max: 100 })
          const entries = await service.diaryRead({
            agent_name: agentName,
            last_n: optionalNumber(args, 'last_n', { min: 1, max: 100 }),
          })
          if (entries.length === 0) return result(`No diary entries for ${agentName}.`, entries)
          const text = entries.map(entry => `### ${entry.timestamp}\n${entry.text}`).join('\n\n')
          return result(truncate(`## Diary — ${agentName}\n\n${text}`), entries)
        } catch (error) {
          throw wrapError(error)
        }
      },
    },
  ]

  return definitions
}

/**
 * Register every memory-palace tool on the composing context.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {import('./service.mjs').MempalaceService} service
 */
export function applyTools(ctx, service) {
  for (const definition of createTools(service)) ctx.tools.register(definition)
}
