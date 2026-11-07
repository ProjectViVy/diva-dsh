// Optional outbound proxy for the launched DSH service.
//
// DSH resolves one proxy policy from its launch environment before any plugin
// mounts (deepseek-harness packages/util/http-proxy), and that policy covers every
// plain fetch: model requests, web search, web_fetch, MCP over HTTP, and the child
// processes DSH spawns. The launcher therefore only has to place the variables in
// the service's environment — that layer outranks both `$DSH_HOME/.env` and the
// shell's own exports.
//
// Configuration lives under `.artifacts/` so it cannot travel with a clone. A
// proxy of `off` removes the variables rather than inheriting stale ones, because
// "off" has to mean off even when the shell exported a proxy.

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { surfcoreEnvironment } from './surfcore.mjs'

/** Every environment name that carries proxy configuration, in both casings. */
export const PROXY_NAMES = [
  'http_proxy', 'HTTP_PROXY',
  'https_proxy', 'HTTPS_PROXY',
  'no_proxy', 'NO_PROXY',
  'all_proxy', 'ALL_PROXY',
]

/** Schemes that name a proxy this harness cannot route. */
const REJECTED_SCHEMES = new Set(['socks:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:', 'pac:', 'pac+http:', 'pac+https:'])

/** Absolute path of the proxy configuration for one deployment root. */
export function proxyConfigFile(root) {
  return join(root, '.artifacts', 'proxy.json')
}

/**
 * Normalize and validate one proxy address.
 *
 * A bare `host:port` is accepted and read as `http://host:port`, because that is what
 * people paste. SOCKS is refused with a way forward instead of being accepted and
 * failing every request later.
 *
 * @param value - the address as the caller typed it.
 * @returns the normalized `http:` or `https:` URL, without a trailing root slash.
 * @throws when the value is empty, unparseable, a rejected scheme, or hostless.
 */
export function parseProxyUrl(value) {
  const trimmed = String(value ?? '').trim()
  if (trimmed === '') throw new Error('代理地址为空；请给出形如 http://127.0.0.1:7897 的地址')
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`
  let url
  try {
    url = new URL(candidate)
  } catch {
    throw new Error(`代理地址 "${trimmed}" 不是合法 URL；请给出形如 http://127.0.0.1:7897 的地址`)
  }
  if (REJECTED_SCHEMES.has(url.protocol)) {
    throw new Error(`DSH 不支持 ${url.protocol}// 代理；请指向代理软件的 HTTP 端口，例如 http://127.0.0.1:7897`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`代理地址必须用 http:// 或 https://，收到 ${url.protocol}//`)
  }
  if (url.hostname === '') throw new Error(`代理地址 "${trimmed}" 缺少主机名`)
  const path = url.pathname === '/' ? '' : url.pathname
  const auth = url.username === '' && url.password === '' ? '' : `${url.username}:${url.password}@`
  return `${url.protocol}//${auth}${url.host}${path}`
}

/**
 * Read the deployment's proxy configuration.
 * @param root - the deployment root.
 * @returns the configured proxy and optional bypass list, or `undefined` when no file exists.
 * @throws when the file is unreadable JSON or does not describe a usable proxy.
 */
export function readProxyConfig(root) {
  const file = proxyConfigFile(root)
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw new Error(`无法读取代理配置 ${file}：${error.message}`)
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`代理配置 ${file} 不是合法 JSON；请改成 {"proxy":"http://127.0.0.1:7897"}，或运行 "npm run proxy -- off" 删除它`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`代理配置 ${file} 必须是一个 JSON 对象；请改成 {"proxy":"http://127.0.0.1:7897"}`)
  }
  if (parsed.proxy === false || parsed.proxy === 'off') return { proxy: 'off' }
  if (typeof parsed.proxy !== 'string' || parsed.proxy.trim() === '') {
    throw new Error(`代理配置 ${file} 缺少 "proxy"；请改成 {"proxy":"http://127.0.0.1:7897"}，或运行 "npm run proxy -- off" 关闭代理`)
  }
  if (parsed.noProxy !== undefined && typeof parsed.noProxy !== 'string') {
    throw new Error(`代理配置 ${file} 的 "noProxy" 必须是字符串`)
  }
  return {
    proxy: parseProxyUrl(parsed.proxy),
    ...parsed.noProxy === undefined || parsed.noProxy.trim() === '' ? {} : { noProxy: parsed.noProxy.trim() },
  }
}

/**
 * Persist one proxy configuration, replacing any previous file atomically.
 * @param root - the deployment root.
 * @param options - the proxy address and an optional comma-separated bypass list.
 * @returns the normalized configuration written.
 */
export function writeProxyConfig(root, { proxy, noProxy }) {
  const value = {
    proxy: parseProxyUrl(proxy),
    ...noProxy === undefined || String(noProxy).trim() === '' ? {} : { noProxy: String(noProxy).trim() },
  }
  const file = proxyConfigFile(root)
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(temporary, file)
  return value
}

/** Delete the proxy configuration. Idempotent. */
export function clearProxyConfig(root) {
  rmSync(proxyConfigFile(root), { force: true })
}

/**
 * Decide how the service must be launched.
 *
 * The one-shot flag wins over the saved configuration; with neither, the launcher
 * leaves the environment alone and whatever the shell exported still applies.
 *
 * @param options - the deployment root, the one-shot flag, and the environment to report from.
 * @returns the resolved proxy state with the layer that supplied it.
 */
export function resolveProxy({ root, flag = {}, env = process.env }) {
  if (flag.off === true) return { kind: 'off', source: 'flag' }
  if (flag.url !== undefined) return { kind: 'proxy', url: parseProxyUrl(flag.url), source: 'flag' }
  const config = readProxyConfig(root)
  if (config === undefined) {
    const inherited = env.HTTPS_PROXY ?? env.https_proxy ?? env.ALL_PROXY ?? env.all_proxy
    return { kind: 'none', source: 'none', ...inherited === undefined || inherited === '' ? {} : { inherited } }
  }
  if (config.proxy === 'off') return { kind: 'off', source: 'config' }
  return { kind: 'proxy', url: config.proxy, source: 'config', ...config.noProxy === undefined ? {} : { noProxy: config.noProxy } }
}

/**
 * The same decision as {@link resolveProxy}, reporting a broken configuration
 * instead of throwing so that `status` still answers while `start` fails loud.
 * @param options - as {@link resolveProxy}.
 * @returns the resolved state, or one carrying the configuration error.
 */
export function safeResolveProxy(options) {
  try {
    return resolveProxy(options)
  } catch (error) {
    return { kind: 'invalid', source: 'none', error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Apply one resolved state to a child environment.
 *
 * The lowercase names are deleted whenever this writes: DSH reads the lowercase name
 * first, so leaving a shell-exported one behind would shadow the configured proxy and
 * silently route around it.
 *
 * @param env - the environment to start from; it is not modified.
 * @param resolved - the decision from {@link resolveProxy}.
 * @returns a new environment object.
 */
export function applyProxy(env, resolved) {
  const next = { ...env }
  if (resolved === undefined || resolved.kind === 'none' || resolved.kind === 'invalid') return next
  if (resolved.kind === 'off') {
    for (const name of PROXY_NAMES) delete next[name]
    return next
  }
  delete next.http_proxy
  delete next.https_proxy
  delete next.all_proxy
  delete next.ALL_PROXY
  next.HTTP_PROXY = resolved.url
  next.HTTPS_PROXY = resolved.url
  if (resolved.noProxy !== undefined && resolved.noProxy.trim() !== '') {
    delete next.no_proxy
    next.NO_PROXY = resolved.noProxy.trim()
  }
  return next
}

/**
 * The environment the DSH service runs with: the SurfCore isolation this launcher
 * always applies, then the proxy decision on top.
 * @param root - the deployment root.
 * @param parent - the launcher's own environment.
 * @param resolved - the decision from {@link resolveProxy}.
 * @returns the service environment.
 */
export function serviceEnvironment(root, parent, resolved) {
  return applyProxy(surfcoreEnvironment(root, parent, { splitComponents: true }), resolved)
}

/**
 * One-line description of a resolved state, with any credential removed.
 * @param resolved - a resolved state, or a stored marker string.
 * @returns the display form: `none`, `invalid`, `off`, or a credential-free URL.
 */
export function describeProxy(resolved) {
  const value = typeof resolved === 'string' ? resolved : resolvedName(resolved)
  if (value === undefined) return 'none'
  if (value === 'off' || value === 'none' || value === 'invalid') return value
  try {
    const url = new URL(value)
    const path = url.pathname === '/' ? '' : url.pathname
    return `${url.protocol}//${url.host}${path}`
  } catch {
    return 'invalid'
  }
}

/** The marker stored for one resolved state: a URL, or the bare word. */
function resolvedName(resolved) {
  if (resolved === undefined) return undefined
  if (resolved.kind === 'proxy') return resolved.url
  return resolved.kind
}

/** Absolute path of the marker recording what the live service was launched with. */
export function launchedProxyFile(root, profile) {
  return join(root, '.artifacts', 'control', 'profiles', profile, 'launched-proxy')
}

/**
 * Read the proxy this deployment's service is actually running with.
 * @param root - the deployment root.
 * @param profile - the DSH profile name.
 * @returns the stored marker, or `undefined` when the service was not started by this launcher.
 */
export function readLaunchedProxy(root, profile) {
  try {
    const value = readFileSync(launchedProxyFile(root, profile), 'utf8').trim()
    return value === '' ? undefined : value
  } catch {
    return undefined
  }
}

/**
 * Record what the service was launched with, so `status` can tell a stale
 * configuration from an effective one.
 * @param root - the deployment root.
 * @param profile - the DSH profile name.
 * @param resolved - the state the launcher used, or nothing to clear the marker.
 */
export function recordLaunchedProxy(root, profile, resolved) {
  const file = launchedProxyFile(root, profile)
  const name = resolvedName(resolved)
  if (name === undefined) {
    rmSync(file, { force: true })
    return
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${name}\n`)
}

/**
 * The `proxy` block of `status`.
 *
 * A missing launch marker means an earlier launcher started the service, so what is
 * in force is unknown rather than stale: only a recorded marker that differs from the
 * configuration asks for a restart.
 *
 * @param options - the current decision, the stored launch marker, and whether a service runs.
 * @returns the configured and inherited values, the recorded launch value, and whether a restart is required.
 */
export function proxyReport({ resolved, launched, running }) {
  const desired = resolvedName(resolved)
  return {
    configured: describeProxy(resolved),
    source: resolved?.source ?? 'none',
    ...resolved?.inherited === undefined ? {} : { inherited: describeProxy(resolved.inherited) },
    ...resolved?.error === undefined ? {} : { error: resolved.error },
    launched: launched === undefined ? null : describeProxy(launched),
    needs_restart: running && launched !== undefined && launched !== desired,
  }
}
