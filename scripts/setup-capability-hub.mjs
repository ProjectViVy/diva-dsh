#!/usr/bin/env node
// 把语音插件的第三条线路接到世界网关上（幂等，可以反复跑）。
//
// 做的事只有三件，都在 `.artifacts/dsh-home` 里，不碰代码、不碰凭据：
//   1. 建 `voice/packs/voice-dashscope/`，写一份最小 `config.toml`（只有 `[engine].endpoint`）
//      和 `.installed` 标记——语音插件靠它认出「世界网关语音包已接线」。
//   2. 在 `capability-hub/registry.json` 里把 `tts` 插槽指向百炼的千问 TTS 并启用。
//   3. 打印下一步（凭据要自己填，本脚本不读也不写任何 key）。
//
// 为什么包目录要真建出来而不是软链：语音插件读包内 config.toml 时会拒绝符号链接。
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { prepareStateDir, projectHome } from '../plugins/_shared/paths.mjs'

const PORT = 3082
const GATEWAY_ENDPOINT = `http://127.0.0.1:${PORT}/dsh-capability-hub/api`
const PACK_ID = 'voice-dashscope'

const TTS_MODEL = process.env.DSH_TTS_MODEL || 'qwen3-tts-flash'
const TTS_BASE = process.env.DSH_TTS_BASE_URL || 'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com'

function writeAtomic(file, body) {
  writeFileSync(`${file}.tmp`, body, { mode: 0o600 })
  renameSync(`${file}.tmp`, file)
}

try {
  const home = projectHome(process.env)

  // 1. 语音包目录
  const packDir = prepareStateDir(join(home, 'voice', 'packs', PACK_ID), '世界网关语音包目录')
  const configFile = join(packDir, 'config.toml')
  const config = [
    '# 世界网关语音包：没有本机进程，合成由宿主的世界网关转发到阿里云百炼。',
    '# 由 scripts/setup-capability-hub.mjs 生成；改端口请改这里后重启宿主。',
    '',
    '[engine]',
    `endpoint = "${GATEWAY_ENDPOINT}"`,
    '',
  ].join('\n')
  if (!existsSync(configFile) || readFileSync(configFile, 'utf8') !== config) writeAtomic(configFile, config)
  const markerFile = join(packDir, '.installed')
  if (!existsSync(markerFile)) writeAtomic(markerFile, `${JSON.stringify({ id: PACK_ID, endpoint: GATEWAY_ENDPOINT, external: true }, null, 2)}\n`)
  console.log(`voice-dashscope: 已接线 → ${GATEWAY_ENDPOINT}`)

  // 2. registry 的 tts 插槽
  const stateDir = prepareStateDir(join(home, 'capability-hub'), '世界网关状态目录')
  const registryFile = join(stateDir, 'registry.json')
  let registry = null
  if (existsSync(registryFile)) {
    try {
      registry = JSON.parse(readFileSync(registryFile, 'utf8'))
    } catch (error) {
      // 读坏了不能覆盖：那是用户手改过的配置，宁可停下让人看。
      throw new Error(`registry.json 不是合法 JSON，先手动修好：${error?.message ?? error}`)
    }
  }
  const slots = registry?.slots && typeof registry.slots === 'object' ? registry.slots : {}
  const current = slots.tts ?? {}
  const next = {
    ...current,
    enabled: true,
    kind: 'dashscope',
    baseURL: String(current.baseURL ?? '').includes('{WorkspaceId}') && process.env.DSH_TTS_BASE_URL ? TTS_BASE : (current.baseURL || TTS_BASE),
    model: process.env.DSH_TTS_MODEL || current.model || TTS_MODEL,
    authRef: current.authRef || 'DASHSCOPE_API_KEY',
    note: current.note ?? '',
  }
  const before = JSON.stringify(current)
  if (before !== JSON.stringify(next) || !registry) {
    writeAtomic(registryFile, `${JSON.stringify({ version: 1, ...(registry ?? {}), slots: { ...slots, tts: next } }, null, 2)}\n`)
  }
  console.log(`capability-hub: tts 插槽已启用（${next.kind} / ${next.model}）`)

  // 3. 剩下的手动步骤
  const placeholder = next.baseURL.includes('{WorkspaceId}')
  const keyed = next.authRef
  console.log('')
  console.log('下一步（两件，脚本不替你做）：')
  if (placeholder) console.log(`  1. 把 tts 的 baseURL 改成你自己的工作空间域名：${next.baseURL}`)
  else console.log('  1. baseURL 已设置。')
  console.log(`  2. 填凭据 ${keyed}：面板块 → 世界网关 → 语音合成 → 凭据，或在「语音」页填 key。`)
  console.log('     填完在「语音」页选「世界网关语音包」→ 试听。')
  console.log('  重启宿主后新路由才生效：npm run stop && npm start')
  chmodSync(configFile, 0o600)
} catch (error) {
  console.error(`setup-capability-hub: ${error?.message ?? error}`)
  process.exit(1)
}
