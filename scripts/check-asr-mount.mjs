#!/usr/bin/env node
/**
 * ASR 面板装机体检：一条命令回答「`/dsh-asr` 到底挂上了没有」。
 *
 * 为什么需要它：2026-11-05 面板探活一直是 404，而当时**所有单测都是绿的** ——
 * 「handler 能跑」和「插件被 DSH 挂上」是两件事。手动 curl 又容易看错路径：
 * 真实路由是 `/dsh-asr/api/asr/...`（前缀 + `/asr`），探 `/dsh-asr/api/status` 必然 404，
 * 会把"挂上了"误判成"没挂"。
 *
 * 判据（2026-11-05 实测，带对照）：
 *   401 → **挂上了**（DSH 的会话中间件先拦，线上正常态就是这个）
 *   200 → 挂上了且没鉴权（本机直接开的时候）
 *   503 → 挂了，但 `connection` 服务缺失（AUTH_UNAVAILABLE）
 *   404 → 没挂上（插件没加载或没重启）
 *   对照：同一时刻探 `/dsh-voice/...`。voice 也是 401 而 asr 是 404 ⇒ 结论毫无歧义。
 *
 * **只读**：只发 HTTP GET 到本机 DSH 与读几个文件，不写状态、不启动/重启任何东西。
 * 用法：node scripts/check-asr-mount.mjs [--url http://127.0.0.1:3082]
 * 退出码：0 = 挂上了；1 = 没挂上（附下一步）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROFILE, ROOT, SERVICE_URL } from './lib/vivy.mjs'

const args = process.argv.slice(2)
const urlFlag = args.indexOf('--url')
const base = String(urlFlag >= 0 && args[urlFlag + 1] ? args[urlFlag + 1] : SERVICE_URL).replace(/\/+$/, '')
const say = (kind, text) => console.log(`${kind} ${text}`)

function preflight() {
  const profileDir = path.join(ROOT, '.artifacts', 'dsh-home', 'profiles', PROFILE)
  const manifestFile = path.join(profileDir, 'package.json')
  if (!fs.existsSync(manifestFile)) {
    say('✗', `profile 不存在：${manifestFile}（先跑 npm run setup）`)
    return false
  }
  let ok = true
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  const dependency = String(manifest.dependencies?.['dsh-local-asr'] ?? '')
  if (/^link:/.test(dependency)) say('✓', `profile 依赖：${dependency}`)
  else { say('✗', `profile 缺少 dsh-local-asr 依赖（当前 ${JSON.stringify(dependency)}）→ 跑 npm run setup:components`); ok = false }
  const bundles = manifest.dsh?.profile?.bundles ?? []
  if (bundles.includes('dsh-local-asr')) say('✓', `profile bundles：${bundles.join('、')}`)
  else { say('✗', `profile bundles 里没有 dsh-local-asr（当前 ${bundles.join('、') || '空'}）→ 插件永远不加载`); ok = false }

  const link = path.join(profileDir, 'node_modules', 'dsh-local-asr')
  if (fs.existsSync(path.join(link, 'src', 'index.mjs'))) say('✓', 'profile 软链能解析到 plugins/asr')
  else { say('✗', `profile 软链断了或指错：${link} → 跑 npm run setup:components`); ok = false }

  const patch = path.join(ROOT, 'plugins', 'asr', 'cordis.patch.yml')
  if (fs.existsSync(patch) && /id:\s*dsh-local-asr/.test(fs.readFileSync(patch, 'utf8'))) say('✓', 'cordis.patch.yml 里的插件 id 正确')
  else { say('✗', 'cordis.patch.yml 缺失或 id 不对'); ok = false }
  return ok
}

async function probe(route) {
  try {
    const response = await fetch(`${base}${route}`, { redirect: 'manual', signal: AbortSignal.timeout(4000) })
    const text = await response.text().catch(() => '')
    let code = ''
    try { code = String(JSON.parse(text).code ?? '') } catch {}
    return { status: response.status, code }
  } catch (error) {
    return { status: 0, code: '', error: String(error?.message ?? error) }
  }
}

function verdictOf(name, result) {
  if (result.status === 0) return { ok: false, text: `${name}：连不上 ${base}（${result.error}）→ DSH 没在跑就先 npm run start` }
  if (result.status === 401) return { ok: true, text: `${name}：401 ${result.code || 'AUTH_REJECTED'} —— 挂上了（会话中间件在拦，线上正常态）` }
  if (result.status === 200) return { ok: true, text: `${name}：200 —— 挂上了且本机直连未鉴权` }
  if (result.status === 503) return { ok: false, text: `${name}：503 ${result.code || 'AUTH_UNAVAILABLE'} —— 路由在了，但 connection 服务缺失` }
  if (result.status === 404) return { ok: false, text: `${name}：404 —— 没挂上（插件没加载 / 没重启）` }
  return { ok: false, text: `${name}：HTTP ${result.status} ${result.code}` }
}

console.log(`ASR 装机体检 @ ${base}`)
console.log('— 前置条件（文件层）—')
const filesOk = preflight()

console.log('— 实时探活（HTTP 层）—')
const asr = await probe('/dsh-asr/api/asr/status')
const internal = await probe('/dsh-asr/internal/health')
const voice = await probe('/dsh-voice/api/voice/rules')
const asrVerdict = verdictOf('asr 面板', asr)
const internalVerdict = verdictOf('asr 内部通道', internal)
const voiceVerdict = verdictOf('对照：voice 面板', voice)
say(asrVerdict.ok ? '✓' : '✗', asrVerdict.text)
say(internalVerdict.ok ? '✓' : '✗', internalVerdict.text)
say(voiceVerdict.ok ? '✓' : '—', voiceVerdict.text)

const mounted = asrVerdict.ok || internal.status === 401
const connectionMissing = asr.status === 503 || internal.status === 503
console.log('— 结论 —')
if (mounted) {
  console.log('挂上了。打开 DSH 面板 → 设置里的语音识别；或直接看 /dsh-asr/api/asr/status。')
  console.log('第一次用需要点「下载并准备」把模型下下来，然后跑一次自检。')
} else if (connectionMissing) {
  console.log('路由注册上了，但 DSH 的 connection 服务不可用（AUTH_UNAVAILABLE）—— 不是插件的问题。')
  console.log('下一步：npm run restart 后重跑本命令；仍如此就看 DSH 日志里 connection 服务是否起来。')
} else if (voiceVerdict.ok && asr.status === 404) {
  console.log('对照 voice 是通的、asr 是 404 ⇒ 插件没被加载。最可能是：插件是在 DSH 启动之后才装上的。')
  console.log('下一步：npm run restart（现在不会再撞 SurfCore pins 漂移），然后重跑本命令。')
} else {
  console.log('没挂上，且对照也不通：先确认 DSH 在跑（npm run status），再重跑本命令。')
}
if (!filesOk) console.log('注意：上面有 ✗ 的文件层问题，先修文件层再重启，否则重启也不会生效。')

process.exit(mounted ? 0 : 1)
