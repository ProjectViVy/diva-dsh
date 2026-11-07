import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import { ensureSurfcoreAdapter, surfcoreEnvironment } from '../scripts/lib/surfcore.mjs'
import { renderSurfcorePanelClient } from '../scripts/lib/surfcore-panel.mjs'
import { createMemoryService } from '../plugins/memory/src/service.mjs'

process.env.DSH_SUBJECT_ID ??= 'subject_00000000-0000-4000-8000-000000000001'

const root = resolve('.')

test('the audit folder button sends its action to the registered owner-audit route', async () => {
  const source = readFileSync(join(root, 'plugins/surfcore/plugins/surfcore/lib/client.js'), 'utf8')
  const client = renderSurfcorePanelClient(source, { splitComponents: true })
  const start = client.indexOf('    function AuditModal('), end = client.indexOf('    function AdminCard(', start)
  assert.ok(start > 0 && end > start)
  const requests = [], notices = []
  const render = runInNewContext(`${client.slice(start, end)}\nAuditModal`, {
    useState: value => [value, () => {}], useEffect: () => {},
    h: (type, props, ...children) => ({ type, props: props || {}, children }), Btn: 'button',
    api: async (url, options) => { requests.push({ url, options }); return { ok: false, error: '当前平台不支持' } },
  })
  const walk = node => node && typeof node === 'object' ? [node, ...(node.children || []).flat(Infinity).flatMap(walk)] : []
  const button = walk(render({ toast: value => notices.push(value) })).find(node => node.type === 'button' && node.children.includes('打开所在文件夹'))
  assert.ok(button); await button.props.onClick()
  assert.equal(requests[0].url, '/owner-audit'); assert.equal(requests[0].options.body.action, 'open')
  assert.match(notices[0], /当前平台不支持/)
})

test('audit modal reports a bridge error instead of displaying an empty log', async () => {
  const source = readFileSync(join(root, 'plugins/surfcore/plugins/surfcore/lib/client.js'), 'utf8')
  const client = renderSurfcorePanelClient(source, { splitComponents: true })
  const start = client.indexOf('    function AuditModal('), end = client.indexOf('    function AdminCard(', start)
  let cursor = 0; const states = [], effects = []
  const renderModal = runInNewContext(`${client.slice(start, end)}\nAuditModal`, {
    useState: initial => { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value }] },
    useEffect: effect => effects.push(effect), h: (type, props, ...children) => ({ type, props: props || {}, children }), Btn: 'button',
    api: async () => ({ ok: false, error: 'QQ 桥接不可用' }),
  })
  const walk = node => node && typeof node === 'object' ? [node, ...(node.children || []).flat(Infinity).flatMap(walk)] : []
  cursor = 0; renderModal({}); await effects.shift()(); await new Promise(resolve => setImmediate(resolve))
  cursor = 0; const text = walk(renderModal({})).flatMap(node => node.children.filter(value => typeof value === 'string')).join(' ')
  assert.match(text, /QQ 桥接不可用/); assert.doesNotMatch(text, /还没有记录/)
})

test('SurfCore retains optional voice selection and branch choices in one-click controls', () => {
  const source = readFileSync(join(root, 'plugins/surfcore/plugins/surfcore/lib/client.js'), 'utf8')
  const client = renderSurfcorePanelClient(source, { splitComponents: true })
  assert.match(client, /checked: launchSel\.voice/)
  assert.match(client, /voicePack: voiceBranch/)
  assert.match(client, /\["qq", "bili", "voice"\]/)
  assert.doesNotMatch(client, /checked: launchSel\.pet/)
  assert.match(client, /语音插件启动的语音包/)
})

test('a real isolated memory service keeps a capacity acknowledgement when the SurfCore panel reopens', async t => {
  const base = join(root, '.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'alert-integration-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const service = createMemoryService({ stateDir: dir })
  await service.updateSettings({ warnChars: 2000 })
  for (let i = 0; i < 20; i++) await service.action('add', { text: `测试记忆${i} ${'小猫和阳光'.repeat(30)}`, scope: 'qq' })
  assert.ok((await service.snapshot()).status.level > 0)
  const source = readFileSync(join(root, 'plugins/surfcore/plugins/surfcore/lib/client.js'), 'utf8')
  const client = renderSurfcorePanelClient(source, { splitComponents: true })
  const fetch = async (_url, options = {}) => {
    const payload = options.body ? JSON.parse(options.body) : null
    const result = payload ? await service.action(payload.action, payload) : await service.snapshot()
    return new Response(JSON.stringify(result), { status: 200 })
  }
  async function openAlert() {
    const values = [], effects = []; let cursor = 0, exported, initialRequest
    const React = {
      createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
      useState: initial => { const i = cursor++; if (!(i in values)) values[i] = initial; return [values[i], value => { values[i] = typeof value === 'function' ? value(values[i]) : value }] },
      useRef: initial => { const i = cursor++; if (!(i in values)) values[i] = { current: initial }; return values[i] },
      useEffect: effect => effects.push(effect), useCallback: fn => fn,
    }
    const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
    runInNewContext(client, { window, fetch: (...args) => { const pending = fetch(...args); if (!args[1]?.method) initialRequest = pending; return pending }, setInterval: () => 1, clearInterval: () => {} })
    const entries = []; exported.apply({ layout: { selectPanel() {} }, slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
    const entry = entries.find(item => item.options.key === 'surfcore'), panel = entry.component(entry.options.inject())
    const alert = panel.children.find(child => child && typeof child.type === 'function' && child.type !== exported.QQBIliWhaleSection)
    const render = () => { cursor = 0; return alert.type(alert.props) }
    render(); effects.splice(0).forEach(effect => effect())
    await initialRequest
    await new Promise(resolvePromise => setImmediate(resolvePromise))
    return render
  }
  const walk = node => node && typeof node === 'object' ? [node, ...(node.children || []).flat(Infinity).flatMap(walk)] : []
  const render = await openAlert()
  const confirm = walk(render()).find(node => node.children.includes('本次不再提醒'))
  assert.ok(confirm, 'a memory card above the threshold should show an alert')
  await confirm.props.onClick()
  const status = (await service.snapshot()).status
  assert.equal(status.acknowledgedLevel, status.alertLevel)
  assert.equal((await openAlert())(), null, 'reopening the panel must respect the saved acknowledgement')
})

test('SurfCore shows a memory capacity warning and routes compression to the independent memory plugin', async () => {
  const source = readFileSync(join(root, 'plugins/surfcore/plugins/surfcore/lib/client.js'), 'utf8')
  const client = renderSurfcorePanelClient(source, { splitComponents: true })
  const values = [], effects = [], requests = []; let cursor = 0, exported, selectedPanel
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: initial => { const i = cursor++; if (!(i in values)) values[i] = initial; return [values[i], value => { values[i] = typeof value === 'function' ? value(values[i]) : value }] },
    useRef: initial => { const i = cursor++; if (!(i in values)) values[i] = { current: initial }; return values[i] },
    useEffect: effect => effects.push(effect), useCallback: fn => fn,
  }
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  const fetch = async (url, options = {}) => {
    requests.push({ url, body: options.body && JSON.parse(options.body) })
    return new Response(JSON.stringify(options.method === 'POST' ? { ok: true, steps: 2 } : { ok: true, config: { enabled: true }, status: { level: 2, acknowledgedLevel: 0, percent: 90, chars: 900, maxChars: 0, warnChars: 1000, unlimited: true } }), { status: 200 })
  }
  runInNewContext(client, { window, fetch, setInterval: () => 1, clearInterval: () => {} })
  const entries = []; exported.apply({ layout: { selectPanel: id => { selectedPanel = id } }, slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const entry = entries.find(item => item.options.key === 'surfcore')
  const panel = entry.component(entry.options.inject())
  const alert = panel.children.find(child => child && typeof child.type === 'function' && child.type !== exported.QQBIliWhaleSection)
  assert.ok(alert, 'capacity alerts should be available while the SurfCore panel is open')
  const render = () => { cursor = 0; return alert.type(alert.props) }
  render(); effects.splice(0).forEach(effect => effect())
  await new Promise(resolvePromise => setImmediate(resolvePromise))
  const walk = node => node && typeof node === 'object' ? [node, ...(node.children || []).flat(Infinity).flatMap(walk)] : []
  const nodes = walk(render())
  assert.ok(nodes.some(node => node.children.includes('🧠 记忆卡快满了')))
  assert.ok(nodes.some(node => node.children.some(child => typeof child === 'string' && child.includes('900/1000'))), 'unlimited memory uses its warning threshold as the reference')
  const openMemory = nodes.find(node => node.children.includes('去记忆页看看'))
  assert.ok(openMemory, 'the warning should allow opening the memory panel')
  openMemory.props.onClick()
  assert.equal(selectedPanel, 'memory')
  const compact = nodes.find(node => node.children.includes('立即压缩到 80%'))
  assert.ok(compact)
  await compact.props.onClick()
  assert.deepEqual(requests.find(item => item.body)?.body, { action: 'compact', targetRatio: 0.8 })
  assert.equal(requests.find(item => item.body)?.url, '/dsh-memory/api/card')
  assert.equal(render(), null)
})

test('alignment scan reports Bilibili failures rather than treating them as zero results', () => {
  const source = readFileSync(join(root, 'plugins/surfcore/plugins/surfcore/lib/client.js'), 'utf8')
  const client = renderSurfcorePanelClient(source, { splitComponents: true })
  assert.match(client, /r\.bili\?\.error/)
  assert.match(client, /B站扫描未完成/)
  assert.match(client, /r\.bili\?\.unresolved/)
  assert.match(client, /未能确认正文/)
  assert.match(client, /failedSources/)
  assert.match(client, /部分来源未完成/)
})

test('the local adapter preserves the pinned source and gives qq-mode its own package', (t) => {
  const temp = join(root, '.artifacts', 'tmp')
  mkdirSync(temp, { recursive: true })
  const artifacts = mkdtempSync(join(temp, 'adapter-test-'))
  t.after(() => rmSync(artifacts, { recursive: true, force: true }))
  const upstream = join(root, 'plugins', 'surfcore', 'plugins', 'surfcore')
  const original = readFileSync(join(upstream, 'cordis.patch.yml'), 'utf8')
  const { bundle, qqMode } = ensureSurfcoreAdapter(root, artifacts)
  assert.equal(realpathSync(join(bundle, 'lib')), realpathSync(join(upstream, 'lib')))
  assert.match(readFileSync(join(bundle, 'cordis.patch.yml'), 'utf8'), /name: surfcore-local-qq-mode/)
  assert.equal(readFileSync(join(upstream, 'cordis.patch.yml'), 'utf8'), original)
  assert.equal(JSON.parse(readFileSync(join(qqMode, 'package.json'))).name, 'surfcore-local-qq-mode')
  assert.deepEqual(ensureSurfcoreAdapter(root, artifacts), { bundle, qqMode })
})

test('a moved project can rebuild its own SurfCore adapter links', t => {
  const parent = join(root, '.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const temp = mkdtempSync(join(parent, 'adapter-move-')); t.after(() => rmSync(temp, { recursive: true, force: true }))
  const originalRoot = join(temp, 'old'), movedRoot = join(temp, 'new'), original = join(originalRoot, 'plugins/surfcore/plugins/surfcore')
  mkdirSync(join(originalRoot, 'plugins/surfcore/plugins'), { recursive: true })
  cpSync(join(root, 'plugins/surfcore/plugins/surfcore'), original, { recursive: true })
  cpSync(join(root, 'plugins/surfcore/src'), join(originalRoot, 'plugins/surfcore/src'), { recursive: true })
  ensureSurfcoreAdapter(originalRoot, undefined, { splitComponents: true })
  const legacyLink = join(originalRoot, '.artifacts/surfcore-adapter/bundle/lib')
  unlinkSync(legacyLink); symlinkSync(join(original, 'lib'), legacyLink, process.platform === 'win32' ? 'junction' : 'dir')
  renameSync(originalRoot, movedRoot)
  const { bundle, qqMode } = ensureSurfcoreAdapter(movedRoot, undefined, { splitComponents: true })
  assert.equal(realpathSync(join(bundle, 'lib')), realpathSync(join(movedRoot, 'plugins/surfcore/plugins/surfcore/lib')))
  assert.match(readFileSync(join(qqMode, 'index.mjs'), 'utf8'), new RegExp(pathToFileURL(join(movedRoot, 'plugins/surfcore/plugins/surfcore/lib/qq-mode.js')).href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.ok(existsSync(join(movedRoot, '.artifacts/surfcore-adapter/patches/patched-manifest.json')))
})

test('the runtime redirects SurfCore Bilibili paths to DSH_HOME in child Node processes', () => {
  const projectHome = join(root, '.artifacts', 'tmp', 'surfcore-test-home')
  const source = pathToFileURL(join(root, 'plugins', 'surfcore', 'src', 'bili-api.js')).href
  const program = `import {resolveBiliPaths} from ${JSON.stringify(source)}; console.log(JSON.stringify(resolveBiliPaths()))`
  const env = { ...surfcoreEnvironment(root, process.env), DSH_HOME: projectHome }
  const paths = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', program], { env, encoding: 'utf8' }))
  assert.equal(paths.config, join(projectHome, 'surfcore', 'bili.config.json'))
  assert.equal(paths.credentials, join(projectHome, 'surfcore', 'bili', 'credentials.json'))
  assert.equal(env.HOME, process.env.HOME)
  assert.equal(env.SURFCORE_SKIP_AUTOSTART, '1')
  assert.equal(env.SURFCORE_DISABLE_CHARACTER_MIGRATION, '1')
  assert.equal(env.SURFCORE_DISABLE_MEMORY_TIMER, '1')
})

test('the split loader makes Bilibili tools use the independent memory data', () => {
  const home = join(root, '.artifacts', 'tmp', 'split-loader-home')
  const modulePath = join(root, 'plugins/surfcore/plugins/surfcore/tools/lib/state-paths.mjs')
  const loader = join(root, 'scripts/surfcore-loader.mjs')
  const script = `import * as p from ${JSON.stringify(pathToFileURL(modulePath).href)}; console.log(JSON.stringify([p.currentCharacter(), p.biliState('bili-memory.json'), p.biliState('scores.json')]))`
  const output = execFileSync(process.execPath, ['--import', pathToFileURL(loader).href, '--input-type=module', '-e', script], {
    env: { ...process.env, DSH_HOME: home, SURFCORE_LOCAL_SOURCE: join(root, 'plugins/surfcore'), SURFCORE_COMPONENT_SPLIT: '1' }, encoding: 'utf8',
  })
  assert.deepEqual(JSON.parse(output), [null, join(home, 'memory/data/bili-memory.json'), join(home, 'surfcore/bili/scores.json')])
})

test('Bilibili video tools write default artifacts inside project DSH_HOME', t => {
  const parent = join(root, '.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const temp = mkdtempSync(join(parent, 'bili-output-paths-')); t.after(() => rmSync(temp, { recursive: true, force: true }))
  const fakeHome = join(temp, 'fake-home'), dshHome = join(temp, 'project-home'), dataDir = join(dshHome, 'surfcore/bili')
  mkdirSync(fakeHome, { recursive: true }); mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(dataDir, 'credentials.json'), '{"sessdata":"fixture","bili_jct":"fixture","buvid3":"fixture"}')
  const mockFile = join(temp, 'fetch-mock.mjs')
  writeFileSync(mockFile, `globalThis.fetch = async input => {
    const u = String(input), json = value => new Response(JSON.stringify(value), { status: 200 });
    if (u.includes('/nav')) return json({ data: { wbi_img: { img_url: 'https://fixture.invalid/a.png', sub_url: 'https://fixture.invalid/b.png' } } });
    if (u.includes('/web-interface/view')) return json(process.env.TEST_BILI_CASE === 'debrief' ? { code: 1, message: 'fixture stop' } : { code: 0, data: { aid: 1, cid: 2, title: 'fixture', duration: 60, owner: { name: 'fixture' } } });
    if (u.includes('/player/playurl')) return json({ data: { quality: 64, durl: [{ url: 'https://fixture.invalid/video' }] } });
    if (u.includes('/player/wbi/v2')) return json({ data: { subtitle: { subtitles: [{ lan: 'zh-CN', subtitle_url: 'https://fixture.invalid/subtitle' }] } } });
    if (u === 'https://fixture.invalid/subtitle') return json({ body: [{ from: 0, to: 1, content: 'fixture' }] });
    throw new Error('fixture stop');
  };`)
  const env = surfcoreEnvironment(root, { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, DSH_HOME: dshHome, FFMPEG: process.execPath }, { splitComponents: true })
  env.SURFCORE_BILI_CONFIG = join(dshHome, 'surfcore/bili.config.json')
  const commands = join(root, 'plugins/surfcore/plugins/surfcore/tools/commands')
  function run(name, args, fixture) {
    return spawnSync(process.execPath, ['--import', pathToFileURL(mockFile).href, join(commands, name), ...args], { env: { ...env, TEST_BILI_CASE: fixture }, encoding: 'utf8' })
  }
  assert.equal(run('debrief.mjs', ['BV1234567890', '--no-frames'], 'debrief').status, 3)
  assert.equal(run('bili-watch.mjs', ['BV1234567890'], 'watch').status, 1)
  const subtitles = run('subtitles.mjs', ['BV1234567890'], 'subtitles')
  assert.equal(subtitles.status, 0, subtitles.stderr)
  assert.ok(existsSync(join(dshHome, 'shots/covers')))
  assert.ok(existsSync(join(dshHome, 'shots/video')))
  assert.ok(existsSync(join(dshHome, 'shots/subs/BV1234567890-zh-CN.txt')))
  assert.equal(existsSync(join(fakeHome, '.dsh')), false)
  const custom = join(temp, 'custom-subtitles')
  assert.equal(run('subtitles.mjs', ['BV1234567890', '--out', custom], 'subtitles').status, 0)
  assert.ok(existsSync(join(custom, 'BV1234567890-zh-CN.txt')))
  const customVideo = join(temp, 'custom-video')
  assert.equal(run('bili-watch.mjs', ['BV1234567890', '3x3', customVideo], 'watch').status, 1)
  assert.ok(existsSync(customVideo))
})

test('Bilibili night planning honors zero limits and appends events to the local diary log', t => {
  const parent = join(root, '.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const temp = mkdtempSync(join(parent, 'bili-night-plan-')); t.after(() => rmSync(temp, { recursive: true, force: true }))
  const fakeHome = join(temp, 'fake-home'), dshHome = join(temp, 'project-home'), data = join(dshHome, 'surfcore/bili')
  mkdirSync(fakeHome, { recursive: true }); mkdirSync(data, { recursive: true })
  const config = join(data, 'whale-night.config.json'), state = join(data, 'whale-night.json'), log = join(data, 'whale-log.jsonl')
  const env = surfcoreEnvironment(root, { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, DSH_HOME: dshHome }, { splitComponents: true })
  env.SURFCORE_BILI_CONFIG = join(dshHome, 'surfcore/bili.config.json')
  const commands = join(root, 'plugins/surfcore/plugins/surfcore/tools/commands')
  const run = (name, args) => spawnSync(process.execPath, [join(commands, name), ...args], { env, encoding: 'utf8' })
  writeFileSync(config, JSON.stringify({ maxWakesPerDay: 0, minGapMin: 0, windows: [{ start: '00:00', end: '24:00', wakes: 1 }] }))
  const disabled = run('whale-night.mjs', ['plan'])
  assert.equal(disabled.status, 0, disabled.stderr)
  assert.equal(JSON.parse(disabled.stdout).action, 'done')
  assert.match(JSON.parse(disabled.stdout).reason, /maxWakesPerDay=0/)
  assert.equal(JSON.parse(readFileSync(log, 'utf8').trim()).kind, 'night-plan')
  writeFileSync(config, JSON.stringify({ maxWakesPerDay: 1, minGapMin: 0, windows: [{ start: '00:00', end: '24:00', wakes: 1 }] }))
  rmSync(state)
  const enabled = run('whale-night.mjs', ['plan'])
  assert.equal(enabled.status, 0, enabled.stderr)
  assert.equal(JSON.parse(enabled.stdout).minGapMin, 0)
  const diary = run('diary.mjs', ['log', 'night-skip', '--note', 'fixture'])
  assert.equal(diary.status, 0, diary.stderr)
  const records = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(records.map(record => record.kind), ['night-plan', 'night-plan', 'night-skip'])
  rmSync(log); mkdirSync(log)
  const failure = run('whale-night.mjs', ['plan'])
  assert.equal(failure.status, 0, failure.stderr)
  assert.match(failure.stderr, /生物钟事件写入失败/)
  assert.equal(JSON.parse(failure.stdout).minGapMin, 0)
  assert.equal(existsSync(join(fakeHome, '.dsh')), false)
})

test('Bilibili selftest reads the project configuration and fails when dependency checks fail', t => {
  const parent = join(root, '.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const temp = mkdtempSync(join(parent, 'bili-selftest-')); t.after(() => rmSync(temp, { recursive: true, force: true }))
  const home = join(temp, 'fake-home'), dshHome = join(temp, 'project-home'), data = join(dshHome, 'surfcore/bili')
  mkdirSync(home, { recursive: true }); mkdirSync(data, { recursive: true })
  const config = join(dshHome, 'surfcore/bili.config.json')
  writeFileSync(config, JSON.stringify({ self: { mid: '1234', name: 'fixture' }, owner: { mid: '4567', name: 'owner' }, share: { via: 'dynamic' }, notify: { type: 'none' } }))
  writeFileSync(join(data, 'credentials.json'), '{"sessdata":"fixture","bili_jct":"fixture","buvid3":"fixture"}')
  const stub = join(temp, 'selftest-stub.mjs')
  writeFileSync(stub, `import cp from 'node:child_process'; import { syncBuiltinESMExports } from 'node:module';
    cp.execFileSync = (_node, args) => { if (args.includes('session')) return '账号 : fixture\\nmid : 1234'; if (process.env.TEST_DEPS_FAIL === '1') throw new Error('fixture deps failed'); return '✓ fixture deps'; }; syncBuiltinESMExports();`)
  const env = surfcoreEnvironment(root, { ...process.env, HOME: home, USERPROFILE: home, DSH_HOME: dshHome }, { splitComponents: true })
  env.SURFCORE_BILI_CONFIG = config
  const script = join(root, 'plugins/surfcore/plugins/surfcore/tools/commands/selftest.mjs'), marker = join(data, 'selftest-passed.json')
  const run = failed => spawnSync(process.execPath, ['--import', pathToFileURL(stub).href, script], { env: { ...env, TEST_DEPS_FAIL: failed ? '1' : '0' }, encoding: 'utf8' })
  const bad = run(true)
  assert.equal(bad.status, 1)
  assert.match(bad.stdout, /✓ 配置文件/)
  assert.match(bad.stdout, /✗ 依赖体检/)
  assert.equal(existsSync(marker), false)
  const good = run(false)
  assert.equal(good.status, 0, good.stdout + good.stderr)
  assert.match(good.stdout, /✓ 配置文件/)
  assert.ok(existsSync(marker))
  assert.doesNotMatch(good.stdout, /当前角色目录/)
  const laterFailure = run(true)
  assert.equal(laterFailure.status, 1)
  assert.equal(existsSync(marker), false, 'a failed selftest must invalidate an earlier success marker')
  assert.equal(existsSync(join(home, '.dsh')), false)
})

test('Bilibili dependency probe preserves existing files and cleans up its own temporary directory', t => {
  const parent = join(root, '.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const temp = mkdtempSync(join(parent, 'bili-deps-probe-')); t.after(() => rmSync(temp, { recursive: true, force: true }))
  const fakeHome = join(temp, 'fake-home'), dshHome = join(temp, 'project-home'), data = join(dshHome, 'surfcore/bili')
  mkdirSync(fakeHome, { recursive: true }); mkdirSync(data, { recursive: true })
  const existing = join(data, '.write-probe'); writeFileSync(existing, '用户原有文件')
  writeFileSync(join(data, 'credentials.json'), '{"sessdata":"fixture","bili_jct":"fixture","buvid3":"fixture"}')
  const stub = join(temp, 'deps-stub.mjs')
  writeFileSync(stub, `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
    globalThis.fetch = async () => new Response(JSON.stringify({code:0,data:{isLogin:true,uname:'fixture',mid:1234}}), {status:200});
    const write = fs.writeFileSync; fs.writeFileSync = function(file,...args) { if (process.env.TEST_FAIL_PROBE === '1' && String(file).includes('.write-probe-')) throw new Error('fixture write failed'); return write.call(this,file,...args); }; syncBuiltinESMExports();`)
  const env = surfcoreEnvironment(root, { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, LOCALAPPDATA: fakeHome, DSH_HOME: dshHome, FFMPEG: '', PATH: '' }, { splitComponents: true })
  env.SURFCORE_BILI_CONFIG = join(dshHome, 'surfcore/bili.config.json')
  const command = join(root, 'plugins/surfcore/plugins/surfcore/tools/commands/deps.mjs')
  const run = fail => spawnSync(process.execPath, ['--import', pathToFileURL(stub).href, command, '--json'], { env: { ...env, TEST_FAIL_PROBE: fail ? '1' : '0' }, encoding: 'utf8' })
  const good = run(false), dataCheck = JSON.parse(good.stdout).items.find(item => item.name === '数据目录可写')
  assert.equal(dataCheck.ok, true)
  assert.equal(readFileSync(existing, 'utf8'), '用户原有文件')
  assert.equal(readdirSync(data).some(name => name.startsWith('.write-probe-')), false)
  const ffmpeg = JSON.parse(good.stdout).items.find(item => item.name.startsWith('ffmpeg'))
  assert.doesNotMatch(ffmpeg.fix, /winget|scoop|brew|~\/\.dsh/)
  const ffmpegModule = pathToFileURL(join(root, 'plugins/surfcore/plugins/surfcore/tools/lib/ffmpeg.mjs')).href
  const check = spawnSync(process.execPath, ['--input-type=module', '-e', `import { requireFfmpeg } from ${JSON.stringify(ffmpegModule)}; try { requireFfmpeg(); process.stdout.write('available'); } catch (e) { process.stdout.write(e.message); }`], { env, encoding: 'utf8' })
  assert.equal(check.status, 0, check.stderr)
  if (check.stdout !== 'available') { assert.match(check.stdout, /项目内/); assert.doesNotMatch(check.stdout, /winget|scoop|brew/) }
  const bad = run(true), failedCheck = JSON.parse(bad.stdout).items.find(item => item.name === '数据目录可写')
  assert.equal(failedCheck.ok, false)
  assert.equal(readFileSync(existing, 'utf8'), '用户原有文件')
  assert.equal(readdirSync(data).some(name => name.startsWith('.write-probe-')), false)
})

test('the adapter refuses to write through a directory symlink outside the project', (t) => {
  const temp = join(root, '.artifacts', 'tmp')
  mkdirSync(temp, { recursive: true })
  const artifacts = mkdtempSync(join(temp, 'adapter-escape-'))
  t.after(() => rmSync(artifacts, { recursive: true, force: true }))
  symlinkSync(resolve(root, '..'), join(artifacts, 'bundle'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => ensureSurfcoreAdapter(root, artifacts), /outside the project/)
})

test('SurfCore contributes a sidebar panel that renders the existing console', (t) => {
  const temp = join(root, '.artifacts', 'tmp')
  mkdirSync(temp, { recursive: true })
  const artifacts = mkdtempSync(join(temp, 'adapter-panel-'))
  t.after(() => rmSync(artifacts, { recursive: true, force: true }))
  const { bundle } = ensureSurfcoreAdapter(root, artifacts)
  const manifest = JSON.parse(readFileSync(join(bundle, 'package.json'), 'utf8'))
  assert.equal(manifest.exports['.'], './surfcore-host.mjs', 'DSH must resolve the adapter manifest for the host entry')
  assert.equal(manifest.main, './surfcore-host.mjs')
  const consumer = join(artifacts, 'consumer')
  mkdirSync(join(consumer, 'node_modules'), { recursive: true })
  symlinkSync(bundle, join(consumer, 'node_modules', 'surfcore'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal(createRequire(join(consumer, 'package.json')).resolve('surfcore'), join(bundle, 'surfcore-host.mjs'))
  const client = readFileSync(join(bundle, manifest.exports['./client']), 'utf8')
  const React = { createElement: (type, props, ...children) => ({ type, props, children }) }
  let exported
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  runInNewContext(client, { window })
  const registrations = []
  const ctx = {
    effect: fn => fn(),
    slots: {
      inject: (_slot, register) => register(),
      register: (options, component) => { registrations.push({ options, component }); return () => {} },
    },
  }
  exported.apply(ctx)
  const main = registrations.find(({ options }) => options.name === 'main' && options.key === 'surfcore')
  const sidebar = registrations.find(({ options }) => options.name === 'sidebar.panellist' && options.id === 'surfcore')
  assert.ok(main, 'SurfCore should register a main panel')
  assert.ok(sidebar, 'SurfCore should register a sidebar item')
  assert.equal(sidebar.options.label(), 'SurfCore')
  assert.equal(main.component().children[0].type, exported.QQBIliWhaleSection)
  assert.equal(registrations.some(({ options }) => options.name === 'settings.section'), false)
})

test('the existing unmodified adapter upgrades without overwriting a custom manifest', (t) => {
  const temp = join(root, '.artifacts', 'tmp')
  mkdirSync(temp, { recursive: true })
  const artifacts = mkdtempSync(join(temp, 'adapter-upgrade-'))
  t.after(() => rmSync(artifacts, { recursive: true, force: true }))
  const bundle = join(artifacts, 'bundle')
  const packageFile = join(bundle, 'package.json')
  const original = join(root, 'plugins', 'surfcore', 'plugins', 'surfcore', 'package.json')
  mkdirSync(bundle)
  writeFileSync(packageFile, readFileSync(original))
  ensureSurfcoreAdapter(root, artifacts)
  const oldPanel = JSON.parse(readFileSync(packageFile, 'utf8'))
  assert.equal(oldPanel.exports['./client'], './surfcore-panel.client.js')
  oldPanel.main = './lib/index.js'
  oldPanel.exports['.'] = './lib/index.js'
  writeFileSync(packageFile, `${JSON.stringify(oldPanel, null, 2)}\n`)
  ensureSurfcoreAdapter(root, artifacts)
  assert.equal(JSON.parse(readFileSync(packageFile, 'utf8')).main, './surfcore-host.mjs')
  writeFileSync(packageFile, '{"custom":true}\n')
  assert.throws(() => ensureSurfcoreAdapter(root, artifacts), /Refusing to overwrite/)
  assert.equal(readFileSync(packageFile, 'utf8'), '{"custom":true}\n')
})

test('the panel adapter accepts a CRLF checkout and rejects an incompatible client', () => {
  const client = readFileSync(join(root, 'plugins', 'surfcore', 'plugins', 'surfcore', 'lib', 'client.js'), 'utf8')
  const crlf = client.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n')
  assert.match(renderSurfcorePanelClient(crlf), /sidebar\.panellist/)
  assert.throws(() => renderSurfcorePanelClient('unexpected client'), /no longer matches/)
})

test('the SurfCore panel no longer offers role and desktop pet tabs', () => {
  const source = readFileSync(join(root, 'plugins', 'surfcore', 'plugins', 'surfcore', 'lib', 'client.js'), 'utf8')
  const client = renderSurfcorePanelClient(source)
  const tabs = client.match(/const TABS = \[([\s\S]*?)\];/)?.[1]
  assert.ok(tabs)
  assert.doesNotMatch(tabs, /\["(?:characters|pet)",/)
  assert.match(tabs, /\["qq",/)
  assert.match(tabs, /\["bili",/)
})

test('the split SurfCore client removes the moved panels and old component requests', () => {
  const source = readFileSync(join(root, 'plugins', 'surfcore', 'plugins', 'surfcore', 'lib', 'client.js'), 'utf8')
  const client = renderSurfcorePanelClient(source, { splitComponents: true })
  const tabs = client.match(/const TABS = \[([\s\S]*?)\];/)?.[1]
  for (const id of ['characters', 'pet', 'voice', 'memory']) assert.doesNotMatch(tabs, new RegExp(`\\["${id}",`))
  for (const fragment of ['function CharactersTab(', 'function PetTab(', 'function VoiceTab(', 'function MemoryTab(', 'api("/memory-card"', 'api("/pet/']) assert.equal(client.includes(fragment), false, fragment)
  const temp = join(root, '.artifacts', 'tmp'); mkdirSync(temp, { recursive: true })
  const dir = mkdtempSync(join(temp, 'split-client-'))
  try {
    const file = join(dir, 'client.js'); writeFileSync(file, client)
    execFileSync(process.execPath, ['--check', file])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('split SurfCore guidance does not describe removed role and pet features', () => {
  const source = readFileSync(join(root, 'plugins', 'surfcore', 'plugins', 'surfcore', 'lib', 'client.js'), 'utf8')
  const client = renderSurfcorePanelClient(source, { splitComponents: true })
  for (const obsolete of ['重启/换角色后第一枪的起跑延迟', '人格卡仍然认得出同一个人', '优先于群名片 / B站昵称 / 人格卡称呼表', 'status.carrier === "pet" ? "载体：桌宠"']) {
    assert.ok(!client.includes(obsolete), obsolete)
  }
  assert.ok(client.includes('重启后的首次主动搭话延迟'))
})

test('the split SurfCore budget shortcuts render for both currency and tokens', () => {
  const source = readFileSync(join(root, 'plugins', 'surfcore', 'plugins', 'surfcore', 'lib', 'client.js'), 'utf8')
  const client = renderSurfcorePanelClient(source, { splitComponents: true })
  const declarations = (client.match(/    const (?:CNY|TOKEN)_CHIPS = \[[^\n]+/g) || []).join('\n')
  const component = client.match(/    function BudgetChips\([\s\S]*?\n    }(?=\n\n    function BudgetMeter)/)?.[0]
  assert.ok(component)
  const context = { h: (tag, props, children) => ({ tag, props, children }) }
  const render = runInNewContext(`${declarations}\n${component}\nBudgetChips`, context)
  assert.equal(render({ unit: 'cny' }).children.length, 4)
  assert.equal(render({ unit: 'tokens' }).children.length, 4)
})

test('the split QQ purpose panel preserves advanced settings and shows the generated preview', async () => {
  const source = readFileSync(join(root, 'plugins', 'surfcore', 'plugins', 'surfcore', 'lib', 'client.js'), 'utf8')
  const client = renderSurfcorePanelClient(source, { splitComponents: true })
  const component = client.match(/    function PurposeCard\([\s\S]*?\n    }(?=\n\n)/)?.[0]
  assert.ok(component, 'the QQ purpose card must be retained')
  const state = []; let cursor = 0
  const context = {
    useState: initial => { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value }] },
    useEffect: () => {},
    h: (type, props, ...children) => ({ type, props: props || {}, children }),
    Row: 'row', Btn: 'button', confirm: () => false,
    api: async () => ({ ok: true, selected: { text: '预览目的' }, materials: [{ text: '素材' }], prompt: '预览提示词' }),
  }
  const render = runInNewContext(`${component}\nPurposeCard`, context)
  const props = { cfg: {}, set: () => {}, busy: false, setBusy: () => {}, toast: () => {}, carrier: 'qq' }
  const tree = () => { cursor = 0; return render(props) }
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  let nodes = walk(tree())
  for (const label of ['安静时段', '你空闲多久才打扰（分钟）', '翻多久以内的 QQ 记忆（小时）', '失败后多久重试（分钟）', '找哪个 QQ（留空 = ownerQQ）']) {
    assert.ok(nodes.some(node => node.props.label === label), label)
  }
  const preview = nodes.find(node => node.type === 'button' && node.children.includes('预览这一轮（不发）'))
  assert.ok(preview)
  await preview.props.onClick()
  nodes = walk(tree())
  assert.ok(nodes.some(node => node.type === 'textarea' && node.props.value === '预览提示词'))
})

test('adapter writes the split panel only when component cutover is enabled', (t) => {
  const temp = join(root, '.artifacts', 'tmp'); mkdirSync(temp, { recursive: true })
  const artifacts = mkdtempSync(join(temp, 'split-adapter-'))
  t.after(() => rmSync(artifacts, { recursive: true, force: true }))
  const { bundle } = ensureSurfcoreAdapter(root, artifacts, { splitComponents: true })
  const client = readFileSync(join(bundle, 'surfcore-panel.client.js'), 'utf8')
  assert.doesNotMatch(client, /function VoiceTab\(/)
  assert.doesNotMatch(client, /function MemoryTab\(/)
})

test('component cutover flag is limited to the spawned process environment', () => {
  const parent = { PATH: process.env.PATH }
  const env = surfcoreEnvironment(root, parent, { splitComponents: true })
  assert.equal(env.SURFCORE_COMPONENT_SPLIT, '1')
  assert.equal(parent.SURFCORE_COMPONENT_SPLIT, undefined)
})
