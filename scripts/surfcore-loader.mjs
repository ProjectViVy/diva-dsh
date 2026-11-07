// Redirect legacy SurfCore paths only, including in plugin-owned Node subprocesses.
// The upstream source remains a clean, pinned submodule.
import { registerHooks } from 'node:module'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderPatchedSource } from './lib/surfcore-component-patch.mjs'
import { renderHostWorkdirSource } from './lib/surfcore-runtime-transform.mjs'

const sourceRoot = resolve(process.env.SURFCORE_LOCAL_SOURCE || '.')
const projectRoot = resolve(sourceRoot, '..', '..')
const patchRoot = process.env.SURFCORE_PATCH_DIR || join(projectRoot, '.artifacts', 'surfcore-adapter', 'patches')

let manifest
function patchedManifest() {
  if (manifest === undefined) {
    try { manifest = JSON.parse(readFileSync(join(patchRoot, 'patched-manifest.json'), 'utf8')) }
    catch { manifest = null }
  }
  return manifest
}
function assertFreshPatch(relativeFile, source) {
  const built = patchedManifest()
  if (!built) throw new Error(`SURFCORE_PATCH_DRIFT: ${relativeFile} has generated patches but no patched-manifest.json. Run npm run setup:components.`)
  const entry = built.files?.find(item => item.path === relativeFile.replaceAll('\\', '/'))
  if (!entry) throw new Error(`SURFCORE_PATCH_DRIFT: ${relativeFile} is not listed in patched-manifest.json. Run npm run setup:components.`)
  const actual = createHash('sha256').update(source).digest('hex')
  if (actual !== entry.sourceSha256) {
    throw new Error(`SURFCORE_PATCH_DRIFT: ${relativeFile} changed after the component patches were built (expected ${entry.sourceSha256}, found ${actual}). Run npm run setup:components.`)
  }
}

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) {
    throw new Error('The pinned SurfCore source no longer matches the local automation safeguards.')
  }
  return source.replace(before, after)
}

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context)
    if (!url.startsWith('file:') || loaded.format !== 'module' || loaded.source == null || !process.env.DSH_HOME) return loaded
    const file = fileURLToPath(url)
    const relativeFile = relative(sourceRoot, file)
    if (!relativeFile || relativeFile.startsWith(`..${sep}`) || relativeFile === '..' || isAbsolute(relativeFile) || relativeFile.split(sep).includes('node_modules')) return loaded
    let source = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8')
    let patched = false
    if (process.env.SURFCORE_COMPONENT_SPLIT === '1') {
      const generated = join(patchRoot, relativeFile)
      if (existsSync(generated)) {
        assertFreshPatch(relativeFile, source)
        source = readFileSync(generated, 'utf8')
        patched = true
      } else {
        const rendered = renderPatchedSource(relativeFile, source, { projectRoot })
        if (rendered !== null) { source = rendered; patched = true }
      }
    }
    // A handful of upstream modules use ~/.dsh even when DSH_HOME is set.
    source = source.replace(/path\.join\((os\.homedir\(\)|HOME|home),\s*(['"])\.dsh\2(?=\s*[,\)])/g,
      (_all, home, quote) => `path.join((process.env.DSH_HOME || path.join(${home}, ${quote}.dsh${quote}))`)
    if (['bili-watch.mjs', 'subtitles.mjs', 'debrief.mjs'].some(name => relativeFile === join('plugins', 'surfcore', 'tools', 'commands', name))) {
      source = replaceOnce(source, "path.join((process.env.USERPROFILE || process.env.HOME || '/'), '.dsh', 'shots'", "path.join(process.env.DSH_HOME, 'shots'")
    }
    if (relativeFile === join('plugins', 'surfcore', 'tools', 'commands', 'whale-night.mjs')) {
      source = replaceOnce(source, 'const MAX_WAKES = Math.min(12, Math.max(0, Number(cfg.maxWakesPerDay ?? 12) || 12))', 'const MAX_WAKES = Math.min(12, Math.max(0, Number.isFinite(Number(cfg.maxWakesPerDay ?? 12)) ? Number(cfg.maxWakesPerDay ?? 12) : 12))')
      source = replaceOnce(source, 'const MIN_GAP_MIN = Math.max(0, Number(cfg.minGapMin ?? 20) || 20)', 'const MIN_GAP_MIN = Math.max(0, Number.isFinite(Number(cfg.minGapMin ?? 20)) ? Number(cfg.minGapMin ?? 20) : 20)')
      source = replaceOnce(source, "    fs.mkdirSync(biliState('whale-log.jsonl'),\n      JSON.stringify({ at: new Date().toISOString(), kind, target: null, note }) + '\\n')\n  } catch {}", "    const file = biliState('whale-log.jsonl')\n    fs.mkdirSync(path.dirname(file), { recursive: true })\n    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), kind, target: null, note }) + '\\n')\n  } catch (error) { console.error('生物钟事件写入失败：' + String(error?.message ?? error)) }")
    }
    if (relativeFile === join('plugins', 'surfcore', 'tools', 'commands', 'selftest.mjs')) {
      source = replaceOnce(source, "const CFG = path.join(DSH, 'bili.config.json')", "const CFG = process.env.SURFCORE_BILI_CONFIG || path.join(DSH, 'surfcore', 'bili.config.json')")
      source = replaceOnce(source, "line(WARN, '依赖体检（deps）', '没跑起来：'", "line(NO, '依赖体检（deps）', '没跑起来或未通过：'")
      source = replaceOnce(source, "['当前角色目录', biliStateDir()]", "['平台状态目录', biliStateDir()]")
      source = replaceOnce(source, "console.log('     插件启动时会自动开一个会话，位置在：')", "console.log('     手动启动 B站生物钟后，可在工作区中查看对应会话。')")
      source = replaceOnce(source, "console.log('  ② 【给她完全权限】')", "console.log('  ② 【检查会话权限】')")
      source = replaceOnce(source, "console.log('     打开那个会话 → 权限设置 → 选「完全访问 / danger-full-access」')", "console.log('     打开对应会话，按实际任务检查权限设置。')")
      source = replaceOnce(source, "console.log('     否则她起来后跑不了命令、发不了评论、写不了日记 ✗')", "console.log('     项目状态与数据位于项目内的 DSH_HOME。')")
      source = replaceOnce(source, "} else {\n  console.log(`══════════ ${bad} 项没通过", "} else {\n  try { fs.unlinkSync(biliState('selftest-passed.json')) } catch (error) { if (error?.code !== 'ENOENT') console.error('旧自检标记无法清除：' + String(error?.message ?? error)) }\n  console.log(`══════════ ${bad} 项没通过")
    }
    if (relativeFile === join('plugins', 'surfcore', 'tools', 'commands', 'deps.mjs')) {
      source = replaceOnce(source, "let dirOk = false\ntry {\n  const d = biliStateDir()\n  fs.mkdirSync(d, { recursive: true })\n  const probe = path.join(d, '.write-probe')\n  fs.writeFileSync(probe, 'ok'); fs.unlinkSync(probe)\n  dirOk = true\n} catch {}", `let dirOk = false
let probeDir = '', probe = ''
try {
  const d = biliStateDir()
  fs.mkdirSync(d, { recursive: true })
  probeDir = fs.mkdtempSync(path.join(d, '.write-probe-'))
  probe = path.join(probeDir, 'probe')
  fs.writeFileSync(probe, 'ok', { flag: 'wx', mode: 0o600 })
  fs.unlinkSync(probe); probe = ''
  fs.rmdirSync(probeDir); probeDir = ''
  dirOk = true
} catch {} finally {
  if (probe) { try { fs.unlinkSync(probe) } catch {} }
  if (probeDir) { try { fs.rmdirSync(probeDir) } catch {} }
}`)
      source = replaceOnce(source, '① winget install ffmpeg  ② 或设环境变量 FFMPEG=路径  ③ 或放进 <仓库>/bin/ 或 ~/.dsh/surfcore/bili/bin/', '将 FFmpeg 放入项目内的 SurfCore 工具 bin 目录或项目状态目录 surfcore/bili/bin。')
    }
    if (relativeFile === join('plugins', 'surfcore', 'tools', 'lib', 'ffmpeg.mjs')) {
      source = replaceOnce(source, '  ① 装一个：winget install ffmpeg   （或 scoop install ffmpeg / brew install ffmpeg）', '  ① 在项目内准备 FFmpeg，放到下方所列目录')
      source = replaceOnce(source, '  ② 用环境变量指定：set FFMPEG=D:\\\\path\\\\to\\\\ffmpeg.exe', '  ② 也可为本项目进程指定已有 FFmpeg 路径')
    }
    if (relativeFile === join('plugins', 'surfcore', 'lib', 'index.js')) {
      if (!patched) {
        // Do not resume queued updates, start Bilibili, or poll for updates at boot.
        source = replaceOnce(source, 'try { resumePendingApply({ stateDir: STATE_DIR, pluginLog }); }',
          "try { if (process.env.SURFCORE_SKIP_AUTOSTART !== '1') resumePendingApply({ stateDir: STATE_DIR, pluginLog }); }")
        source = replaceOnce(source, '  startSchedulerNow();\n\n  // 管理员称呼',
          "  if (process.env.SURFCORE_SKIP_AUTOSTART !== '1') startSchedulerNow();\n\n  // 管理员称呼")
        source = replaceOnce(source, 'enabled: updCfg.enabled !== false && updCfg.checkOnStart !== false,',
          "enabled: process.env.SURFCORE_SKIP_AUTOSTART !== '1' && updCfg.enabled !== false && updCfg.checkOnStart !== false,")
      }
      if (source.includes('cwd: os.homedir(),')) source = renderHostWorkdirSource(source)
      if (!patched) {
        source = replaceOnce(source, '  ensureAdminProjection();',
          "  if (process.env.SURFCORE_SKIP_AUTOSTART !== '1') ensureAdminProjection();")
        source = replaceOnce(source, 'try { petPurpose.start(); }',
          "try { if (process.env.SURFCORE_SKIP_AUTOSTART !== '1') petPurpose.start(); }")
      }
    }
    if (relativeFile === join('src', 'voice-packs.js')) {
      source = source.replace(/^(\s*)push\(path\.join\(os\.homedir\(\), (?:'Documents', )?'surfcore', 'state', 'voice-packs'\)\);/gm,
        (line, indentation) => `${indentation}if (!process.env.DSH_HOME) ${line.trimStart()}`)
    }
    return { ...loaded, source }
  },
})
