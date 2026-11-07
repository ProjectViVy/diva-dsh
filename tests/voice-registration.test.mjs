// 注册契约：语音设置页是 dsh-local-voice 自己的唯一 UI，不再有额外的 voice-center 插件。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { componentPackages } from '../scripts/lib/component-setup.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PLUGIN = join(ROOT, 'plugins', 'voice')
const CLIENT = readFileSync(join(PLUGIN, 'src', 'client.js'), 'utf8')

test('component registration includes dsh-local-voice and has no voice-center', () => {
  const packages = componentPackages(ROOT)
  assert.deepEqual(packages.find(([name]) => name === 'dsh-local-voice'), ['dsh-local-voice', PLUGIN])
  assert.equal(packages.some(([name]) => name === 'dsh-local-voice-center'), false)
  assert.equal(existsSync(join(ROOT, 'plugins', 'voice-center')), false, '旧的 voice-center 目录应已删除')
})

test('dsh-local-voice 的 bundle 同时提供宿主入口、客户端与 patch', () => {
  const manifest = JSON.parse(readFileSync(join(PLUGIN, 'package.json'), 'utf8'))
  assert.equal(manifest.name, 'dsh-local-voice')
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.main, './src/index.mjs')
  assert.equal(manifest.exports?.['./client'], './src/client.js')
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh?.client?.platform, 'web')
  assert.ok(existsSync(join(PLUGIN, manifest.main)), '主入口文件必须存在')
  assert.ok(existsSync(join(PLUGIN, manifest.exports['./client'])), '客户端入口文件必须存在')

  const patch = readFileSync(join(PLUGIN, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /-\s*insert:/)
  assert.match(patch, /id:\s*dsh-local-voice/)
  assert.match(patch, /name:\s*dsh-local-voice/)
})

test('客户端只注册 settings.section，使用稳定的分区 id', () => {
  assert.match(CLIENT, /ctx\.slots\.inject\('settings\.section'/)
  assert.match(CLIENT, /id:\s*'voice'/)
  assert.match(CLIENT, /order:\s*7/)
  assert.match(CLIENT, /label:\s*\(\)\s*=>\s*'语音'/)

  assert.doesNotMatch(CLIENT, /sidebar\.panellist/)
  assert.doesNotMatch(CLIENT, /name:\s*'main'/)
  assert.doesNotMatch(CLIENT, /id:\s*'voice-center'/)
  assert.doesNotMatch(CLIENT, /dsh-local-voice-center/)
})

test('客户端调用的接口都在两个既有插件里注册过', () => {
  const asrHttp = readFileSync(join(ROOT, 'plugins', 'asr', 'src', 'http.mjs'), 'utf8')
  const voiceHttp = readFileSync(join(ROOT, 'plugins', 'voice', 'src', 'http.mjs'), 'utf8')
  assert.match(CLIENT, /const ASR_API = '\/dsh-asr\/api'/)
  assert.match(CLIENT, /const VOICE_API = '\/dsh-voice\/api'/)
  assert.match(asrHttp, /const prefix = '\/dsh-asr\/api'/)
  assert.match(voiceHttp, /const prefix = '\/dsh-voice\/api'/)

  for (const path of ['/asr/rules', '/asr/status', '/asr/catalog', '/asr/prepare', '/asr/prepare-cancel', '/asr/self-check']) {
    assert.ok(CLIENT.includes(path), `客户端应调用 ${path}`)
    assert.ok(asrHttp.includes(path), `ASR 后端应注册 ${path}`)
  }
  for (const path of ['/voice/rules', '/voice/packs', '/voice/self-check', '/voice/preview', '/voice/library']) {
    assert.ok(CLIENT.includes(path), `客户端应调用 ${path}`)
    assert.ok(voiceHttp.includes(path), `voice 后端应注册 ${path}`)
  }
  for (const path of ['/voice/packs/cloud-stats', '/voice/packs/cloud-config', '/voice/packs/import-inspect', '/voice/library/probe', '/voice/library/send']) {
    assert.ok(CLIENT.includes(path), `设置页应调用 ${path}`)
    assert.ok(voiceHttp.includes(path), `voice 后端应注册 ${path}`)
  }
})

test('宿主半边满足 Loader 契约（设置页逻辑全在浏览器端）', async () => {
  const entry = await import(join(PLUGIN, 'src', 'index.mjs'))
  assert.equal(entry.name, 'dsh-local-voice')
  assert.ok(entry.inject.includes('webServer'))
  assert.ok(entry.inject.includes('connection'))
  assert.equal(typeof entry.apply, 'function')
  assert.equal(entry.default?.name, entry.name)
})

test('活的 profile 里只有 dsh-local-voice，没有 dsh-local-voice-center', t => {
  const profile = join(ROOT, '.artifacts', 'dsh-home', 'profiles', 'superagent-local')
  if (!existsSync(join(profile, 'package.json'))) {
    t.skip('本地没有生成 profile，跳过（干净环境里正常）')
    return
  }
  const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
  const dependency = manifest.dependencies?.['dsh-local-voice'] ?? ''
  assert.match(dependency, /^link:/, `profile 依赖应是 link: 形式，实际 ${JSON.stringify(dependency)}`)
  const bundles = manifest.dsh?.profile?.bundles ?? []
  assert.ok(bundles.includes('dsh-local-voice'), `profile bundles 缺少 dsh-local-voice（当前 ${bundles.join('、')}）`)
  assert.equal(manifest.dependencies?.['dsh-local-voice-center'], undefined)
  assert.equal(bundles.includes('dsh-local-voice-center'), false)

  const link = join(profile, 'node_modules', 'dsh-local-voice')
  assert.ok(existsSync(link), `profile 里没有 dsh-local-voice 软链：${link}`)
  assert.equal(realpathSync(link), realpathSync(PLUGIN), '软链必须解析到 plugins/voice')
  assert.equal(existsSync(join(profile, 'node_modules', 'dsh-local-voice-center')), false)
})
