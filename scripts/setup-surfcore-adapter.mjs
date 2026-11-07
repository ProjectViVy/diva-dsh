#!/usr/bin/env node
// Install and verify the dependencies of plugins/dsh-surfcore-adapter.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { localEnvironment, prepareLocalDirectories } from './lib/source.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PLUGIN = join(ROOT, 'plugins', 'dsh-surfcore-adapter')
const registryIndex = process.argv.indexOf('--registry')
const registry = registryIndex >= 0 ? process.argv[registryIndex + 1] : process.env.npm_config_registry || ''

if (!existsSync(join(PLUGIN, 'package.json'))) throw new Error(`Missing plugin package: ${PLUGIN}`)
prepareLocalDirectories(ROOT)
if (!existsSync(join(PLUGIN, 'node_modules', 'zod'))) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund'], {
    cwd: PLUGIN,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...localEnvironment(ROOT), ...(registry ? { npm_config_registry: registry } : {}) },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`npm exited with ${result.status ?? result.signal}`)
}
const plugin = await import(new URL('../plugins/dsh-surfcore-adapter/src/index.mjs', import.meta.url).href)
if (plugin.name !== 'dsh-surfcore-adapter' || typeof plugin.apply !== 'function') {
  throw new Error('dsh-surfcore-adapter 入口没有导出 name/apply')
}
console.log(`dsh-surfcore-adapter 的依赖已就绪：${join(PLUGIN, 'node_modules')}`)
