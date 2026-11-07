// 挂载契约（2026-11-05）：证明 `apply(ctx)` 真能把两个面挂上，且内部通道的令牌流程走得通。
//
// 为什么要有这条：面板探活一直是 404，而当时所有单元测试都是绿的 ——
// 「handler 能跑」和「插件被挂上、前缀对、令牌通道通」是两件不同的事。
// 这里用一个假 ctx（只实现 webServer.register / webServer.port / effect / logger）
// 把 plugins/asr/src/index.mjs 真跑一遍，再用真 HTTP 打这两个面。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 16kHz 单声道 PCM16 WAV（内容无所谓，这里就是一小段静音）。 */
function silentWave(seconds = 0.4, sampleRate = 16000) {
  const samples = Math.round(sampleRate * seconds)
  const buffer = Buffer.alloc(44 + samples * 2)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + samples * 2, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(samples * 2, 40)
  return buffer
}

/** 起一个「最小 DSH」：假 ctx + 真 HTTP，把 index.mjs 的 apply 跑起来。 */
async function mountAsr(t, { rejection = () => false, connection = true } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-asr-mount-'))
  const before = { home: process.env.DSH_HOME, state: process.env.DSH_ASR_STATE_DIR }
  process.env.DSH_HOME = home
  delete process.env.DSH_ASR_STATE_DIR

  const routes = []
  const effects = []
  const ctx = {
    webServer: {
      port: 0,
      register(route) {
        routes.push(route)
        return () => { const index = routes.indexOf(route); if (index >= 0) routes.splice(index, 1) }
      },
    },
    // 真 DSH 的 ctx.get('connection')：面板面靠它判会话（inject 里声明了 connection）。
    get(name) {
      return name === 'connection' && connection ? { requestRejection: req => rejection(req) } : undefined
    },
    logger: { info() {}, warn() {}, error() {} },
    effect(callback) { effects.push(callback); return () => {} },
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const route = routes.find(item => url.pathname === item.path || url.pathname.startsWith(`${item.path}/`))
    if (!route) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"ok":false}'); return }
    return route.handler(req, res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  ctx.webServer.port = port

  const { apply } = await import('../plugins/asr/src/index.mjs')
  apply(ctx)

  t.after(async () => {
    for (const callback of effects) { try { await callback()() } catch {} }
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    if (before.home === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = before.home
    if (before.state === undefined) delete process.env.DSH_ASR_STATE_DIR; else process.env.DSH_ASR_STATE_DIR = before.state
    rmSync(home, { recursive: true, force: true })
  })

  const url = path => `http://127.0.0.1:${port}${path}`
  const call = async (path, { method = 'GET', token, origin, body } = {}) => {
    const response = await fetch(url(path), {
      method,
      signal: AbortSignal.timeout(5000), // 处理器要是忘了回包，这里必须"报错"而不是"挂到天荒地老"
      headers: {
        ...(token === undefined ? {} : { 'x-component-token': token }),
        ...(origin === undefined ? {} : { origin }),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, body: await response.json() }
  }

  return { home, port, routes, effects, url, call, token: () => JSON.parse(readFileSync(join(home, 'asr', 'runtime.json'), 'utf8')).token }
}

test('apply() 把面板与内部两个面都挂上，并写下可直接调用的 runtime.json', async t => {
  const asr = await mountAsr(t)

  assert.deepEqual(asr.routes.map(route => route.path).sort(), ['/dsh-asr/api', '/dsh-asr/internal'],
    '两个面都必须注册；少一个就是「面板白屏」或「别的组件调不通」')

  const discovery = JSON.parse(readFileSync(join(asr.home, 'asr', 'runtime.json'), 'utf8'))
  assert.equal(discovery.baseUrl, `http://127.0.0.1:${asr.port}`, 'runtime.json 里必须写着真实端口')
  assert.match(discovery.token, /^[a-f0-9]{64}$/, '令牌必须是 64 位 hex')

  const panel = await asr.call('/dsh-asr/api/asr/status')
  assert.equal(panel.status, 200, '面板面必须能直接回应（线上是 DSH 的登录态拦在前面）')
  assert.equal(panel.body.ok, true)
  assert.equal(typeof panel.body.engine, 'string', '状态里要能看出当前引擎')

  const health = await asr.call('/dsh-asr/internal/health', { token: asr.token() })
  assert.equal(health.status, 200)
  assert.equal(health.body.ok, true)
  assert.equal(health.body.ready, false, '临时状态目录里没有模型，就绪状态必须是 false（不许假装就绪）')

  const catalog = await asr.call('/dsh-asr/internal/catalog', { token: asr.token() })
  assert.equal(catalog.status, 200)
  assert.ok(Array.isArray(catalog.body.engines), '内部 catalog 要给调用方引擎清单')
  assert.ok(catalog.body.limits, '内部 catalog 要给调用方大小/时长上限，调用方才能先拦一刀')
})

test('内部通道：无令牌/错令牌/带 Origin 都拦住，失败还必须是结构化的', async t => {
  const asr = await mountAsr(t)
  const token = asr.token()

  const anonymous = await asr.call('/dsh-asr/internal/health')
  assert.equal(anonymous.status, 401)
  assert.equal(anonymous.body.code, 'COMPONENT_AUTH')

  const forged = await asr.call('/dsh-asr/internal/health', { token: 'f'.repeat(64) })
  assert.equal(forged.status, 401, '长度对但值不对的令牌必须拒绝')

  const crossOrigin = await asr.call('/dsh-asr/internal/health', { token, origin: 'http://example.test' })
  assert.equal(crossOrigin.status, 403, '带 Origin 的请求不是本机内部调用，必须拒绝')
  assert.equal(crossOrigin.body.code, 'COMPONENT_ORIGIN')

  const unknown = await asr.call('/dsh-asr/internal/nope', { token })
  assert.equal(unknown.status, 400, '内部通道的未知路径走同一套失败形状（不是裸 404）')
  assert.equal(unknown.body.code, 'ASR_NOT_FOUND')
  assert.match(String(unknown.body.hint ?? ''), /\/transcribe/, '路径写错时要把可用接口列出来，而不是只说"未知接口"')

  // 模型没下载时，内部通道要给「机器能判断的码 + 人能照做的提示」，不能只丢一句 failed。
  const transcribe = await asr.call('/dsh-asr/internal/transcribe', {
    method: 'POST', token,
    body: { audio: silentWave().toString('base64'), source: 'qq' },
  })
  assert.equal(transcribe.body.ok, false, '临时状态目录里没有模型，识别必然失败')
  assert.equal(transcribe.body.code, 'ASR_MODEL_MISSING')
  assert.ok(String(transcribe.body.error ?? '').length > 0, 'error 要说人话')
  assert.ok(String(transcribe.body.hint ?? '').length > 0, 'hint 要给下一步（这里应是去面板点「下载并准备」）')
  assert.match(transcribe.body.hint, /下载并准备/)

  // 卸载要干净：路由撤掉、发现文件删掉，避免留下「进程重启后指向旧端口」的假线索。
  for (const callback of asr.effects) await callback()()
  assert.deepEqual(asr.routes, [], 'dispose 之后不能再占着路由')
  assert.equal(existsSync(join(asr.home, 'asr', 'runtime.json')), false, 'dispose 之后必须删掉 runtime.json')
  const after = await asr.call('/dsh-asr/internal/health', { token })
  assert.equal(after.status, 404, '卸载后内部通道就该没了')
})

test('面板面靠 connection 判会话：会话无效必须给出可行动的 401', async t => {
  // 线上探活看到的就是这个 401（挂上了但没带登录态）。
  const asr = await mountAsr(t, { rejection: () => 401 })
  const denied = await asr.call('/dsh-asr/api/asr/status')
  assert.equal(denied.status, 401)
  assert.equal(denied.body.code, 'AUTH_REJECTED')
  assert.ok(String(denied.body.hint ?? '').length > 0, '401 也要告诉人下一步怎么办')

  // 会话验证服务缺失时也不许"放行"，必须明确说不可用。
  const noConn = await mountAsr(t, { connection: false })
  const unavailable = await noConn.call('/dsh-asr/api/asr/status')
  assert.equal(unavailable.status, 503)
  assert.equal(unavailable.body.code, 'AUTH_UNAVAILABLE')
})
