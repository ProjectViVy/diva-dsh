// 用户自定义插件（第三档源码级安装）：`user-plugins/<name>/` 下每个子目录是一个
// 插件包，和 `plugins/`、`third-party/` 一样走 `dsh plugin add link:<目录>` ——
// 源码留在磁盘上，profile 只记一条 link 依赖与一个 bundle 名。
//
// 它刻意与前两档不同：不钉 tag、不是 submodule、不登记进 `componentPackages()`、
// 不被根仓库跟踪（`.gitignore` 排除，只留本目录的 README）、也不进 `npm test`。
// 规则正文见 `user-plugins/README.md`；写入与注册在 `scripts/setup-user-plugins.mjs`。
//
// 只读：这里不写文件、不调用 pnpm 或 dsh。
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

/** 默认档位目录（相对仓库根）。`--dir` 可以把它指到仓库外。 */
export const DEFAULT_USER_PLUGINS_DIR = 'user-plugins'

/** npm 包名：小写、URL 安全，可带 scope，不允许前导点或下划线。 */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/

/**
 * 读一个包的清单；不是常规文件、读不出 JSON 都返回 undefined，由调用方报错。
 * @param {string} dir 包目录。
 * @returns {object | undefined}
 */
export function readManifest(dir) {
  const file = join(dir, 'package.json')
  let text
  try {
    if (!lstatSync(file).isFile()) return undefined
    text = readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * 扫描档位目录的一层子目录。目录不存在返回空数组（不创建、不报错）；
 * 以 `.` 或 `_` 开头的名字留给草稿与临时目录，不当作插件。
 * @param {string} userDir 档位目录。
 * @returns {Array<{ dirName: string, dir: string, manifest: object | undefined }>}
 */
export function scanUserPlugins(userDir) {
  if (!existsSync(userDir)) return []
  return readdirSync(userDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_'))
    .filter(entry => existsSync(join(userDir, entry.name, 'package.json')))
    .map(entry => entry.name)
    .sort()
    .map(dirName => {
      const dir = join(userDir, dirName)
      return { dirName, dir, manifest: readManifest(dir) }
    })
}

/**
 * 包入口的候选路径：`main`、`exports["."]`，再退到常见的 `lib/index.js` / `index.js`。
 * DSH 的 bundle patch 按包名解析入口，所以判断存在性要对齐 Node 的解析顺序。
 * @param {object} manifest 包清单。
 * @returns {string[]} 去重后的相对路径。
 */
export function entryCandidates(manifest) {
  const candidates = []
  if (typeof manifest?.main === 'string' && manifest.main.trim() !== '') candidates.push(manifest.main)
  const exported = manifest?.exports
  if (typeof exported === 'string') candidates.push(exported)
  else if (exported && typeof exported === 'object' && typeof exported['.'] === 'string') candidates.push(exported['.'])
  candidates.push('./lib/index.js', './index.js')
  return [...new Set(candidates)]
}

/**
 * 找到第一个真实存在的入口文件。
 * @param {{ dir: string, manifest: object | undefined }} entry 插件条目。
 * @returns {string | undefined} 绝对路径，或 undefined。
 */
export function entryFile(entry) {
  if (entry.manifest === undefined) return undefined
  for (const candidate of entryCandidates(entry.manifest)) {
    const file = resolve(entry.dir, candidate)
    if (existsSync(file)) return file
  }
  return undefined
}

/**
 * 声明了 `scripts.build` 但入口还不存在，说明要先构建一次。
 * @param {{ dir: string, manifest: object | undefined }} entry 插件条目。
 * @returns {boolean}
 */
export function needsBuild(entry) {
  const build = entry.manifest?.scripts?.build
  return typeof build === 'string' && build.trim() !== '' && entryFile(entry) === undefined
}

/** 把 recorded 值（`link:` / `file:`，可能带 `~`）解析成本机绝对路径；非本地引用返回 undefined。 */
function recordedTarget(recorded, profileDir) {
  const match = /^(?:link|file):(.*)$/s.exec(String(recorded))
  if (match === null) return undefined
  const path = match[1].replace(/^~(?=$|[\\/])/, () => homedir())
  return resolve(profileDir, path)
}

/** Windows 上比较路径视大小写与斜杠方向为同一；其他平台保留大小写。 */
function normalized(path) {
  const value = resolve(path).replaceAll('\\', '/')
  return process.platform === 'win32' ? value.toLowerCase() : value
}

export function sameTarget(recorded, dir, profileDir) {
  const target = recordedTarget(recorded, profileDir)
  return target !== undefined && normalized(target) === normalized(dir)
}

/**
 * 检查一个插件条目：`problems` 非空就拒绝注册，每条写明原因与修法。
 * 通过时给出标准化后的包名与是否需要构建。
 * @param {{ dirName: string, dir: string, manifest: object | undefined }} entry 扫描结果。
 * @param {{ profileDependencies?: object, profileDir?: string }} options profile 现状。
 * @returns {{ dirName: string, dir: string, name: string, needsBuild: boolean, problems: string[] }}
 */
export function inspectUserPlugin(entry, options = {}) {
  const { profileDependencies = {}, profileDir = '' } = options
  const { dirName, dir, manifest } = entry
  const label = `user-plugins/${dirName}`
  const result = { dirName, dir, name: '', needsBuild: false, problems: [] }
  const problems = result.problems
  if (manifest === undefined) {
    problems.push(`${label}: package.json 缺失、不是常规文件或不是合法 JSON`)
    return result
  }
  const name = typeof manifest.name === 'string' ? manifest.name : ''
  result.name = name
  if (!PACKAGE_NAME.test(name)) {
    problems.push(`${label}: 包名 "${name}" 不是 npm 接受的包名（小写、可带 @scope/）`)
    return result
  }
  const patch = manifest.dsh?.bundle?.patch
  if (typeof patch !== 'string' || patch.trim() === '') {
    problems.push(`${label}: package.json 没有声明 dsh.bundle.patch —— DSH 会把它当普通依赖，不会作为 profile bundle 激活`)
  } else {
    const patchFile = resolve(dir, patch)
    const inside = relative(dir, patchFile)
    if (isAbsolute(inside) || inside === '' || inside.startsWith('..')) {
      problems.push(`${label}: dsh.bundle.patch 指向包目录之外（${patch}），拒绝注册`)
    } else if (!existsSync(patchFile)) {
      problems.push(`${label}: dsh.bundle.patch 指向的 ${patch} 不存在`)
    }
  }
  const recorded = profileDependencies[name]
  if (recorded !== undefined && !sameTarget(recorded, dir, profileDir)) {
    problems.push(`${label}: 包名 ${name} 已被 profile 里另一个来源占用（${recorded}）；换个包名再注册，否则会劫持已有插件`)
  }
  result.needsBuild = needsBuild(entry)
  if (entryFile(entry) === undefined && !result.needsBuild) {
    const build = typeof manifest.scripts?.build === 'string' ? '（它也没有声明 scripts.build）' : ''
    problems.push(`${label}: 入口文件不存在（main=${manifest.main ?? '未声明'}）${build}；补上入口或加 build 脚本`)
  }
  return result
}

/** 目标路径是否在档位目录之内。 */
function isInside(userDir, target) {
  const rel = relative(resolve(userDir), resolve(target))
  return rel !== '' && !isAbsolute(rel) && !rel.startsWith('..') && rel !== '..'
}

/**
 * profile 里「本档注册过、但源码目录已经不在了」的依赖名：这类残留 link
 * 会让下次启动变难看，`--sync` 会逐个 `plugin remove` 掉。
 * @param {{ dependencies?: object }} profile profile 清单。
 * @param {{ profileDir: string, userDir: string }} locations 解析相对 link 与判定归属。
 * @returns {string[]} 需要清理的包名（排序）。
 */
export function pruneNames(profile, locations) {
  const { profileDir, userDir } = locations
  const dependencies = profile?.dependencies ?? {}
  const names = []
  for (const [name, recorded] of Object.entries(dependencies)) {
    const target = recordedTarget(recorded, profileDir)
    if (target === undefined || !isInside(userDir, target)) continue
    if (!existsSync(target)) names.push(name)
  }
  return names.sort()
}
