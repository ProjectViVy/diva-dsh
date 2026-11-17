#!/usr/bin/env node
/**
 * 世界网关能力冒烟：拿一把 key 直接打接入点，逐能力报「通 / 不通 / 未知」。
 *
 * 为什么要有它：网关面板只记「接哪个、用哪个模型、用哪把 key」，没有任何调用面
 * （`plugins/capability-hub` 至今没有 invoke）。在接适配器之前需要一份「这家到底怎么说话」的实测，
 * 否则 ASR/TTS 的协议形状只能靠文档猜。这个脚本就是那份实测，不改仓库里任何运行时代码。
 *
 * 用法：
 *   node scripts/probe-world-gateway.mjs --key-env QWEN_WS_KEY [--base <兼容模式 baseURL>]
 *        [--out <证据 JSON 路径>] [--samples <音频目录>] [--audio <本地 wav|mp3>] [--audio-url <公开音频 URL>]
 *
 * key 永不出现在输出里：只记形态（前缀、长度、sha256 前 12 位）。
 * 并发默认 1：本机出口会间歇性 ECONNRESET / 握手超时，并发跑分不清是「这家限流」还是「本机网络」。
 *
 * **本机实测的坑（2026-11-17）**：经 `HTTPS_PROXY=127.0.0.1:7890` 时，凡是带 base64 音频的请求体
 * （≥ 几十 KB 起）一律在传输层被打断（ECONNRESET / UND_ERR_SOCKET / 握手超时），而**同样大小**的非音频
 * 请求体也一样断——所以这不是服务端拒收，是本机代理链路的问题。ASR 因此默认改走「公开 URL」形状：
 * 服务端自己去取音频，请求体只有几百字节。本地音频要用 base64 时，需要先把代理关掉再跑。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'

const AUDIO_EXT = new Set(['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.flac'])

function parseArgs(argv) {
  const out = { keyEnv: 'QWEN_WS_KEY', base: 'https://llm-0jydim7clhzcop0h.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', out: '', samples: '', audio: '', audioUrl: '', timeoutMs: 90_000 }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const next = () => {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${flag} 缺少取值`)
      i += 1
      return value
    }
    if (flag === '--key-env') out.keyEnv = next()
    else if (flag === '--base') out.base = next()
    else if (flag === '--out') out.out = next()
    else if (flag === '--samples') out.samples = next()
    else if (flag === '--audio') out.audio = next()
    else if (flag === '--audio-url') out.audioUrl = next()
    else if (flag === '--timeout') out.timeoutMs = Number(next())
    else throw new Error(`未知参数：${flag}`)
  }
  out.base = out.base.replace(/\/+$/, '')
  return out
}

function safeKeyInfo(key) {
  const prefix = key.slice(0, 6)
  return { prefix, length: key.length, sha256_12: createHash('sha256').update(key).digest('hex').slice(0, 12) }
}

function scrub(text, key) {
  const value = String(text ?? '')
  return key ? value.split(key).join('<KEY>') : value
}

/** 一次 POST，带超时；失败归类为 net（网络/传输层）而不是能力结论。 */
async function post(url, key, body, timeoutMs = Number(process.env.PROBE_TIMEOUT_MS ?? 90_000)) {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await response.text()
    return { ok: response.ok, status: response.status, text, ms: Date.now() - started }
  } catch (error) {
    return { net: error?.cause?.code ?? error?.name ?? error?.message ?? 'net', ms: Date.now() - started }
  } finally {
    clearTimeout(timer)
  }
}

async function getBytes(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

/** 从返回 JSON 里找出音频：先认 base64，再认 url（百炼两种都常见）。 */
async function extractAudio(json) {
  const audio = json?.output?.audio ?? json?.audio ?? json?.data?.[0]?.audio ?? null
  if (!audio || typeof audio !== 'object') return null
  if (typeof audio.data === 'string' && audio.data.length > 64) return { bytes: Buffer.from(audio.data, 'base64'), via: 'base64' }
  if (typeof audio.url === 'string' && /^https?:\/\//.test(audio.url)) return { bytes: await getBytes(audio.url), via: 'url', url: audio.url }
  return null
}

/**
 * 修 WAV 头里两个「流式写出来的长度」：百炼 TTS 直接把 HTTP 响应体当 wav 返回时，
 * RIFF 与 data 的长度字段是 0x7FFFFFFF 级别的流式写值。按实际字节重写，才能算清时长、交给播放器。
 */
function repairWav(bytes) {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') return { bytes, repaired: false }
  const next = Buffer.from(bytes)
  let offset = 12
  while (offset + 8 <= next.length) {
    const id = next.toString('ascii', offset, offset + 4)
    const declared = next.readUInt32LE(offset + 4)
    if (id === 'data') {
      const actual = next.length - offset - 8
      if (declared !== actual || next.readUInt32LE(4) !== next.length - 8) {
        next.writeUInt32LE(actual, offset + 4)
        next.writeUInt32LE(next.length - 8, 4)
        return { bytes: next, repaired: true }
      }
      return { bytes: next, repaired: false }
    }
    if (declared > next.length) return { bytes: next, repaired: false }
    offset += 8 + declared + (declared % 2)
  }
  return { bytes: next, repaired: false }
}

function wavInfo(bytes) {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') return null
  let offset = 12
  let fmt = null
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    if (id === 'fmt ') fmt = { format: bytes.readUInt16LE(offset + 8), channels: bytes.readUInt16LE(offset + 10), sampleRate: bytes.readUInt32LE(offset + 12), bits: bytes.readUInt16LE(offset + 22) }
    if (id === 'data') {
      // 头部声明的长度可能大于实际字节（流式写出来的值）；时长以实际字节为准。
      const dataBytes = Math.min(size, bytes.length - offset - 8)
      const seconds = fmt ? dataBytes / (fmt.sampleRate * fmt.channels * (fmt.bits / 8)) : null
      return { ...fmt, dataBytes, seconds: seconds === null ? null : Math.round(seconds * 1000) / 1000 }
    }
    if (size > bytes.length) return { ...(fmt ?? {}), dataBytes: bytes.length - offset - 8, seconds: null }
    offset += 8 + size + (size % 2)
  }
  return { ...(fmt ?? {}), dataBytes: null, seconds: null }
}

function sniff(bytes) {
  const head = bytes.subarray(0, 12)
  if (head.toString('ascii', 0, 4) === 'RIFF') return 'wav'
  if (head.toString('ascii', 0, 3) === 'ID3') return 'mp3'
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return 'mp3'
  if (head.toString('ascii', 4, 8) === 'ftyp') return 'm4a/mp4'
  if (head.toString('ascii', 0, 4) === 'OggS') return 'ogg'
  if (head.toString('ascii', 0, 4) === 'fLaC') return 'flac'
  return 'unknown'
}

/** 返回体摘要：够定位问题，但不把整段向量或 base64 塞进证据。 */
function summarize(text) {
  if (!text) return { json: null, note: '空返回' }
  try {
    const json = JSON.parse(text)
    return { json, note: null }
  } catch {
    return { json: null, note: text.slice(0, 400) }
  }
}

// ── 各能力 ────────────────────────────────────────────────────────────────

/** 从响应体里稳准地摘出「被识别出来的文本」，不依赖唯一一种嵌套形状。 */
function transcriptOf(json) {
  const message = json?.output?.choices?.[0]?.message
  const content = message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const texts = content.map(part => (typeof part === 'string' ? part : (part?.text ?? part?.transcript))).filter(Boolean)
    if (texts.length) return texts.join('\n')
  }
  const candidate = json?.output?.text ?? message?.text ?? message?.annotations?.[0]?.transcript ?? null
  return typeof candidate === 'string' ? candidate : null
}

async function probeAsr(ctx) {
  const results = []
  const url = `${ctx.nativeBase}/api/v1/services/aigc/multimodal-generation/generation`

  // A. 文档写的原生形状：content[].type='input_audio' + parameters.format/sample_rate。
  //    走公开 URL（服务端自己取音频），避免本机代理掐断大请求体。
  if (!ctx.audioUrl) {
    results.push({ trial: 'native multimodal-generation（ASR）', skipped: '没有 --audio-url，也没有可用的公开音频地址' })
  } else {
    for (const model of ctx.asrModels ?? []) {
      const body = {
        model,
        input: { messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: ctx.audioUrl } }] }] },
        parameters: { format: ctx.audioUrlFormat ?? 'mp3', sample_rate: ctx.audioUrlSampleRate ?? '16000' },
      }
      const response = await ctx.postWithRetry(url, body)
      const trial = `native multimodal-generation · ${model} · URL 输入`
      if (response.net) { results.push({ trial, model, net: response.net, ms: response.ms }); continue }
      const { json, note } = summarize(scrub(response.text, ctx.key))
      results.push({
        trial,
        model,
        ok: response.ok,
        status: response.status,
        ms: response.ms,
        transcript: json?.output?.text ?? json?.text ?? transcriptOf(json),
        usage: json?.usage ?? null,
        code: json?.code ?? json?.error?.code ?? null,
        message: json?.message ?? json?.error?.message ?? note ?? null,
      })
    }
  }

  // B. 兼容模式的 /audio/transcriptions：只探一次路由，确认它到底在不在。
  results.push({ trial: 'compat:multipart /compatible-mode/v1/audio/transcriptions', ...(await (async () => {
    const started = Date.now()
    try {
      const form = new FormData()
      form.append('model', (ctx.asrModels ?? ['qwen-audio-3.0-asr-flash'])[0])
      form.append('file', new Blob([Buffer.from([0x52, 0x49, 0x46, 0x46])], { type: 'audio/wav' }), 'probe.wav')
      const response = await fetch(`${ctx.base}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${ctx.key}` }, body: form })
      const text = await response.text()
      return { ok: response.ok, status: response.status, ms: Date.now() - started, body: scrub(text, ctx.key).slice(0, 200) || '（空返回体）' }
    } catch (error) {
      return { net: error?.cause?.code ?? error?.name, ms: Date.now() - started }
    }
  })()) })
  return results
}

async function probeTts(ctx) {
  const trials = []
  const text = '你好，我是 Diva。这是一条语音合成冒烟测试。'
  const candidates = [
    { name: 'compat:audio/speech（OpenAI TTS 形状）', url: `${ctx.base}/audio/speech`, body: { model: 'qwen3-tts-flash', input: text, voice: 'Cherry', response_format: 'wav' } },
    { name: 'compat:chat·modalities=audio（audio.voice）', url: `${ctx.base}/chat/completions`, body: { model: 'qwen3-tts-flash', messages: [{ role: 'user', content: text }], modalities: ['text', 'audio'], audio: { voice: 'Cherry', format: 'wav' } } },
    { name: 'native:aigc/multimodal-generation（qwen3-tts-flash）', url: `${ctx.nativeBase}/api/v1/services/aigc/multimodal-generation/generation`, body: { model: 'qwen3-tts-flash', input: { text, voice: 'Cherry', language_type: 'Chinese' } } },
    { name: 'native:audio/tts/SpeechSynthesizer（qwen-audio-3.1-tts-flash）', url: `${ctx.nativeBase}/api/v1/services/audio/tts/SpeechSynthesizer`, body: { model: 'qwen-audio-3.1-tts-flash', input: { text, voice: 'longanhuan_v3.1', format: 'wav', sample_rate: 24000 } } },
  ]
  for (const candidate of candidates) {
    const response = ctx.postWithRetry ? await ctx.postWithRetry(candidate.url, candidate.body) : await post(candidate.url, ctx.key, candidate.body, ctx.timeoutMs)
    if (response.net) { trials.push({ trial: candidate.name, net: response.net, ms: response.ms }); continue }
    if (response.ok && (response.text.length < 2 || !response.text.trimStart().startsWith('{'))) {
      // 有些路由直接吐音频字节而不是 JSON：按字节收，当音频处理。
      const raw = Buffer.from(response.text, 'binary')
      const kind = sniff(raw)
      const { bytes, repaired } = kind === 'wav' ? repairWav(raw) : { bytes: raw, repaired: false }
      const entry = { trial: candidate.name, ok: true, status: response.status, ms: response.ms, audio: { via: 'raw-bytes', kind, bytes: bytes.length, headerRepaired: repaired, info: kind === 'wav' ? wavInfo(bytes) : null } }
      if (ctx.samplesDir && kind !== 'unknown') {
        const file = join(ctx.samplesDir, `tts-${candidate.name.startsWith('compat:audio/speech') ? 'compat-audio-speech' : 'other'}.${kind}`)
        writeFileSync(file, bytes)
        entry.audio.saved = file
      }
      trials.push(entry)
      continue
    }
    const entry = { trial: candidate.name, ok: response.ok, status: response.status, ms: response.ms }
    const { json, note } = summarize(scrub(response.text, ctx.key))
    entry.code = json?.error?.code ?? json?.code ?? null
    entry.message = json?.error?.message ?? json?.message ?? note?.slice(0, 200) ?? null
    entry.usage = json?.usage ?? null
    if (response.ok) {
      try {
        const audio = await extractAudio(json)
        if (audio) {
          const kind = sniff(audio.bytes)
          const { bytes, repaired } = kind === 'wav' ? repairWav(audio.bytes) : { bytes: audio.bytes, repaired: false }
          const info = kind === 'wav' ? wavInfo(bytes) : null
          entry.audio = { via: audio.via, kind, bytes: bytes.length, headerRepaired: repaired, info }
          if (ctx.samplesDir) {
            const name = { 'compat:audio/speech（OpenAI TTS 形状）': 'tts-compat-audio-speech', 'compat:chat·modalities=audio（audio.voice）': 'tts-compat-chat', 'native:aigc/multimodal-generation（qwen3-tts-flash）': 'tts-native-aigc-qwen3-flash', 'native:audio/tts/SpeechSynthesizer（qwen-audio-3.1-tts-flash）': 'tts-native-synthesizer-qwen-audio' }[entry.trial] ?? 'tts-other'
            const file = join(ctx.samplesDir, `${name}.${kind === 'unknown' ? 'bin' : kind}`)
            writeFileSync(file, bytes)
            entry.audio.saved = file
          }
        } else entry.audio = null
      } catch (error) { entry.audioError = String(error?.message ?? error) }
    }
    trials.push(entry)
  }
  return trials
}

async function probeEmbedding(ctx) {
  const items = ['记忆宫殿里的向量召回', '世界网关接入千问', 'Diva 是一个被配置出来的存在', 'hello embedding']
  const cases = [
    { model: 'text-embedding-v4', body: { model: 'text-embedding-v4', input: items, encoding_format: 'float' } },
    { model: 'text-embedding-v4 · dimensions=512', body: { model: 'text-embedding-v4', input: items, dimensions: 512, encoding_format: 'float' } },
    { model: 'qwen3.7-text-embedding-flash', body: { model: 'qwen3.7-text-embedding-flash', input: items, encoding_format: 'float' } },
    { model: 'qwen3.7-text-embedding-flash · dimensions=512', body: { model: 'qwen3.7-text-embedding-flash', input: items, dimensions: 512, encoding_format: 'float' } },
    { model: 'qwen3.7-text-embedding', body: { model: 'qwen3.7-text-embedding', input: items, dimensions: 1024, encoding_format: 'float' } },
  ]
  const postWithRetry = ctx.postWithRetry ?? ((url, body) => post(url, ctx.key, body, ctx.timeoutMs))
  const results = []
  for (const item of cases) {
    const response = await postWithRetry(`${ctx.base}/embeddings`, item.body)
    if (response.net) { results.push({ trial: item.model, net: response.net, ms: response.ms }); continue }
    const { json, note } = summarize(scrub(response.text, ctx.key))
    if (!json || !Array.isArray(json.data)) {
      results.push({ trial: item.model, ok: false, status: response.status, ms: response.ms, message: (json?.error?.message ?? note ?? '').slice(0, 200) })
      continue
    }
    const vectors = json.data.map(row => row.embedding)
    const norms = vectors.map(vector => Math.round(Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) * 10000) / 10000)
    results.push({
      trial: item.model,
      ok: true,
      status: response.status,
      ms: response.ms,
      attempts: response.attempts ?? 1,
      count: vectors.length,
      dims: vectors.map(vector => vector.length),
      l2Norm: norms,
      usage: json.usage ?? null,
    })
  }
  return results
}

/**
 * 全模态：本轮只验「听得见」。把刚合出来的 wav（文本已知）当输入，看它认不认。
 * 同时留一条「路径通」的证据：input_audio 形状被接受 → 400 参数错；形状不认识 → 404 / 其它。
 */
async function probeOmni(ctx) {
  const wav = ctx.ttsWav
  const trials = []
  for (const model of ['qwen3.8-omni-flash', 'qwen3.5-omni-flash']) {
    const body = wav
      ? { model, messages: [{ role: 'user', content: [{ input_audio: { data: `data:audio/wav;base64,${wav.toString('base64')}` } }, { text: '这段音频里说了什么？请原样复述听到的中文。' }] }], max_tokens: 120 }
      : { model, messages: [{ role: 'user', content: '用一句话说明你能听音频。' }], max_tokens: 64 }
    const trial = wav ? `${model} · compat chat 带 input_audio` : `${model} · compat chat 纯文本`
    const response = ctx.postWithRetry ? await ctx.postWithRetry(`${ctx.base}/chat/completions`, body) : await post(`${ctx.base}/chat/completions`, ctx.key, body, ctx.timeoutMs)
    if (response.net) { trials.push({ trial, net: response.net, ms: response.ms }); continue }
    const { json, note } = summarize(scrub(response.text, ctx.key))
    trials.push({
      trial,
      ok: response.ok,
      status: response.status,
      ms: response.ms,
      content: json?.choices?.[0]?.message?.content ?? null,
      message: (json?.error?.message ?? note ?? '').slice(0, 300) || null,
    })
  }
  return trials
}

// ── 主流程 ────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const key = process.env[args.keyEnv]
  if (!key) {
    console.error(`环境变量 ${args.keyEnv} 为空：请先 export 再用，不要把 key 写进命令行参数。`)
    process.exit(2)
  }

  // 本地音频只用来「留一份听」，ASR 默认走 --audio-url（见文件头注释）。
  let audioPath = args.audio || ''
  if (!audioPath && args.samples && existsSync(args.samples)) {
    const found = readdirSync(args.samples).filter(name => AUDIO_EXT.has(extname(name).toLowerCase())).sort()
    audioPath = found.map(name => join(args.samples, name)).find(path => !/tone/.test(basename(path))) ?? ''
  }
  const audioBytes = audioPath && existsSync(audioPath) ? readFileSync(audioPath) : null

  // 原生协议（DashScope 形状）的根不是 compatible-mode/v1：把 `/compatible-mode/v1` 摘掉就是。
  const nativeBase = args.base.replace(/\/compatible-mode\/v\d+$/, '')
  const ctx = {
    key,
    base: args.base,
    nativeBase,
    timeoutMs: args.timeoutMs,
    samplesDir: args.samples ? (mkdirSync(args.samples, { recursive: true }), args.samples) : '',
    audioPath: audioPath || null,
    audioBytes,
    audioUrl: args.audioUrl,
    audioUrlFormat: args.audioUrl ? (extname(new URL(args.audioUrl).pathname).slice(1) || 'mp3') : null,
  }

  const startedAt = new Date().toISOString()
  const report = {
    startedAt,
    base: args.base,
    nativeBase,
    key: safeKeyInfo(key),
    audio: audioPath ? { path: audioPath, bytes: audioBytes?.length ?? 0, kind: audioBytes ? sniff(audioBytes) : null } : null,
    audioUrl: args.audioUrl || null,
    capabilities: {},
  }

  // 本机出口会间歇性握手超时 / ECONNRESET：网络类失败重试 2 次（只重试传输层，不重试 4xx）。
  const postWithRetry = async (url, body) => {
    let last = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      last = await post(url, ctx.key, body, ctx.timeoutMs)
      if (!last.net) return { ...last, attempts: attempt + 1 }
    }
    return { ...last, attempts: 3 }
  }
  ctx.postWithRetry = postWithRetry

  // models：先确认这把 key 在不在正确的接入点上（同样重试，否则一次抖动会让整个 ASR 清单变空）
  const modelsStarted = Date.now()
  let models = null
  for (let attempt = 0; attempt < 3 && !models?.ok; attempt += 1) {
    try {
      const response = await fetch(`${ctx.base}/models`, { headers: { authorization: `Bearer ${key}` } })
      const json = await response.json()
      models = { ok: response.ok, status: response.status, ms: Date.now() - modelsStarted, attempts: attempt + 1, count: json?.data?.length ?? 0, ids: (json?.data ?? []).map(row => row.id).sort() }
      if (response.ok) break
    } catch (error) {
      models = { ok: false, net: error?.cause?.code ?? error?.name, ms: Date.now() - modelsStarted, attempts: attempt + 1 }
    }
  }
  report.models = models

  // ASR 要拿清单里真实存在的非实时 ASR 模型来试；清单没取到就只试兜底 id，并把这一点写进证据。
  const ids = report.models?.ids ?? []
  const inventoryAsr = ids.filter(id => /asr/i.test(id) && !/realtime/i.test(id)).slice(0, 3)
  const probeList = inventoryAsr.length ? [...inventoryAsr, 'qwen-audio-3.1-asr-flash'] : ['qwen-audio-3.0-asr-flash', 'qwen-audio-3.1-asr-flash']
  report.asrInventory = { inventoryOk: report.models?.ok === true, fromModels: inventoryAsr, probed: probeList }

  report.capabilities.embedding = await probeEmbedding(ctx)
  report.capabilities.tts = await probeTts(ctx)
  report.capabilities.asr = await probeAsr({ ...ctx, asrModels: probeList, inventoryAsr })
  const ttsWavPath = report.capabilities.tts.map(row => row.audio?.saved).find(path => path && path.endsWith('.wav'))
  report.capabilities.omni = await probeOmni({ ...ctx, ttsWav: ttsWavPath ? readFileSync(ttsWavPath) : null })
  report.finishedAt = new Date().toISOString()

  const text = `${JSON.stringify(report, null, 2)}\n`
  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true })
    writeFileSync(args.out, scrub(text, key))
    console.log(`证据：${args.out}`)
  }
  console.log(scrub(JSON.stringify({
    models: report.models?.ok ? `${report.models.count} 个` : report.models,
    embedding: report.capabilities.embedding,
    tts: report.capabilities.tts.map(row => ({ trial: row.trial, ok: row.ok, status: row.status, ms: row.ms, code: row.code, message: row.message, audio: row.audio ? { kind: row.audio.kind, bytes: row.audio.bytes, seconds: row.audio.info?.seconds ?? null, headerRepaired: row.audio.headerRepaired } : row.net ?? null })),
    asrInventory: report.asrInventory,
    asr: report.capabilities.asr,
    omni: report.capabilities.omni,
  }, null, 2), key))
}

main().catch(error => {
  console.error(String(error?.message ?? error))
  process.exit(1)
})
