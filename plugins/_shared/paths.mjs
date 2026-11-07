import { accessSync, constants, existsSync, mkdirSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

/** The project-local DSH home is the only default root components may use. */
export function projectHome(env = process.env, label = 'DSH_HOME') {
  const home = env.DSH_HOME
  if (!home || !isAbsolute(home)) throw new Error(`${label} 必须是绝对路径（当前 ${label}=${JSON.stringify(home ?? '')}）；请用项目启动器运行或设置 ${label}`)
  return resolve(home)
}

/** Explicit env paths win; the fallback must stay inside the project home. */
export function resolveComponentPath(env, name, fallback, { label = name } = {}) {
  const value = env[name] ?? fallback
  if (typeof value !== 'string' || !value || !isAbsolute(value)) throw new Error(`${label} 必须是绝对路径；请设置 ${name} 或 DSH_HOME`)
  return resolve(value)
}

export function prepareStateDir(dir, label = '组件状态目录') {
  if (existsSync(dir) && !statSync(dir).isDirectory()) throw new Error(`${label} 不是目录：${dir}`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  try { accessSync(dir, constants.W_OK) } catch { throw new Error(`${label} 不可写：${dir}`) }
  return dir
}
