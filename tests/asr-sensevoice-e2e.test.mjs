// 真机用例：加载真的 SenseVoice 模型、真的拉起子进程、真的识别一句话。
//
// 默认跳过（模型有 228MiB，且只有 macOS 的 `say` 能现场造出中文语音）。
// 想跑：
//   DSH_ASR_E2E=1 node --test tests/asr-sensevoice-e2e.test.mjs
// 先用面板或 /dsh-asr/api/asr/prepare 把模型准备好。
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createConfigStore } from '../plugins/asr/src/store.mjs'
import { createModelStore } from '../plugins/asr/src/model-store.mjs'
import { createEngineRegistry } from '../plugins/asr/src/engine-registry.mjs'
import { createSensevoiceEngine } from '../plugins/asr/src/engine-sensevoice.mjs'
import { createAsrService, silentWave } from '../plugins/asr/src/service.mjs'

const ENABLED = process.env.DSH_ASR_E2E === '1'
const SKIP = ENABLED ? false : '需要 DSH_ASR_E2E=1 和已下载的 SenseVoice 模型'

/** 状态目录：默认用项目真实的 DSH_HOME，可用 DSH_ASR_E2E_STATE 指定。 */
function stateDir() {
  const configured = process.env.DSH_ASR_E2E_STATE
  if (configured) return resolve(configured)
  const home = process.env.DSH_HOME ?? join(process.cwd(), '.artifacts', 'dsh-home')
  return join(resolve(home), 'asr')
}

/** 用系统 TTS 造一段真实中文语音（16k 单声道 PCM16）。 */
function speechWave(text) {
  const dir = mkdtempSync(join(resolve('.artifacts/test-tmp'), 'asr-say-'))
  const file = join(dir, 'speech.wav')
  execFileSync('/usr/bin/say', ['-o', file, '--data-format=LEI16@16000', text], { stdio: 'pipe' })
  return { bytes: readFileSync(file), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('the real SenseVoice engine loads the model and transcribes speech', { skip: SKIP, timeout: 600000 }, async t => {
  const dir = stateDir()
  if (!existsSync(join(dir, 'models'))) t.skip(`状态目录里没有模型：${dir}（先运行 prepare）`)
  mkdirSync(join(dir, 'tmp'), { recursive: true })

  const configStore = createConfigStore(dir)
  const modelStore = createModelStore(dir, { getOrigins: () => configStore.get().sensevoice.modelSources })
  const engine = createSensevoiceEngine({ stateDir: dir, modelStore, getConfig: () => configStore.get() })
  const engines = createEngineRegistry()
  engines.register(engine)
  const { service } = createAsrService({ stateDir: dir, configStore, engines, engine })
  t.after(async () => { await service.dispose() })

  const status = engine.status()
  assert.equal(status.ready, true, `模型未就绪：${dir}`)
  assert.equal(engine.info.id, 'sensevoice')

  // 1）静音：必须跑通，且不该凭空造出文字。
  const silence = await service.transcribe({ audioBytes: silentWave(1), source: 'e2e' })
  assert.equal(silence.ok, true)
  assert.ok(silence.text.length <= 4, `静音应当接近空，实际：${JSON.stringify(silence.text)}`)

  // 2）真实语音：中文句子应当能被识别出关键词。
  const spoken = process.platform === 'darwin' ? speechWave('你好，世界。今天天气不错。') : null
  if (!spoken) t.diagnostic('非 macOS：跳过语音内容用例（没有可用的本地 TTS）')
  else t.after(spoken.cleanup)
  if (spoken) {
    const result = await service.transcribe({ audioBytes: spoken.bytes, language: 'zh', source: 'e2e' })
    assert.equal(result.ok, true)
    assert.ok(result.audioSeconds > 1, `应当有音频时长，实际 ${result.audioSeconds}`)
    assert.ok(result.text.length > 0, '真实语音不该识别成空')
    assert.match(result.text, /[你世天候气好界]/, `识别结果应当包含句子里的字：${result.text}`)
  }
})
