#!/usr/bin/env node
// Rebuild the project-local Superagent source bundle.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ARTIFACTS, BUNDLE_DIR, ROOT } from './lib/vivy.mjs'
import { localEnvironment, prepareLocalDirectories, superagentPatches, withTemporaryPatch } from './lib/source.mjs'

const pnpm = join(ARTIFACTS, 'tools', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
if (!existsSync(pnpm)) throw new Error('The project-local package manager is missing; run "npm run setup" first.')
prepareLocalDirectories(ROOT)
function run(args) {
  console.log(`$ pnpm ${args.join(' ')}`)
  const result = spawnSync(process.execPath, [pnpm, ...args], {
    stdio: 'inherit', cwd: BUNDLE_DIR, env: { ...localEnvironment(ROOT), CI: 'true' },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`pnpm ${args.join(' ')} exited with ${result.status ?? result.signal}`)
}
run(['install', '--frozen-lockfile'])
withTemporaryPatch(BUNDLE_DIR, superagentPatches(ROOT), () => run(['run', 'build']))
console.log('\nBundle rebuilt. Run "npm run restart" to load it.')
