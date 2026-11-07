import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

/** Environment for project-owned child processes; it never modifies the parent shell. */
export function localEnvironment(root, parent = process.env) {
  const project = resolve(root)
  const local = join(project, '.artifacts')
  const temp = join(local, 'tmp')
  return {
    ...parent,
    PATH: [join(project, 'deepseek-harness', 'node_modules', '.bin'), parent.PATH].filter(Boolean).join(delimiter),
    DSH_HOME: join(local, 'dsh-home'),
    PNPM_HOME: join(local, 'pnpm-home'),
    COREPACK_HOME: join(local, 'corepack'),
    XDG_CONFIG_HOME: join(local, 'xdg-config'),
    XDG_CACHE_HOME: join(local, 'xdg-cache'),
    XDG_DATA_HOME: join(local, 'xdg-data'),
    CARGO_HOME: join(local, 'cargo-home'),
    ELECTRON_CACHE: join(local, 'electron-cache'),
    ELECTRON_BUILDER_CACHE: join(local, 'electron-builder-cache'),
    PLAYWRIGHT_BROWSERS_PATH: join(local, 'playwright-browsers'),
    PUPPETEER_CACHE_DIR: join(local, 'puppeteer-cache'),
    npm_config_cache: join(local, 'npm-cache'),
    npm_config_devdir: join(local, 'node-gyp'),
    npm_package_config_node_gyp_devdir: join(local, 'node-gyp'),
    pnpm_config_store_dir: join(local, 'pnpm-store'),
    TMPDIR: temp,
    TMP: temp,
    TEMP: temp,
  }
}

/** Run the DSH source entry while keeping the template as the default workspace. */
export function sourceRuntimeInvocation(root, args) {
  const project = resolve(root)
  const harness = join(project, 'deepseek-harness')
  const require = createRequire(join(harness, 'package.json'))
  return {
    cwd: project,
    args: ['--import', require.resolve('tsx/esm'), join(harness, 'apps', 'cli', 'src', 'bin.ts'), ...args],
    env: { ...localEnvironment(project), TSX_TSCONFIG_PATH: join(harness, 'tsconfig.json') },
  }
}

/** Create the directories that tools expect to exist before they are launched. */
export function prepareLocalDirectories(root) {
  const env = localEnvironment(root)
  const names = [
    'DSH_HOME', 'PNPM_HOME', 'COREPACK_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME',
    'CARGO_HOME', 'ELECTRON_CACHE', 'ELECTRON_BUILDER_CACHE', 'PLAYWRIGHT_BROWSERS_PATH',
    'PUPPETEER_CACHE_DIR', 'npm_config_cache', 'npm_config_devdir', 'npm_package_config_node_gyp_devdir', 'pnpm_config_store_dir', 'TMPDIR',
  ]
  for (const name of names) {
    if (!validateStateDirectory(root, env[name])) {
      throw new Error(`The project-local ${name} path resolves outside the project: ${env[name]}`)
    }
  }
  for (const path of [join(root, '.artifacts', 'control'), join(root, '.artifacts', 'tools'),
    join(root, 'deepseek-harness'), join(root, 'superagent'), join(root, 'plugins', 'surfcore')]) {
    if (!validateStateDirectory(root, path)) {
      throw new Error(`A project path resolves outside the project: ${path}`)
    }
  }
  for (const name of ['DSH_HOME', 'PNPM_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'TMPDIR']) {
    mkdirSync(env[name], { recursive: true })
  }
}

function resolvedPath(path) {
  let current = resolve(path)
  const suffix = []
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) throw new Error(`Cannot resolve an existing ancestor for ${path}`)
    suffix.unshift(basename(current))
    current = parent
  }
  return resolve(realpathSync(current), ...suffix)
}

/** Reject paths outside the project, including symlinks leading outside it. */
export function validateStateDirectory(root, target) {
  if (!isAbsolute(target)) return false
  const path = relative(resolvedPath(root), resolvedPath(target))
  return path !== '' && path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(path)
}

/** Read the stateDir value from a profile patch without changing its other settings. */
export function configuredStateDirectory(patch) {
  const match = /^\s*stateDir\s*:\s*(.+?)\s*$/m.exec(patch)
  if (!match) return undefined
  const value = match[1].trim()
  if (value.startsWith('"')) return JSON.parse(value)
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'")
  return value
}

/** Return the authenticated local panel link from this profile's newest log. */
export function panelLinkFromLogs(directory, profile, serviceUrl) {
  if (!existsSync(directory)) return undefined
  const prefix = `vivy-dsh-${profile}-`
  const logs = readdirSync(directory).filter(name => name.startsWith(prefix) && name.endsWith('.log'))
    .map(name => join(directory, name)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  if (logs.length === 0) return undefined
  const match = /^dsh web: (\S+)\s*$/m.exec(readFileSync(logs[0], 'utf8'))
  if (!match) return undefined
  try {
    const url = new URL(match[1])
    return url.origin === new URL(serviceUrl).origin && url.searchParams.has('token') ? url.href : undefined
  } catch {
    return undefined
  }
}

/** Register the template root as a DSH workspace using the local panel's authenticated API. */
export async function ensureRootWorkspace(panelLink, root) {
  const url = new URL(panelLink)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
    throw new Error('The DSH workspace API must use a local loopback URL.')
  }
  const login = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
  const cookie = login.headers.get('set-cookie')?.split(';', 1)[0]
  if (!cookie) throw new Error(`DSH workspace authentication failed (HTTP ${login.status}).`)
  const method = 'workspace/create'
  const response = await fetch(new URL(`/api/${method}`, url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      type: 'client-request', rpcId: randomUUID(), method,
      payload: { args: { request: { path: resolve(root) } } },
    }),
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error(`DSH workspace registration failed (HTTP ${response.status}).`)
  const result = await response.json()
  if (!result.result?.ok) throw new Error(`DSH workspace registration failed: ${result.result?.error?.message ?? 'unknown error'}`)
  return result.result.value.created
}

function patchText(directory, patchPath) {
  const patchText = readFileSync(patchPath, 'utf8').replaceAll('\r\n', '\n')
  return patchText.split(/(?=^--- a\/)/m).map((section) => {
    const match = /^--- a\/([^\n]+)\n\+\+\+ b\/([^\n]+)\n/.exec(section)
    if (!match || match[1] !== match[2]) return section
    const target = resolve(directory, match[1])
    if (!validateStateDirectory(directory, target) || !existsSync(target)) return section
    const contents = readFileSync(target, 'utf8')
    return contents.includes('\r\n') && !/(?<!\r)\n/.test(contents) ? section.replaceAll('\n', '\r\n') : section
  }).join('')
}

function gitApply(directory, text, args) {
  const result = spawnSync('git', ['apply', ...args, '-'], { cwd: directory, encoding: 'utf8', input: text })
  if (result.error) throw result.error
  return result
}

export function patchManifest(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(parsed?.patches) || parsed.patches.length === 0) {
    throw new Error('The patch manifest must list at least one patch')
  }
  for (const name of parsed.patches) {
    if (typeof name !== 'string' || !/^[A-Za-z0-9._-]+\.patch$/.test(name)) {
      throw new Error(`Invalid patch name in the manifest: ${String(name)}`)
    }
  }
  return parsed.patches
}

export function superagentPatches(root) {
  const directory = join(root, 'patches')
  return patchManifest(join(directory, 'superagent-patches.json')).map(name => join(directory, name))
}

/** Apply build-only patches without retaining changes made by this invocation. */
export function withTemporaryPatch(directory, patchPaths, operation) {
  const patches = Array.isArray(patchPaths) ? patchPaths : [patchPaths]
  const applied = []
  let failure
  try {
    for (const patchPath of patches) {
      const text = patchText(directory, patchPath)
      const forward = gitApply(directory, text, ['--check'])
      if (forward.status !== 0) {
        const reverse = gitApply(directory, text, ['--reverse', '--check'])
        if (reverse.status === 0) continue
        throw new Error(`Cannot apply the build patch ${basename(patchPath)} without changing existing edits: ${forward.stderr.trim()}`)
      }
      const patched = gitApply(directory, text, [])
      if (patched.status !== 0) {
        throw new Error(`Cannot apply the build patch ${basename(patchPath)}: ${patched.stderr.trim()}`)
      }
      applied.push({ patchPath, text })
    }
    return operation()
  } catch (error) {
    failure = error
    throw error
  } finally {
    const restoreErrors = []
    for (const { patchPath, text } of applied.reverse()) {
      const restored = gitApply(directory, text, ['--reverse'])
      if (restored.status !== 0) {
        restoreErrors.push(`${basename(patchPath)}: ${restored.stderr.trim()}`)
      }
    }
    if (restoreErrors.length) {
      const detail = `Could not restore the build patches: ${restoreErrors.join('; ')}`
      if (failure) failure.message = `${failure.message}; ${detail}`
      else throw new Error(detail)
    }
  }
}

/** Check the checkout against the superproject's gitlink without moving it. */
export function verifyPinnedSubmodule(root, path, warn = console.warn) {
  const entry = spawnSync('git', ['ls-files', '--stage', '--', path], { cwd: root, encoding: 'utf8' })
  if (entry.error) throw entry.error
  const match = /^160000 ([0-9a-f]{40,64}) 0\t/m.exec(entry.stdout)
  if (entry.status !== 0 || !match) throw new Error(`No pinned submodule entry exists for ${path}.`)
  const revision = spawnSync('git', ['-C', join(root, path), 'rev-parse', 'HEAD'], { encoding: 'utf8' })
  if (revision.error) throw revision.error
  if (revision.status !== 0) throw new Error(`Cannot read the ${path} submodule revision: ${revision.stderr.trim()}`)
  const current = revision.stdout.trim()
  if (current !== match[1]) {
    throw new Error(`${path} is at ${current}, but the pinned revision is ${match[1]}; the checkout was left unchanged.`)
  }
  const status = spawnSync('git', ['-C', join(root, path), 'status', '--porcelain', '--untracked-files=no', '--ignore-submodules=none'], { encoding: 'utf8' })
  if (status.error) throw status.error
  if (status.status !== 0) throw new Error(`Cannot inspect ${path} submodule changes: ${status.stderr.trim()}`)
  if (status.stdout.trim()) warn(`${path} has modified tracked source files; the pinned revision is the base, and local changes will be used.`)
  return current
}

/** Initialize a missing submodule without overwriting an unrelated directory. */
export function initializePinnedSubmodule(root, path, env = localEnvironment(root)) {
  const directory = join(root, path)
  if (!existsSync(join(directory, '.git'))) {
    if (existsSync(directory) && readdirSync(directory).length > 0) {
      throw new Error(`${directory} is not an initialized submodule and is not empty; it was left unchanged.`)
    }
    const result = spawnSync('git', ['submodule', 'update', '--init', '--', path], {
      cwd: root, env, stdio: 'inherit',
    })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`Could not initialize submodule ${path}: ${result.status ?? result.signal}`)
  }
  return verifyPinnedSubmodule(root, path)
}

/** Configure a fresh profile, preserving any existing profile with a local stateDir. */
export function ensureMachineConfig(root, profile, port) {
  const project = resolve(root)
  const local = join(project, '.artifacts', 'dsh-home')
  const profileDir = join(local, 'profiles', profile)
  const patchPath = join(profileDir, 'cordis.patch.yml')
  const existing = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
  const configured = configuredStateDirectory(existing)
  if (configured !== undefined) {
    if (!validateStateDirectory(project, configured)) {
      const state = join(local, 'state', profile)
      let marker
      try { marker = JSON.parse(readFileSync(join(project, '.artifacts', 'component-migration.json'), 'utf8')) } catch {}
      const backup = typeof marker?.backup === 'string' ? marker.backup.replaceAll('\\', '/') : ''
      const boundary = backup.lastIndexOf('/.artifacts/backups/')
      const oldRoot = boundary > 0 ? backup.slice(0, boundary) : ''
      const expected = `${oldRoot}/.artifacts/dsh-home/state/${profile}`
      const lines = existing.match(/^[ \t]*stateDir[ \t]*:[ \t]*[^\r\n]+[ \t]*$/gm) || []
      if (marker?.version !== 1 || !/^[a-zA-Z0-9_-]+$/.test(profile) || !oldRoot || configured.replaceAll('\\', '/') !== expected || existsSync(configured) || !existsSync(state) || !statSync(state).isDirectory() || !validateStateDirectory(project, state) || lines.length !== 1) {
        throw new Error(`The profile stateDir is outside the project: ${configured}`)
      }
      const backupPath = join(profileDir, existsSync(join(profileDir, 'cordis.patch.pre-relocation.yml')) ? `cordis.patch.pre-relocation-${randomUUID()}.yml` : 'cordis.patch.pre-relocation.yml')
      writeFileSync(backupPath, existing, { flag: 'wx', mode: 0o600 })
      const updated = existing.replace(/^([ \t]*stateDir[ \t]*:[ \t]*)[^\r\n]+/m, `$1${JSON.stringify(state.replaceAll('\\', '/'))}`)
      const temp = `${patchPath}.${randomUUID()}.tmp`
      try { writeFileSync(temp, updated, { flag: 'wx', mode: 0o600 }); renameSync(temp, patchPath) }
      catch (error) { try { unlinkSync(temp) } catch {}; throw error }
      return true
    }
    return false
  }
  const contents = existing.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#')).join('')
  if (contents && contents !== '[]') {
    throw new Error(`The existing profile has settings but no stateDir; configure it manually: ${patchPath}`)
  }
  const state = join(local, 'state', profile)
  if (!validateStateDirectory(project, state)) throw new Error(`The stateDir is outside the project: ${state}`)
  mkdirSync(profileDir, { recursive: true })
  mkdirSync(state, { recursive: true })
  writeFileSync(patchPath, [
    '- id: webserver',
    '  config:',
    '    host: 127.0.0.1',
    `    port: ${port}`,
    '- id: dsh-superagent',
    '  config:',
    `    stateDir: ${JSON.stringify(state.replaceAll('\\', '/'))}`,
    '',
  ].join('\n'))
  return true
}
