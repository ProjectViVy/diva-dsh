// 注册契约：ASR 插件必须真的被"装"进 profile，而不是只躺在 plugins/ 里。
//
// 为什么单独一个测试：`plugins/asr` 有自己的单元测试（audio/store/service/http/client），
// 但那些都测不到"这个包有没有被 profile 挂上"。2026-10-31 出过一次同类事故：
// profile 里有插件、bundles 里没有 → 插件永远不加载，而所有单测都是绿的。
// 抄 laputa 的注册测试（tests/laputa-setup.test.mjs）的写法。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { componentPackages } from '../scripts/lib/component-setup.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

test('component registration includes dsh-local-asr', () => {
  const packages = componentPackages(ROOT)
  assert.deepEqual(packages.find(([name]) => name === 'dsh-local-asr'), [
    'dsh-local-asr',
    join(ROOT, 'plugins', 'asr'),
  ])
})

test('ASR 包是一个可加载的 bundle：入口、客户端与 patch 都在', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'plugins', 'asr', 'package.json'), 'utf8'))
  assert.equal(manifest.name, 'dsh-local-asr')
  assert.equal(manifest.main, './src/index.mjs')
  assert.equal(manifest.exports?.['./client'], './src/client.js')
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh?.client?.platform, 'web')
  assert.ok(existsSync(join(ROOT, 'plugins', 'asr', manifest.main)), '主入口文件必须存在')
  assert.ok(existsSync(join(ROOT, 'plugins', 'asr', manifest.exports['./client'])), '客户端入口文件必须存在')
})

test('cordis.patch.yml 里的插件 id 与包名一致（改名会在这里失败）', () => {
  const patch = readFileSync(join(ROOT, 'plugins', 'asr', 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /-\s*insert:/)
  assert.match(patch, /id:\s*dsh-local-asr/)
  assert.match(patch, /name:\s*dsh-local-asr/)
})

test('活的 profile 里同时有依赖与 bundle（缺一个插件就不加载）', t => {
  const profile = join(ROOT, '.artifacts', 'dsh-home', 'profiles', 'superagent-local', 'package.json')
  if (!existsSync(profile)) {
    t.skip('本地没有生成 profile，跳过（干净环境里正常）')
    return
  }
  const manifest = JSON.parse(readFileSync(profile, 'utf8'))
  const dependency = manifest.dependencies?.['dsh-local-asr'] ?? ''
  assert.match(dependency, /^link:/, `profile 依赖应是 link: 形式，实际 ${JSON.stringify(dependency)}`)
  const bundles = manifest.dsh?.profile?.bundles ?? []
  assert.ok(bundles.includes('dsh-local-asr'), `profile bundles 缺少 dsh-local-asr（当前 ${bundles.join('、')}）`)
})

// 下面三条是 2026-11-05 手工排查后才补的：它们都测「挂上以后还连不连得上」，
// 而前面四条只测「有没有被挂上」。面板曾因为这类不一致白屏过（前端打一个后端没注册的路径）。

test('面板前端和后端注册的路径必须完全对上（改名只改一边就会白屏）', () => {
  const http = readFileSync(join(ROOT, 'plugins', 'asr', 'src', 'http.mjs'), 'utf8')
  // 设置页迁到 voice 插件后，ASR 面板接口由 voice 的 settings 客户端调用；
  // asr 客户端只剩输入框麦克风自己的三个接口。
  const client = readFileSync(join(ROOT, 'plugins', 'asr', 'src', 'client.js'), 'utf8')
  const settings = readFileSync(join(ROOT, 'plugins', 'voice', 'src', 'client.js'), 'utf8')

  const hostPrefix = http.match(/const prefix = '([^']+)'/)?.[1]
  const clientPrefix = client.match(/const API = '([^']+)'/)?.[1]
  const settingsPrefix = settings.match(/const ASR_API = '([^']+)'/)?.[1]
  assert.equal(hostPrefix, '/dsh-asr/api', '后端前缀变了就要同步改调用方的 API 常量')
  assert.equal(clientPrefix, hostPrefix, `麦克风与后端前缀必须一致（后端 ${hostPrefix}，麦克风 ${clientPrefix}）`)
  assert.equal(settingsPrefix, hostPrefix, `设置页与后端前缀必须一致（后端 ${hostPrefix}，设置页 ${settingsPrefix}）`)

  const hostPaths = new Set([...http.matchAll(/\$\{prefix\}(\/asr\/[a-z-]+)/g)].map(m => m[1]))
  const clientPaths = new Set([...client.matchAll(/'(\/asr\/[a-z-]+)'/g)].map(m => m[1]))
  const settingsPaths = new Set([...settings.matchAll(/call\(ASR_API, '(\/asr\/[a-z-]+)'/g)].map(m => m[1]))
  assert.ok(clientPaths.size >= 3, `麦克风至少要调用 3 个 ASR 接口，实际只认到 ${clientPaths.size} 个`)
  assert.ok(settingsPaths.size >= 6, `设置页至少要调用 6 个 ASR 接口，实际只认到 ${settingsPaths.size} 个`)
  for (const path of [...clientPaths, ...settingsPaths]) {
    assert.ok(hostPaths.has(path), `前端在调 ${path}，后端却没注册这个路径（后端有：${[...hostPaths].join('、')}）`)
  }
})

test('插件入口导出契约：名字、两个必需服务、apply', async () => {
  const entry = await import(join(ROOT, 'plugins', 'asr', 'src', 'index.mjs'))
  assert.equal(entry.name, 'dsh-local-asr')
  assert.deepEqual(entry.inject, ['webServer', 'connection'], '少一个服务插件就挂不上（面板或内部通道会缺）')
  assert.equal(typeof entry.apply, 'function')
  assert.equal(entry.default?.name, entry.name, '默认导出与具名导出必须同名，否则 cordis 装载的是另一个东西')

  // 内部通道的前缀由 _shared/ipc.mjs 用 name 拼出来：/dsh-${name}/internal
  const source = readFileSync(join(ROOT, 'plugins', 'asr', 'src', 'index.mjs'), 'utf8')
  assert.match(source, /registerComponentInternal\(ctx, \{ home, name: 'asr'/, '内部通道名必须是 asr，否则外部按 /dsh-asr/internal 调会 404')
  const ipc = readFileSync(join(ROOT, 'plugins', '_shared', 'ipc.mjs'), 'utf8')
  assert.match(ipc, /const prefix = `\/dsh-\$\{name\}\/internal`/, '共享 IPC 的前缀规则变了，内部通道地址要重新核对')
})

test('活 profile 里的软链要能解析到 plugins/asr（断了就会静默不加载）', t => {
  const link = join(ROOT, '.artifacts', 'dsh-home', 'profiles', 'superagent-local', 'node_modules', 'dsh-local-asr')
  if (!existsSync(join(ROOT, '.artifacts', 'dsh-home', 'profiles', 'superagent-local', 'package.json'))) {
    t.skip('本地没有生成 profile，跳过（干净环境里正常）')
    return
  }
  assert.ok(existsSync(link), `profile 里没有 dsh-local-asr 软链：${link}`)
  assert.ok(existsSync(join(link, 'src', 'index.mjs')), '软链在、但解析不到插件入口（指向错了）')
})
