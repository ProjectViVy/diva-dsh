// `scripts/check-asr-mount.mjs` 的判据回归。
//
// 为什么要钉：这套判据本身就是踩坑换来的 —— 真实路由是 `/dsh-asr/api/asr/...`
// （前缀 + `/asr`），探 `/dsh-asr/api/status` 必然 404，会把"挂上了"误判成"没挂"；
// 而面板线上正常态是 **401**（DSH 会话中间件先拦）。判据写错，用户就会在已经挂好的
// 情况下被指挥去乱重启。所以这三个分支必须有测试。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 起一个假 DSH：按路径给预设的状态码，用来喂 check-asr-mount.mjs。 */
async function fakeDsh(routes, run) {
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname
    const hit = routes[path] ?? { status: 404, body: { ok: false, code: 'NOT_FOUND' } }
    res.writeHead(hit.status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(hit.body))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try { return await run(`http://127.0.0.1:${server.address().port}`) }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
}

function runCheck(url) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts', 'check-asr-mount.mjs'), '--url', url], { cwd: ROOT })
    let out = ''
    child.stdout.on('data', chunk => { out += chunk })
    child.stderr.on('data', chunk => { out += chunk })
    child.on('close', code => resolve({ code, out }))
  })
}

const unauthorized = { status: 401, body: { ok: false, code: 'AUTH_REJECTED', error: '会话未通过验证', hint: '重新打开本地面板链接' } }

test('挂上了（面板 401 = 会话中间件在拦）→ 退出码 0 并给出下一步', async () => {
  await fakeDsh({
    '/dsh-asr/api/asr/status': unauthorized,
    '/dsh-asr/internal/health': unauthorized,
    '/dsh-voice/api/voice/rules': unauthorized,
  }, async url => {
    const result = await runCheck(url)
    assert.equal(result.code, 0, `挂上了就该退 0，实际输出：\n${result.out}`)
    assert.match(result.out, /挂上了/)
    assert.match(result.out, /下载并准备/, '要告诉第一次用的人下一步点什么')
  })
})

test('没挂上（asr 404 而对照 voice 401）→ 退出码 1 且点名"重启"', async () => {
  await fakeDsh({ '/dsh-voice/api/voice/rules': unauthorized }, async url => {
    const result = await runCheck(url)
    assert.equal(result.code, 1)
    assert.match(result.out, /404/)
    assert.match(result.out, /插件没被加载/)
    assert.match(result.out, /npm run restart/, '要给出人能照做的那一步')
  })
})

test('路由在了但 connection 服务缺失（503）→ 不许说成"没挂上"', async () => {
  await fakeDsh({
    '/dsh-asr/api/asr/status': { status: 503, body: { ok: false, code: 'AUTH_UNAVAILABLE', error: '会话验证不可用', hint: '检查 DSH 连接服务' } },
    '/dsh-voice/api/voice/rules': unauthorized,
  }, async url => {
    const result = await runCheck(url)
    assert.equal(result.code, 1)
    assert.match(result.out, /connection 服务不可用/)
    assert.doesNotMatch(result.out, /插件没被加载/, '这是两种完全不同的故障，不能混成一句话')
  })
})

test('DSH 没在跑（连不上）→ 明确说连不上，别猜插件', async () => {
  const result = await runCheck('http://127.0.0.1:59999')
  assert.equal(result.code, 1)
  assert.match(result.out, /连不上/)
  assert.match(result.out, /npm run start/)
})
