/**
 * dsh-actmem-recap — time- and turn-scheduled conversation recaps.
 *
 * Modelled on OpenAI Codex's `/recap` (`codex-rs/tui/src/app/recap.rs`):
 * a short, human-facing catch-up generated for the *visible* conversation only,
 * on an isolated tool-free model call, under a strict bounded JSON contract.
 *
 * This plugin never touches compaction: it neither reads nor replaces the
 * compacted history, and it never writes into the model's context unless the
 * `deliver: inject` option is explicitly set.
 *
 * Generated recaps are appended to the decaying ActMem memory card in
 * `dsh-local-memory` (see remember.mjs for why the record is qq-scoped).
 *
 * @module dsh-actmem-recap
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'
import { buildRecapPrompt, DEFAULT_HISTORY_MAX_BYTES } from './prompt.mjs'
import { parseRecap, RecapParseError, renderRecap } from './parse.mjs'
import { CARD_TEXT_MAX_CHARS, rememberRecap } from './remember.mjs'

export const name = 'dsh-actmem-recap'
export const inject = ['agents', 'commands', 'llm']

const COMMAND_NAME = 'recap'
const USAGE = '用法：/recap（现在生成一份简报）或 /recap last（看上次存下的简报）'
const DEFAULT_DELAY_MS = 30 * 60 * 1000
const DEFAULT_MIN_COMPLETED_TURNS = 3
const DEFAULT_MIN_TURNS_BETWEEN_RECAPS = 2
const DEFAULT_MAX_TOKENS = 2048

const DEFAULTS = Object.freeze({
  enabled: true,
  auto: true,
  delayMs: DEFAULT_DELAY_MS,
  minCompletedTurns: DEFAULT_MIN_COMPLETED_TURNS,
  minTurnsBetweenRecaps: DEFAULT_MIN_TURNS_BETWEEN_RECAPS,
  historyMaxTurns: 8,
  historyMaxBytes: DEFAULT_HISTORY_MAX_BYTES,
  summaryMaxChars: 700,
  nextActionMaxChars: 200,
  maxTokens: DEFAULT_MAX_TOKENS,
  deliver: 'store',
  stateDir: '',
  card: Object.freeze({
    // No 'owner' tag on purpose: the owner tag decides which section the
    // record lands in (「和主人（管理员）的记忆」) and makes it eligible for the
    // 「最初的日子」 lottery, which protects it from ever being forgotten.
    // A generated recap is a working note, not a memory of the owner.
    // (The old automatic first-meeting promotion is gone: that slot is now
    // manual-only, but the ownership semantics above still apply.)
    enabled: true,
    scope: 'qq',
    // 45 < 50 on purpose: the card's fast-forget rule needs `importance < 50`
    // ("超过 forgetAfterDays 且重要度 < 50 的非主人记忆可以彻底遗忘"), so a
    // working note actually becomes forgettable instead of fading for months.
    importance: 45,
    tags: Object.freeze(['recap']),
    maxChars: CARD_TEXT_MAX_CHARS,
    timeoutMs: 15_000,
  }),
})

/**
 * Register `/recap` and the automatic schedule.
 * @param ctx - cordis context carrying the command registry, agents, and LLM seam.
 * @param config - see {@link DEFAULTS}; unknown keys are ignored.
 */
export function apply(ctx, config = {}) {
  const options = normalizeConfig(config)
  if (!options.enabled) return
  const home = homeDirectory()
  const card = options.card.enabled && home === undefined
    ? (ctx.logger?.warn?.('[actmem-recap] DSH_HOME is unset; recap card writes are off'), { ...options.card, enabled: false })
    : options.card
  const store = createStore(options.stateDir)
  const sessions = new Map()
  const inFlight = new Set()

  const sessionState = sessionId => {
    const existing = sessions.get(sessionId)
    if (existing !== undefined) return existing
    const created = { lastRecapAt: Date.now(), lastRecapTurn: undefined, seeded: false }
    sessions.set(sessionId, created)
    return created
  }

  async function run(session, { trigger, agent, signal }) {
    if (inFlight.has(String(session.id))) throw new Error('这个会话已经有一份简报在生成中')
    inFlight.add(String(session.id))
    try {
      const result = await generate(ctx, session, options, signal)
      if (result === undefined) return undefined
      const at = new Date().toISOString()
      const remembered = card.enabled
        ? await rememberRecap({ home, recap: result, at, turn: result.turn, config: card })
        : { stored: false, duplicate: false, reason: '' }
      if (!remembered.stored && !remembered.duplicate && remembered.reason.length > 0) {
        ctx.logger?.warn?.(`[actmem-recap] could not write the recap into the memory card: ${remembered.reason}`)
      }
      const record = {
        at,
        sessionId: String(session.id),
        trigger,
        turn: result.turn,
        provider: result.provider,
        model: result.model,
        summary: result.summary,
        nextAction: result.nextAction,
        truncated: result.truncated,
        historyBytes: result.historyBytes,
        visibleBytes: result.visibleBytes,
        elapsedMs: result.elapsedMs,
        cardStored: remembered.stored,
        ...remembered.reason.length > 0 ? { cardReason: remembered.reason } : {},
        ...result.usage === undefined ? {} : { usage: result.usage },
      }
      store.append(record)
      const state = sessionState(record.sessionId)
      state.lastRecapAt = Date.now()
      state.lastRecapTurn = result.turn
      if (trigger === 'auto' && options.deliver === 'inject') {
        injectRecap(ctx, session, record, agent)
      }
      return record
    } finally {
      inFlight.delete(String(session.id))
    }
  }

  const handler = async invocation => {
    const rawInput = typeof invocation?.rawInput === 'string' ? invocation.rawInput.trim() : ''
    const session = invocation?.agent?.session
    if (session === undefined) return { kind: 'error', text: '这个命令需要会话上下文。' }
    const sessionId = String(session.id)
    if (rawInput === 'last') {
      const record = store.latest(sessionId)
      if (record === undefined) return { kind: 'success', text: '这个会话还没有存过简报。' }
      return { kind: 'success', text: formatRecap(record, '上次') }
    }
    if (rawInput !== '' && rawInput !== 'now') return { kind: 'error', text: USAGE }
    try {
      const record = await run(session, { trigger: 'manual', agent: invocation.agent, signal: invocation.signal })
      if (record === undefined) return { kind: 'success', text: '这个会话还没有可以归纳的可见对话。' }
      return { kind: 'success', text: formatRecap(record, '手动') }
    } catch (error) {
      if (invocation?.signal?.aborted) return { kind: 'error', text: '简报生成已取消。' }
      if (error instanceof RecapParseError) {
        return { kind: 'error', text: `模型没有按约定格式回答：${error.message}` }
      }
      return { kind: 'error', text: `简报生成失败：${describe(error)}` }
    }
  }

  // Automatic schedule: turn count and wall clock, never context pressure.
  const onSessionEvent = (session, event) => {
    if (!options.auto || event?.type !== 'turn/end') return
    const sessionId = String(session?.id ?? '')
    if (sessionId.length === 0) return
    const state = sessionState(sessionId)
    const turn = typeof event.data?.turn === 'number' ? event.data.turn : undefined
    if (turn !== undefined) state.turn = turn
    if (!state.seeded) {
      // The first observed turn end defines the clock baseline, so a restart
      // does not immediately recap a long pre-existing conversation.
      state.seeded = true
      state.lastRecapAt = Date.now()
      state.lastRecapTurn = turn
      return
    }
    const completed = turn ?? state.turn
    if (completed === undefined || completed < options.minCompletedTurns) return
    if (state.lastRecapTurn !== undefined && completed - state.lastRecapTurn < options.minTurnsBetweenRecaps) return
    if (Date.now() - state.lastRecapAt < options.delayMs) return
    if (inFlight.has(sessionId)) return
    void run(session, { trigger: 'auto' }).catch(error => {
      ctx.logger?.warn?.(`[actmem-recap] automatic recap failed: ${describe(error)}`)
    })
  }

  ctx.effect(function* registerActmemRecap() {
    yield ctx.on('session/event', onSessionEvent)
    yield ctx.commands.register({
      definitionId: 'dsh-actmem-recap',
      name: COMMAND_NAME,
      description: 'Summarize the current conversation as a short catch-up',
      handler,
    })
  }, 'actmem-recap lifecycle')

  ctx.logger?.info?.(`[actmem-recap] ready (auto=${options.auto}, deliver=${options.deliver}, store=${store.file})`)
}

/**
 * Generate one recap for a live session.
 * @returns the parsed result with provenance, or undefined when nothing is visible.
 */
async function generate(ctx, session, options, signal) {
  const target = resolveTarget(session)
  if (target === undefined) {
    throw new Error('这个会话还没有路由过 provider/model，无法生成简报')
  }
  const cells = visibleCells(session)
  if (cells.length === 0) return undefined
  const { prompt, historyBytes } = buildRecapPrompt(cells, {
    maxTurns: options.historyMaxTurns,
    maxBytes: options.historyMaxBytes,
  })
  if (prompt.length === 0) return undefined
  const visibleBytes = cells.reduce((sum, cell) => sum + Buffer.byteLength(cell.text, 'utf8'), 0)
  const started = Date.now()
  const collected = await collectStream(ctx, {
    provider: target.provider,
    model: target.model,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    maxTokens: options.maxTokens,
    sessionId: session.id,
    ...signal === undefined ? {} : { signal },
  })
  const recap = parseRecap(collected.text, {
    summaryMaxChars: options.summaryMaxChars,
    nextActionMaxChars: options.nextActionMaxChars,
  })
  return {
    ...recap,
    provider: target.provider,
    model: target.model,
    turn: latestTurn(session),
    historyBytes,
    visibleBytes,
    elapsedMs: Date.now() - started,
    usage: collected.usage,
  }
}

/**
 * Consume one LLM stream into text, usage, and finish reason.
 * @returns `{ text, usage, finish }`.
 */
async function collectStream(ctx, request) {
  let text = ''
  let authoritative
  let usage
  let finish
  for await (const chunk of ctx.llm.stream(request)) {
    if (chunk === null || typeof chunk !== 'object') continue
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'block-end') {
      if (chunk.block?.type === 'text' && typeof chunk.block.text === 'string') authoritative = chunk.block.text
    } else if (chunk.type === 'usage') usage = chunk.usage
    else if (chunk.type === 'finish') finish = chunk.reason
  }
  if (finish?.kind === 'error') {
    throw new Error(`模型调用失败：${finish.failure?.message ?? '未知错误'}`)
  }
  return { text: typeof authoritative === 'string' ? authoritative : text, usage, finish }
}

/** The session's routed provider/model, if it has one. */
function resolveTarget(session) {
  const header = typeof session?.requestHeader === 'function' ? session.requestHeader() : undefined
  const config = header?.config
  if (typeof config?.provider !== 'string' || config.provider.length === 0) return undefined
  if (typeof config?.model !== 'string' || config.model.length === 0) return undefined
  return { provider: config.provider, model: config.model }
}

/** The highest turn number present in the session log, when reachable. */
function latestTurn(session) {
  const events = typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : []
  let turn
  for (const event of events) {
    if (event?.type === 'turn/end' && typeof event.data?.turn === 'number') turn = event.data.turn
  }
  return turn
}

/**
 * Visible cells of the current model surface: human prompts and assistant
 * prose only. Injected runtime/time context, tool calls, and tool results are
 * excluded by construction, which is also the privacy boundary.
 */
export function visibleCells(session) {
  const cells = []
  const nodes = session?.surface?.nodes
  if (Array.isArray(nodes) && typeof session.eventAt === 'function') {
    for (const seq of nodes) collectCell(cells, session.eventAt(seq))
    return cells
  }
  const events = typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : []
  for (const event of events) collectCell(cells, event)
  return cells
}

/** Append one cell when the event is a human prompt or assistant prose. */
function collectCell(cells, event) {
  if (event === null || typeof event !== 'object') return
  if (event.type === 'user/message') {
    if (event.data?.source?.kind !== 'user') return
    const text = textOf(event.data.content)
    if (text.length > 0) cells.push({ kind: 'user', text })
  } else if (event.type === 'assistant/message') {
    const text = textOf(event.data?.message?.content)
    if (text.length > 0) cells.push({ kind: 'assistant', text })
  }
}

/** Text-only projection of content blocks. */
function textOf(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  return parts.join('\n').trim()
}

/** Append a recap to the next step's context, when the operator asked for it. */
function injectRecap(ctx, session, record, agent) {
  try {
    const target = agent ?? ctx.agents?.get?.(session.id)
    if (target?.inject === undefined) return
    const text = `归队简报（${record.at}）：\n${renderRecap(record)}`
    target.inject({
      id: `recap_${randomUUID()}`,
      role: 'user',
      content: [{ type: 'text', text }],
      source: {
        kind: 'actmem-recap',
        form: 'snapshot',
        sections: [{ name: 'actmem-recap', text }],
      },
    })
  } catch (error) {
    ctx.logger?.warn?.(`[actmem-recap] could not inject the recap: ${describe(error)}`)
  }
}

/** Human-facing rendering for the command surface. */
function formatRecap(record, triggerLabel) {
  const when = new Date(record.at)
  const stamp = Number.isNaN(when.getTime()) ? record.at : formatStamp(when)
  const notes = []
  if (record.truncated === true) notes.push('已截断')
  if (record.cardStored === true) notes.push('已入记忆卡')
  else if (typeof record.cardReason === 'string' && record.cardReason.length > 0) {
    notes.push(`记忆卡未写入：${shortReason(record.cardReason)}`)
  }
  const header = `简报 · ${stamp} · ${triggerLabel}${notes.map(note => ` · ${note}`).join('')}`
  return `${header}\n\n${renderRecap(record)}`
}

/** Shorten a card-write failure for a one-line command header. */
function shortReason(reason) {
  if (/unavailable/i.test(reason)) return '记忆卡组件不可用'
  if (/disabled/i.test(reason)) return '记忆卡已停用'
  return reason.length > 40 ? `${reason.slice(0, 40)}…` : reason
}

/** Local `YYYY-MM-DD HH:mm` stamp. */
function formatStamp(date) {
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Append-only JSONL store, one record per generated recap. */
function createStore(stateDir) {
  mkdirSync(stateDir, { recursive: true })
  const file = join(stateDir, 'recaps.jsonl')
  return {
    file,
    append(record) {
      appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8')
    },
    latest(sessionId) {
      if (!existsSync(file)) return undefined
      const lines = readFileSync(file, 'utf8').split('\n')
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index].trim()
        if (line.length === 0) continue
        try {
          const record = JSON.parse(line)
          if (String(record.sessionId) === sessionId) return record
        } catch {
          // A torn final line from an interrupted write must not hide older records.
        }
      }
      return undefined
    },
  }
}

/** Resolve, default, and validate the plugin configuration. */
function normalizeConfig(config) {
  const merged = { ...DEFAULTS, ...(config ?? {}), card: { ...DEFAULTS.card, ...(config?.card ?? {}) } }
  const stateDir = merged.stateDir.length > 0
    ? isAbsolute(merged.stateDir) ? merged.stateDir : resolve(merged.stateDir)
    : join(requireHome(), 'actmem-recap')
  if (merged.deliver !== 'store' && merged.deliver !== 'inject') {
    throw new TypeError(`dsh-actmem-recap: deliver must be "store" or "inject", got "${String(merged.deliver)}"`)
  }
  for (const key of ['delayMs', 'minCompletedTurns', 'minTurnsBetweenRecaps', 'historyMaxTurns', 'historyMaxBytes', 'summaryMaxChars', 'nextActionMaxChars', 'maxTokens']) {
    if (!Number.isInteger(merged[key]) || merged[key] < 0) {
      throw new TypeError(`dsh-actmem-recap: ${key} must be a non-negative integer`)
    }
  }
  if (merged.historyMaxBytes === 0 || merged.maxTokens === 0) {
    throw new TypeError('dsh-actmem-recap: historyMaxBytes and maxTokens must be positive')
  }
  const card = normalizeCardConfig(merged.card)
  return Object.freeze({ ...merged, stateDir, card })
}

/**
 * Validate the memory-card placement.
 *
 * `scope` is fixed to 'qq' on purpose: the card drops qq-scoped manual records
 * from the Bilibili context, while 'shared' and 'bili' scopes are rendered
 * there. A recap must never reach a public reply context, so the leaking
 * scopes are refused instead of honoured.
 */
function normalizeCardConfig(card) {
  if (typeof card.enabled !== 'boolean') throw new TypeError('dsh-actmem-recap: card.enabled must be a boolean')
  if (card.scope !== 'qq') {
    throw new TypeError('dsh-actmem-recap: card.scope must be "qq" — shared/bili scopes reach the Bilibili context')
  }
  if (!Number.isInteger(card.importance) || card.importance < 1 || card.importance > 100) {
    throw new TypeError('dsh-actmem-recap: card.importance must be an integer between 1 and 100')
  }
  if (!Array.isArray(card.tags) || card.tags.some(tag => typeof tag !== 'string' || tag.length === 0) || card.tags.length > 8) {
    throw new TypeError('dsh-actmem-recap: card.tags must be at most 8 non-empty strings')
  }
  if (!Number.isInteger(card.maxChars) || card.maxChars < 100 || card.maxChars > CARD_TEXT_MAX_CHARS) {
    throw new TypeError(`dsh-actmem-recap: card.maxChars must be an integer between 100 and ${CARD_TEXT_MAX_CHARS}`)
  }
  if (!Number.isInteger(card.timeoutMs) || card.timeoutMs < 1_000 || card.timeoutMs > 120_000) {
    throw new TypeError('dsh-actmem-recap: card.timeoutMs must be an integer between 1000 and 120000')
  }
  return Object.freeze({ ...card, tags: Object.freeze([...card.tags]) })
}

/** The DSH home directory, when the runtime provides one. */
function homeDirectory() {
  const home = process.env.DSH_HOME
  return typeof home === 'string' && home.length > 0 ? home : undefined
}

/** The DSH home directory owning plugin state and the memory component. */
function requireHome() {
  const home = homeDirectory()
  if (home === undefined) {
    throw new Error('dsh-actmem-recap: DSH_HOME is unset and no stateDir was configured')
  }
  return home
}

/** Compact error text for logs and command results. */
function describe(error) {
  return error instanceof Error ? error.message : String(error)
}
