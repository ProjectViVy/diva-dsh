#!/usr/bin/env node
// 用户自定义插件的源码级安装（第三档，前两档是 plugins/ 与 third-party/）。
//
// 一个插件就是 `user-plugins/<name>/` 下的一个包目录；它不钉 tag、不是 submodule、
// 不进 `componentPackages()`、不进 `npm test`、不被根仓库跟踪。安装方式与另外两档
// 相同：profile 记一条 `link:<绝对路径>` 依赖 + 一个 bundle 名，源码始终留在磁盘上。
// 规则正文（最小包结构、边界、故障处理）见 `user-plugins/README.md`。
//
//   npm run setup:user-plugins                 # 构建缺的产物、注册缺的、清理失效 link（面板须停）
//   npm run setup:user-plugins -- --check      # 只读报告，面板运行中也能跑
//   npm run setup:user-plugins -- --remove <名字>   # 注销一个本档插件（源码保留）
//   npm run setup:user-plugins -- --dir <绝对路径>  # 换一个档位目录（默认仓库内 user-plugins/）
//
// 只经由 DSH 的公开接口（`dsh plugin add/remove`）改 profile，不手改 profile 清单。
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ARTIFACTS, PROFILE, ROOT, processes, profileDir, state } from './lib/vivy.mjs'
import { localEnvironment, sourceRuntimeInvocation } from './lib/source.mjs'
import { inspectComponents } from './lib/component-setup.mjs'
import {
  DEFAULT_USER_PLUGINS_DIR, inspectUserPlugin, pruneNames, readManifest, scanUserPlugins,
} from './lib/user-plugins.mjs'

/** 项目内的 pnpm；`npm run setup` 会把它装进 .artifacts/tools。 */
const pnpm = join(ARTIFACTS, 'tools', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')

function step(message) {
  console.log(`\n== ${message}`)
}

function parseArgs(argv) {
  const options = { check: false, remove: undefined, dir: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--check') options.check = true
    else if (arg === '--remove') {
      const name = argv[index + 1]
      if (name === undefined || name.startsWith('--')) throw new Error('--remove 需要一个插件名')
      options.remove = name
      index += 1
    } else if (arg === '--dir') {
      const dir = argv[index + 1]
      if (dir === undefined || dir.startsWith('--')) throw new Error('--dir 需要一个目录')
      options.dir = dir
      index += 1
    } else throw new Error(`未知参数：${arg}`)
  }
  if (options.check && options.remove !== undefined) throw new Error('--check 与 --remove 不能同时使用')
  return options
}

/** 用本部署的 DSH CLI 改 profile，复用启动器的源码启动环境。 */
function dsh(args) {
  const invocation = sourceRuntimeInvocation(ROOT, args)
  const result = spawnSync(process.execPath, invocation.args, {
    cwd: invocation.cwd,
    env: { ...invocation.env, CI: 'true' },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`dsh ${args.join(' ')} 退出码 ${result.status ?? result.signal}`)
}

function runIn(directory, args, env) {
  console.log(`$ pnpm ${args.join(' ')}`)
  const result = spawnSync(process.execPath, [pnpm, ...args], { cwd: directory, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`pnpm ${args.join(' ')} 退出码 ${result.status ?? result.signal}`)
}

/** 读 profile 清单；没初始化时给一条能照着做的提示，而不是让 pnpm 报原始错误。 */
function profileManifest(profile) {
  const file = join(profile, 'package.json')
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new Error(`profile 还没初始化（${file}）；先跑一次 npm run setup`)
  }
}

/** 面板活着时改 profile 会打架；所有写操作都要求先停。 */
async function requireStopped() {
  if (processes().length || (await state()) !== undefined) {
    throw new Error('先停面板：npm run stop（注册会改 profile 并跑 pnpm）')
  }
}

function describe(item) {
  const label = item.problems.length ? '拒绝' : item.needsBuild ? '待构建' : '就绪'
  console.log(`  ${item.name || item.dirName}  [${label}]  ${item.dir}`)
  for (const problem of item.problems) console.log(`    ${problem}`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const userDir = resolve(ROOT, options.dir ?? DEFAULT_USER_PLUGINS_DIR)
  const profile = profileDir()
  const manifest = profileManifest(profile)
  const dependencies = manifest.dependencies ?? {}

  const entries = scanUserPlugins(userDir)
  const inspected = entries.map(entry => inspectUserPlugin(entry, { profileDependencies: dependencies, profileDir: profile }))
  const ready = inspected.filter(item => item.problems.length === 0)
  const broken = inspected.filter(item => item.problems.length > 0)
  const registration = () => ready.length
    ? inspectComponents(profile, ready.map(item => [item.name, item.dir])).missing
    : []
  const staleLinks = () => pruneNames(manifest, { profileDir: profile, userDir })

  if (options.check) {
    step(`用户插件（第三档源码级）：${userDir}`)
    if (!entries.length) console.log('  （空档位。放一个 user-plugins/<name>/ 进去，结构见 user-plugins/README.md）')
    for (const item of inspected) describe(item)
    let failed = broken.length > 0
    for (const [name] of registration()) {
      failed = true
      console.log(`  ${name}: 未注册 —— npm run stop && npm run setup:user-plugins`)
    }
    for (const name of staleLinks()) {
      failed = true
      console.log(`  ${name}: 残留 link，源码目录已不在 —— --sync 会清理`)
    }
    if (!failed) console.log(entries.length ? '  全部就绪。' : '  空档位，无操作。')
    process.exit(failed ? 1 : 0)
  }

  await requireStopped()
  if (broken.length) throw new Error(`有 ${broken.length} 个插件不满足安装规则，先按上面的提示修好`)

  if (options.remove !== undefined) {
    const item = inspected.find(entry => entry.dirName === options.remove || entry.name === options.remove)
    const name = item?.name ?? options.remove
    const owned = item !== undefined || staleLinks().includes(name)
    if (!owned) throw new Error(`${options.remove} 不是 user-plugins 里的插件；本脚本只注销本档的 link`)
    step(`注销 ${name}`)
    dsh(['plugin', '--profile', PROFILE, 'remove', name])
    console.log(`\n已注销 ${name}。源码留在 ${userDir} 下，没有删除。`)
    return
  }

  const toBuild = ready.filter(item => item.needsBuild)
  if (toBuild.length && !existsSync(pnpm)) throw new Error('项目内的 pnpm 还没装好；先跑一次 npm run setup')
  const env = { ...localEnvironment(ROOT), CI: 'true' }
  for (const item of toBuild) {
    step(`构建 ${item.name}`)
    const frozen = existsSync(join(item.dir, 'pnpm-lock.yaml'))
    runIn(item.dir, ['install', ...(frozen ? ['--frozen-lockfile'] : []), '--reporter=append-only'], env)
    runIn(item.dir, ['run', 'build'], env)
    const after = inspectUserPlugin(
      { dirName: item.dirName, dir: item.dir, manifest: readManifest(item.dir) },
      { profileDependencies: dependencies, profileDir: profile },
    )
    if (after.problems.length) throw new Error(`${item.name} 构建后仍不可用：${after.problems.join('；')}`)
  }

  for (const item of ready) {
    if (inspectComponents(profile, [[item.name, item.dir]]).missing.length === 0) continue
    step(`注册 ${item.name}`)
    dsh(['plugin', '--profile', PROFILE, 'add', `link:${item.dir}`])
  }

  for (const name of staleLinks()) {
    step(`清理残留 link ${name}`)
    dsh(['plugin', '--profile', PROFILE, 'remove', name])
  }

  const pending = registration()
  if (pending.length) throw new Error(`注册不完整：${pending.map(([name]) => name).join(', ')}`)
  const leftover = pruneNames(profileManifest(profile), { profileDir: profile, userDir })
  if (leftover.length) throw new Error(`仍有失效 link 未清理：${leftover.join(', ')}`)
  console.log(ready.length
    ? `\nuser-plugins 就绪：${ready.map(item => item.name).join(', ')}。npm start 后生效。`
    : '\n空档位，无操作。')
}

main().catch(error => {
  console.error(`\nsetup-user-plugins: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
