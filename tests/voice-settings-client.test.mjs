// 语音设置页的客户端契约：唯一 UI 在 settings.section，数据层与渲染都在这里验证。
// 浏览器能力（真实表单、音频设备）仍靠手工验收，这里只驱动 store 与可渲染的组件树。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

const CLIENT = resolve('plugins/voice/src/client.js')

const ASR_RULES = {
  enabled: true,
  engine: 'sensevoice',
  limits: { maxSeconds: 120, maxBytes: 8388608, maxPerMinute: 6, maxPerHour: 120 },
  cache: { enabled: true, maxEntries: 200 },
  audit: true,
  sensevoice: { precision: 'int8', threads: 2, segmentSeconds: 30, vadThreshold: 0.5, idleTimeoutMs: 600000, modelSources: ['https://hf-mirror.com'] },
  ui: { language: 'auto' },
}

const TTS_RULES = {
  enabled: true,
  aiEnabled: true,
  triggerWho: 'owner',
  members: [],
  groups: [],
  route: 'local',
  ttsCharacterByRoute: { local: '赵信', cloud: '小美' },
  endpoints: { local: 'http://127.0.0.1:50000', cloud: 'http://127.0.0.1:50001' },
  maxPerMinute: 2,
  maxPerHour: 10,
  maxSeconds: 300,
  maxBytes: 20971520,
  defaultVolume: 1,
  loudness: 'normal',
  autoReadback: true,
  ttsTimeoutMs: 60000,
  ttsMaxChars: 120,
  ttsCacheVersion: 0,
  pricePerKChar: 0,
  monthlyQuota: 0,
  ffmpegPath: '',
  ffprobePath: '',
  ttsCharactersByRoute: { local: ['赵信', '盖伦'], cloud: ['小美'] },
  ttsCharacterSavedByRoute: { local: '赵信', cloud: '小美' },
  ttsCharacters: ['赵信', '盖伦'],
}

const LOCAL_PACK = { id: 'voice-local', name: '本地语音', installed: true, running: true, archives: [] }
const CLOUD_PACK = { id: 'voice-cloud', name: '云端语音', installed: false, archives: [] }

const clone = value => JSON.parse(JSON.stringify(value))
const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() { return clone(data) },
  async blob() { return { audio: true } },
})

function fakeReact() {
  return {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useEffect: () => {},
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }
}

function harness({ handle, packs } = {}) {
  const requests = []
  const intervals = []
  const timeouts = []
  const clearedIntervals = []
  const revoked = []
  const react = fakeReact()
  let exported = null
  let nextTimer = 1

  async function defaults(request) {
    const { url, method } = request
    if (url === '/dsh-asr/api/asr/rules') return response(method === 'POST' ? { ok: true } : ASR_RULES)
    if (url === '/dsh-asr/api/asr/status') return response({ ok: true, recent: [], budget: { inHour: 1, inMinute: 0 }, cache: { entries: 0 } })
    if (url === '/dsh-asr/api/asr/catalog') return response({
      ok: true,
      engine: 'sensevoice',
      engines: [{
        id: 'sensevoice', name: 'SenseVoice', ready: true, languages: ['zh'], precision: 'int8',
        model: { directory: '/models/sensevoice', verifiedAt: '2026-01-01T00:00:00Z', bytes: { have: 10, total: 10 } },
        worker: { running: false, pending: 0, logs: [] },
      }],
    })
    if (url === '/dsh-asr/api/asr/prepare') return response({ ok: true, active: false, ready: true })
    if (url === '/dsh-asr/api/asr/prepare-cancel') return response({ ok: true, active: false, ready: false })
    if (url === '/dsh-asr/api/asr/self-check') return response({ ok: true, stages: [{ id: 'engine', label: '引擎', ok: true, detail: '可用' }] })
    if (url === '/dsh-voice/api/voice/rules') return response(method === 'POST' ? { ok: true } : TTS_RULES)
    if (url === '/dsh-voice/api/voice/packs') return response({
      ok: true,
      onlineInstallSupported: false,
      directoryPickerSupported: false,
      packs: packs ?? [LOCAL_PACK, CLOUD_PACK],
    })
    if (url.startsWith('/dsh-voice/api/voice/packs/cloud-stats')) return response({ ok: true, model: '测试模型', todayChars: 2, todayCalls: 1, monthChars: 9, monthCalls: 2, monthCost: 0.1, remainChars: 1000 })
    if (url.startsWith('/dsh-voice/api/voice/packs/cloud-config')) return response({ ok: true, configured: true, appId: 'app-id', speaker: 'speaker-id', hasAccessKey: true, accessKeyMasked: 'abcd****wxyz' })
    if (url === '/dsh-voice/api/voice/library') return response({ ok: true, dir: '/project/voice/audio', count: 1, offset: 0, voices: [{ name: '问候.wav' }] })
    if (url.startsWith('/dsh-voice/api/voice/library?offset=')) return response({ ok: true, dir: '/project/voice/audio', count: 101, offset: Number(new URL(url, 'http://x').searchParams.get('offset')), voices: [{ name: 'last.wav' }] })
    if (url === '/dsh-voice/api/voice/library/probe') return response({ ok: true, voices: [{ name: '问候.wav', ok: true, detail: '通过' }] })
    if (url === '/dsh-voice/api/voice/library/send') return response({ ok: true, dryRun: request.body?.dryRun === true, detail: '通过' })
    if (url === '/dsh-voice/api/voice/self-check') return response({ ok: true, stages: [{ id: 'service', label: '服务', ok: true, detail: '可用' }] })
    if (url === '/dsh-voice/api/voice/preview') return response({ ok: true })
    if (url === '/dsh-voice/api/voice/packs/import-inspect') return response({ ok: true, sourceDir: request.body?.sourceDir, targetDir: '/project/packs/voice-local', version: 'v1.2.3', sizeBytes: 1234567, verified: true })
    if (url === '/dsh-voice/api/voice/packs/choose-import') return response({ ok: true, path: '/imports/voice-local' })
    if (url === '/dsh-voice/api/voice/packs/test') return response({ ok: true, ms: 1250, seconds: 2.5 })
    if (url.startsWith('/dsh-voice/api/voice/packs/')) return response({ ok: true, phase: '完成' })
    return undefined
  }

  const fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(init.body) : undefined
    const request = { url, method, body }
    requests.push(request)
    if (handle) {
      const custom = await handle(request)
      if (custom !== undefined) return custom
    }
    const fallback = await defaults(request)
    assert.ok(fallback, `unexpected request ${method} ${url}`)
    return fallback
  }

  const window = { confirm: () => true }
  const context = {
    window, fetch, console: { warn() {} },
    setInterval: (fn, ms) => { const id = nextTimer++; intervals.push({ id, fn, ms }); return id },
    clearInterval: id => { clearedIntervals.push(id) },
    setTimeout: fn => { const id = nextTimer++; timeouts.push({ id, fn }); return id },
    clearTimeout: () => {},
    URL: {
      createObjectURL: () => `blob:preview-${requests.length}`,
      revokeObjectURL: url => revoked.push(url),
    },
  }
  window.__ModuleLoader__ = { load: ({ id, factory }) => {
    assert.equal(id, 'dsh-local-voice')
    exported = factory(() => react)
  } }
  runInNewContext(readFileSync(CLIENT, 'utf8'), context)

  const slots = []
  const entries = []
  const disposers = []
  exported.apply({
    effect: callback => { disposers.push(callback); return () => {} },
    slots: {
      inject: (name, register) => { slots.push(name); register() },
      register: (options, component) => entries.push({ options, component }),
    },
  })
  const { store } = entries[0].options.inject()
  return { entries, store, requests, slots, intervals, clearedIntervals, revoked, window, disposers, context }
}

const flush = async () => { for (let index = 0; index < 8; index++) await new Promise(resolve => setImmediate(resolve)) }

const flatten = children => (Array.isArray(children) ? children.flat(Infinity) : [children])

function walk(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (Array.isArray(node)) { for (const child of node) walk(child, predicate, out); return out }
  if (typeof node === 'string' || typeof node === 'number') return out
  if (typeof node !== 'object') return out
  if (typeof node.type === 'function') { walk(node.type({ ...node.props, children: node.children }), predicate, out); return out }
  if (!predicate || predicate(node)) out.push(node)
  for (const child of flatten(node.children ?? [])) walk(child, predicate, out)
  return out
}

function renderText(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(renderText).join(' ')
  if (typeof node !== 'object') return ''
  if (typeof node.type === 'function') return renderText(node.type({ ...node.props, children: node.children }))
  return flatten(node.children ?? []).map(renderText).join(' ')
}

const findButton = (tree, label) => walk(tree, node => node.type === 'button' && flatten(node.children).includes(label))[0]
const findInput = (tree, label) => walk(tree, node => node.props?.['aria-label'] === label)[0]

test('registers exactly one voice settings section and loads both plugin surfaces', async () => {
  const { entries, slots, store, requests } = harness()
  assert.equal(entries.length, 1)
  assert.equal(entries[0].options.name, 'settings.section')
  assert.equal(entries[0].options.id, 'voice')
  assert.equal(entries[0].options.order, 7)
  assert.equal(entries[0].options.label(), '语音')
  assert.equal(typeof entries[0].component, 'function')
  assert.deepEqual(slots, ['settings.section'], '语音插件只注册设置分区，不再注册侧边面板')

  store.ensureLoaded()
  await flush()
  const urls = requests.map(request => request.url)
  for (const expected of [
    '/dsh-asr/api/asr/rules', '/dsh-asr/api/asr/status', '/dsh-asr/api/asr/catalog', '/dsh-asr/api/asr/prepare',
    '/dsh-voice/api/voice/rules', '/dsh-voice/api/voice/packs', '/dsh-voice/api/voice/library',
  ]) assert.ok(urls.includes(expected), expected)
  assert.equal(urls.some(url => url.includes('cloud-stats')), false, '云端包未安装时不应读取用量')

  const state = store.getSnapshot()
  assert.equal(state.asr.phase, 'ready')
  assert.equal(state.tts.phase, 'ready')
  assert.equal(state.asr.draft.engine, 'sensevoice')
  assert.equal(state.asr.draft.maxBytesMiB, 8)
  assert.equal(state.tts.draft.characters.local, '赵信')
  assert.equal(state.voice.library.count, 1)
})

test('the section renders the six voice tabs and no retired panel views', async () => {
  const { entries, store } = harness()
  store.ensureLoaded()
  await flush()
  const tree = entries[0].component({ store })
  const tabs = walk(tree, node => node.props?.role === 'tab').map(node => flatten(node.children).join(''))
  assert.deepEqual(tabs, ['总览', '识别', '合成', '语音包', '语音库', '测试'])
  const text = renderText(tree)
  assert.match(text, /语音识别、语音合成、语音包与语音库共用这一页/)
  assert.doesNotMatch(text, /设置 → 语音|已移至 DSH 设置/)
})

test('ASR save sends only the whitelist and re-reads the server rules', async () => {
  const { store, requests } = harness()
  store.ensureLoaded()
  await flush()
  store.editAsr({ maxBytesMiB: '12', sourcesText: '' })
  await store.saveAsr()
  await flush()

  const posts = requests.filter(request => request.method === 'POST' && request.url === '/dsh-asr/api/asr/rules')
  assert.equal(posts.length, 1)
  const body = posts[0].body
  assert.deepEqual(Object.keys(body).sort(), ['audit', 'cache', 'enabled', 'engine', 'limits', 'sensevoice', 'ui'])
  assert.equal(body.limits.maxBytes, 12 * 1048576)
  assert.equal(body.sensevoice.modelSources, null)
  assert.equal('model' in body, false)
  assert.equal('precision' in body, false)
  assert.equal(requests.filter(request => request.method === 'GET' && request.url === '/dsh-asr/api/asr/rules').length, 2)
  assert.match(store.getSnapshot().asr.savedMessage, /已重新读取服务端配置/)
})

test('ASR empty numeric input is rejected instead of being saved as zero', async () => {
  const { store, requests } = harness()
  store.ensureLoaded()
  await flush()
  store.editAsr({ maxSeconds: '' })
  await store.saveAsr()

  assert.match(store.getSnapshot().asr.saveError, /单条最长秒数不能为空/)
  assert.equal(requests.some(request => request.method === 'POST' && request.url === '/dsh-asr/api/asr/rules'), false)
})

test('TTS save sends only the current route character and reconciles the response', async () => {
  let serverRules = clone(TTS_RULES)
  let posted = null
  const { store, requests } = harness({ handle: async request => {
    if (request.url !== '/dsh-voice/api/voice/rules') return undefined
    if (request.method === 'POST') {
      posted = request.body
      serverRules = {
        ...serverRules,
        route: request.body.route,
        ttsCharacterByRoute: { ...serverRules.ttsCharacterByRoute, [request.body.route]: request.body.ttsCharacter },
      }
      return response({ ok: true })
    }
    return response(serverRules)
  } })
  store.ensureLoaded()
  await flush()
  store.editTts({ groupsText: '123，456 789' })
  store.editTtsRoute('cloud')
  store.editTtsCharacter('新云端')
  await store.saveTts()
  await flush()

  assert.equal(posted.route, 'cloud')
  assert.equal(posted.ttsCharacter, '新云端')
  assert.deepEqual(posted.groups, ['123', '456', '789'])
  for (const derived of ['ttsCharacterByRoute', 'ttsCharactersByRoute', 'ttsCharacterSavedByRoute', 'ttsCharacters', 'ttsCharacterErrorsByRoute']) {
    assert.equal(derived in posted, false, derived)
  }
  assert.equal(store.getSnapshot().tts.saved.ttsCharacterByRoute.cloud, '新云端')
  assert.equal(requests.filter(request => request.method === 'GET' && request.url === '/dsh-voice/api/voice/rules').length, 2)
})

test('switching routes keeps both drafts and the other route survives a save', async () => {
  const { store } = harness()
  store.ensureLoaded()
  await flush()
  store.editTtsRoute('cloud')
  store.editTtsCharacter('云端草稿')
  store.editTtsRoute('local')
  store.editTtsCharacter('本地草稿')
  store.editTtsRoute('cloud')
  assert.equal(store.getSnapshot().tts.draft.characters.cloud, '云端草稿')
  assert.equal(store.getSnapshot().tts.draft.characters.local, '本地草稿')

  await store.saveTts()
  await flush()
  const state = store.getSnapshot()
  assert.equal(state.tts.draft.characters.local, '本地草稿', '另一线路的未保存草稿不能被保存结果覆盖')
  assert.match(state.tts.savedMessage, /另一线路的音色草稿仍未保存/)
})

test('one unavailable side degrades on its own and the other still renders', async () => {
  const { entries, store } = harness({ handle: async request => {
    if (request.url.startsWith('/dsh-asr/api/')) return response({ ok: false, error: 'ASR 服务未启动' }, 503)
    return undefined
  } })
  store.ensureLoaded()
  await flush()
  const state = store.getSnapshot()
  assert.equal(state.asr.phase, 'unavailable')
  assert.match(state.asr.error, /ASR 服务未启动/)
  assert.equal(state.tts.phase, 'ready')
  assert.ok(state.tts.draft)

  const overview = renderText(entries[0].component({ store }))
  assert.match(overview, /语音识别插件未连接/)
  assert.match(overview, /dsh-local-asr/)
  assert.match(overview, /语音合成/)

  store.setTab('tts')
  const tts = renderText(entries[0].component({ store }))
  assert.match(tts, /赵信/)
})

test('a failed save keeps the draft and shows the error in place', async () => {
  const { store, requests } = harness({ handle: async request => {
    if (request.method === 'POST' && request.url === '/dsh-asr/api/asr/rules') {
      return response({ ok: false, error: '配置文件只读' }, 500)
    }
    return undefined
  } })
  store.ensureLoaded()
  await flush()
  store.editAsr({ maxSeconds: '77' })
  await store.saveAsr()

  const state = store.getSnapshot()
  assert.equal(state.asr.draft.maxSeconds, '77')
  assert.match(state.asr.saveError, /配置文件只读/)
  assert.equal(requests.filter(request => request.method === 'GET' && request.url === '/dsh-asr/api/asr/rules').length, 1)
})

test('self-checks hit their own endpoints and preview validates length and route', async () => {
  const { store, requests } = harness()
  store.ensureLoaded()
  await flush()

  await store.runAsrCheck()
  await store.runTtsCheck()
  assert.deepEqual(requests.find(request => request.url === '/dsh-asr/api/asr/self-check').body, {})
  assert.deepEqual(requests.find(request => request.url === '/dsh-voice/api/voice/self-check').body, {})
  assert.equal(store.getSnapshot().asr.check.stages[0].ok, true)
  assert.equal(store.getSnapshot().tts.check.stages[0].ok, true)

  store.setPreviewText('字'.repeat(501))
  await store.preview()
  assert.equal(requests.some(request => request.url === '/dsh-voice/api/voice/preview'), false)
  assert.match(store.getSnapshot().tts.previewError, /最多 500 字/)

  store.setPreviewText('你好')
  store.setPreviewRoute('cloud')
  await store.preview()
  const preview = requests.find(request => request.url === '/dsh-voice/api/voice/preview')
  assert.deepEqual(preview.body, { id: 'voice-cloud', text: '你好' })
  assert.match(store.getSnapshot().tts.previewUrl, /^blob:preview-/)
})

test('a draft survives tab switches because it lives in the apply-scope store', async () => {
  const { store } = harness()
  store.ensureLoaded()
  await flush()
  store.editAsr({ threads: '4' })
  store.setTab('tts')
  store.setTab('asr')
  assert.equal(store.getSnapshot().asr.draft.threads, '4')
})

test('the library tab pages, probes and rejects a changed library', async () => {
  let changed = false
  const { entries, store, requests } = harness({ handle: async request => {
    if (request.url === '/dsh-voice/api/voice/library/probe') {
      return response({ ok: true, voices: [{ name: changed ? 'different.wav' : 'last.wav', ok: true }] })
    }
    return undefined
  } })
  store.ensureLoaded()
  await flush()
  store.setTab('library')

  let tree = entries[0].component({ store })
  assert.match(renderText(tree), /问候\.wav/)
  assert.match(renderText(tree), /\/project\/voice\/audio/)

  await findButton(tree, '下一页').props.onClick()
  await flush()
  assert.ok(requests.some(request => request.url.includes('/voice/library?offset=100')))
  tree = entries[0].component({ store })
  assert.match(renderText(tree), /last\.wav/)
  assert.equal(findInput(tree, '试发音频').props.value, '')

  await findButton(tree, '检查语音文件').props.onClick()
  await flush()
  const probe = requests.find(request => request.url === '/dsh-voice/api/voice/library/probe')
  assert.equal(probe.body.offset, 100)
  tree = entries[0].component({ store })
  assert.match(renderText(tree), /last\.wav：通过/)
  assert.match(renderText(tree), /检查结果/)

  changed = true
  await findButton(tree, '检查语音文件').props.onClick()
  await flush()
  tree = entries[0].component({ store })
  assert.match(renderText(tree), /语音库内容已变化，请刷新语音库后重新检查/)
  assert.equal(store.getSnapshot().voice.libraryProbe, null)
})

test('the trial tab validates by default and requires confirmation before sending', async () => {
  const { entries, store, requests, window } = harness()
  store.ensureLoaded()
  await flush()
  store.setTab('library')
  let tree = entries[0].component({ store })

  store.setTrialField('trialTarget', 'group:1234')
  store.setTrialField('kind', 'file')
  store.setTrialField('trialFile', '问候.wav')
  tree = entries[0].component({ store })
  assert.equal(findButton(tree, '校验或试发').props.disabled, false)
  await findButton(tree, '校验或试发').props.onClick()
  await flush()
  assert.deepEqual(requests.find(request => request.url === '/dsh-voice/api/voice/library/send').body, { target: 'group:1234', file: '问候.wav', dryRun: true })
  assert.match(renderText(entries[0].component({ store })), /校验通过（未发送）：通过/)

  store.setTrialField('trialDryRun', false)
  window.confirm = () => false
  const before = requests.filter(request => request.url === '/dsh-voice/api/voice/library/send').length
  await findButton(entries[0].component({ store }), '校验或试发').props.onClick()
  await flush()
  assert.equal(requests.filter(request => request.url === '/dsh-voice/api/voice/library/send').length, before)

  window.confirm = () => true
  store.setTrialField('kind', 'text')
  store.setTrialField('trialText', '你好世界')
  await findButton(entries[0].component({ store }), '校验或试发').props.onClick()
  await flush()
  const sent = requests.filter(request => request.url === '/dsh-voice/api/voice/library/send').at(-1)
  assert.deepEqual(sent.body, { target: 'group:1234', text: '你好世界', dryRun: false })

  window.confirm = () => true
  store.setTrialField('kind', 'path')
  store.setTrialField('trialPath', '/tmp/test.wav')
  await findButton(entries[0].component({ store }), '校验或试发').props.onClick()
  await flush()
  assert.deepEqual(requests.filter(request => request.url === '/dsh-voice/api/voice/library/send').at(-1).body, { target: 'group:1234', filePath: '/tmp/test.wav', dryRun: false })
})

test('the packs tab renders pack details, inspection results and cloud guidance', async () => {
  const local = {
    id: 'voice-local', name: '本地语音包', installed: true, running: false, managed: true,
    dir: '/project/packs/voice-local', port: 8767, enginePort: 8768, engineUp: true, sizeBytes: 2000000000,
    about: { summary: '联网合成', pros: ['不需要显卡'], cons: ['需要网络'], billing: '按字符计费', disclaimer: '以实际账单为准' },
    install: { phase: '安装依赖', progress: 85, logTail: '正在安装依赖包' },
    importSource: '/original/source', backupDir: '/project/packs/voice-local.backup-123', archives: ['20260101-1'],
  }
  const cloud = { id: 'voice-cloud', name: '云端语音包', installed: true, running: true, archives: [], cloudConfigError: '云端配置恢复记录损坏，原文件已保留' }
  const { entries, store } = harness({ packs: [local, cloud] })
  store.ensureLoaded()
  await flush()
  store.setTab('packs')
  await store.voiceAction('/voice/packs/import-inspect', { id: 'voice-local', sourceDir: '/source/voice' })
  await flush()

  const tree = entries[0].component({ store })
  const text = renderText(tree)
  for (const expected of [
    '8767', '8768', '/project/packs/voice-local', '联网合成', '不需要显卡', '需要网络',
    '按字符计费', '以实际账单为准', '正在安装依赖包', '2.00 GB', '/source/voice',
    '/project/packs/voice-local', 'v1.2.3', '1.23 MB', '恢复记录损坏', 'Access Key',
    '备份：20260101-1',
  ]) assert.ok(text.includes(expected), expected)
  assert.ok(!text.includes('云端密钥或音色尚未配置'))
  assert.ok(walk(tree, node => node.type === 'a' && node.props.href?.startsWith('https://pan.quark.cn/')).length)
  assert.ok(walk(tree, node => node.type === 'a' && node.props.href === 'https://console.volcengine.com/speech/service/8').length)
  assert.ok(findButton(tree, '打开参考音频所在位置'))
  assert.ok(findButton(tree, '在线安装'))
  assert.ok(findButton(tree, '取消安装'))
  assert.equal(findButton(tree, '停止').props.disabled, false, '预热中的自有进程必须允许停止')
  assert.equal(findButton(tree, '选择导入目录').props.disabled, true)
  assert.match(text, /当前系统请手动填写导入目录/)
  assert.ok(findButton(tree, '删除导入源文件夹'))
  assert.ok(findButton(tree, '删除旧包导入备份'))
  assert.ok(findButton(tree, '恢复语音包'))
  assert.match(text, /测试模型/)
})

test('the folder picker fills the import directory only when supported', async () => {
  const { entries, store, requests } = harness({ packs: [{ ...LOCAL_PACK, archives: [] }] })
  store.ensureLoaded()
  await flush()
  store.setTab('packs')
  assert.equal(findButton(entries[0].component({ store }), '选择导入目录').props.disabled, true)
  assert.match(renderText(entries[0].component({ store })), /当前系统请手动填写导入目录/)

  await store.chooseImport()
  await flush()
  assert.ok(requests.some(request => request.url === '/dsh-voice/api/voice/packs/choose-import'))
  assert.equal(store.getSnapshot().voice.source, '/imports/voice-local')
  assert.equal(findInput(entries[0].component({ store }), '导入目录').props.value, '/imports/voice-local')
})

test('the folder picker becomes available when the host reports support', async () => {
  const { entries, store } = harness({ handle: async request => {
    if (request.url === '/dsh-voice/api/voice/packs') return response({ ok: true, directoryPickerSupported: true, packs: [LOCAL_PACK] })
    return undefined
  } })
  store.ensureLoaded()
  await flush()
  store.setTab('packs')
  assert.equal(findButton(entries[0].component({ store }), '选择导入目录').props.disabled, false)
})

test('cloud configuration status never exposes the stored secret', async () => {
  const { entries, store, requests } = harness({ packs: [{ ...CLOUD_PACK, installed: true, running: true }] })
  store.ensureLoaded()
  await flush()
  store.setTab('packs')
  await store.readCloudConfig()
  await flush()

  const read = requests.find(request => request.url.startsWith('/dsh-voice/api/voice/packs/cloud-config'))
  assert.equal(read.method, 'GET')
  assert.equal(read.url, '/dsh-voice/api/voice/packs/cloud-config?id=voice-cloud')
  const config = store.getSnapshot().voice.cloudConfig
  assert.equal(config.accessKeyMasked, 'abcd****wxyz')
  assert.equal(store.getSnapshot().voice.credentials.accessKey, '')
  const text = renderText(entries[0].component({ store }))
  assert.match(text, /密钥已保存：abcd\*\*\*\*wxyz/)
  assert.doesNotMatch(text, /abcdwxyz/)
})

test('installed cloud pack polls usage, reports errors and recovers', async () => {
  let statsCalls = 0
  const { entries, store, requests, intervals, clearedIntervals } = harness({ handle: async request => {
    if (!request.url.startsWith('/dsh-voice/api/voice/packs/cloud-stats')) return undefined
    statsCalls += 1
    if (statsCalls === 1) return response({ ok: false, error: '配置损坏' }, 500)
    return response({ ok: true, model: '恢复模型', todayChars: 3, todayCalls: 1, monthChars: 7, monthCalls: 2 })
  }, packs: [{ ...CLOUD_PACK, installed: true, running: true }] })
  store.ensureLoaded()
  await flush()
  assert.equal(statsCalls, 1)
  assert.match(store.getSnapshot().tts.cloudError, /配置损坏/)

  const cloudTimer = intervals.find(interval => interval.ms === 5000)
  assert.ok(cloudTimer, '云端用量应有独立轮询')
  cloudTimer.fn()
  await flush()
  assert.equal(statsCalls, 2)
  assert.equal(store.getSnapshot().tts.cloud.model, '恢复模型')
  assert.equal(store.getSnapshot().tts.cloudError, '')
  assert.match(renderText(entries[0].component({ store })), /恢复模型/)

  store.dispose()
  assert.ok(clearedIntervals.includes(cloudTimer.id), 'dispose 必须清掉云端轮询')
})

test('pack actions surface warmup warnings and stop stays usable during a synthesis test', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const pack = { id: 'voice-local', name: '本地语音包', installed: true, running: true, archives: [] }
  const { entries, store } = harness({ packs: [pack], handle: async request => {
    if (request.url === '/dsh-voice/api/voice/packs/start') return response({ ok: true, warning: '语音引擎仍在预热' })
    if (request.url === '/dsh-voice/api/voice/packs/test') { await pending; return response({ ok: true, ms: 1250, seconds: 2.5 }) }
    return undefined
  } })
  store.ensureLoaded()
  await flush()
  store.setTab('packs')

  await store.voiceAction('/voice/packs/start', { id: 'voice-local' })
  assert.match(store.getSnapshot().voice.message, /语音引擎仍在预热/)

  const testing = store.voiceAction('/voice/packs/test', { id: 'voice-local' })
  await flush()
  const tree = entries[0].component({ store })
  assert.equal(findButton(tree, '停止').props.disabled, false, '合成测试期间仍应能停止语音包')
  assert.equal(findButton(tree, '测试合成').props.disabled, true)
  release()
  await testing
  await flush()
  assert.match(store.getSnapshot().voice.message, /1250/)
  assert.match(store.getSnapshot().voice.message, /2\.5/)
})

test('cancelling the recorded import cleanup keeps both directories untouched', async () => {
  const pack = { ...LOCAL_PACK, importSource: '/original/source', backupDir: '/project/packs/voice-local.backup-123' }
  const { entries, store, requests, window } = harness({ packs: [pack] })
  store.ensureLoaded()
  await flush()
  store.setTab('packs')
  const tree = entries[0].component({ store })

  window.confirm = message => { assert.match(message, /\/original\/source/); return false }
  await findButton(tree, '删除导入源文件夹').props.onClick()
  window.confirm = message => { assert.match(message, /voice-local\.backup-123/); return false }
  await findButton(tree, '删除旧包导入备份').props.onClick()
  assert.equal(requests.some(request => request.url.includes('import-delete-')), false)

  window.confirm = () => true
  await findButton(tree, '删除导入源文件夹').props.onClick()
  await findButton(tree, '删除旧包导入备份').props.onClick()
  await flush()
  const source = requests.find(request => request.url === '/dsh-voice/api/voice/packs/import-delete-source')
  const backup = requests.find(request => request.url === '/dsh-voice/api/voice/packs/import-delete-backup')
  assert.deepEqual(source.body, { id: 'voice-local', sourceDir: '/original/source' })
  assert.deepEqual(backup.body, { id: 'voice-local', backupDir: '/project/packs/voice-local.backup-123' })
})

test('ASR model preparation posts, polls to completion and supports cancellation', async () => {
  let preparing = false
  const { store, requests, intervals } = harness({ handle: async request => {
    if (request.url === '/dsh-asr/api/asr/prepare' && request.method === 'POST') {
      preparing = true
      return response({ ok: true, active: true, ready: false, transfer: { receivedAll: 40, totalAll: 100 } })
    }
    if (request.url === '/dsh-asr/api/asr/prepare' && request.method === 'GET' && preparing) {
      preparing = false
      return response({ ok: true, active: false, ready: true })
    }
    if (request.url === '/dsh-asr/api/asr/prepare-cancel') return response({ ok: true, active: false, ready: false })
    return undefined
  } })
  store.ensureLoaded()
  await flush()

  await store.startPrepare()
  assert.equal(store.getSnapshot().asr.prepare.active, true)
  const poll = intervals.find(interval => interval.ms === 1500)
  assert.ok(poll, '准备中应启动 1.5s 轮询')
  poll.fn()
  await flush()
  assert.equal(store.getSnapshot().asr.prepare.ready, true)

  await store.cancelPrepare()
  assert.ok(requests.some(request => request.url === '/dsh-asr/api/asr/prepare-cancel' && request.method === 'POST'))
})

test('disposing the section releases timers and the preview URL', async () => {
  const { store, requests, clearedIntervals, revoked } = harness()
  store.ensureLoaded()
  await flush()
  store.setPreviewText('你好')
  await store.preview()
  const url = store.getSnapshot().tts.previewUrl
  assert.match(url, /^blob:preview-/)

  store.dispose()
  assert.equal(revoked.includes(url), true)
  assert.ok(clearedIntervals.length >= 2, 'dispose 必须清理语音包与云端轮询')
  assert.ok(requests.length > 0)
})
