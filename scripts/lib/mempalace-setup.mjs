import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { localEnvironment } from './source.mjs'

export function runMempalaceNpm(args, { root, parent = process.env, registry = '', platform = process.platform, spawnImpl = spawnSync }) {
  return spawnImpl(platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd: join(root, 'plugins', 'dsh-mempalace'),
    stdio: 'inherit',
    shell: platform === 'win32',
    env: { ...localEnvironment(root, parent), ...(registry ? { npm_config_registry: registry } : {}) },
  })
}
