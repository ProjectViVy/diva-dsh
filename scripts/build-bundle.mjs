#!/usr/bin/env node
// Rebuild the vendored dsh-superagent bundle after editing it.
//
// The bundle is a fork of https://github.com/deepseek-ai/dsh-superagent-prototype,
// kept inside this project so it can be changed and shipped together with the launcher.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { BUNDLE_DIR } from './lib/vivy.mjs'

/** pnpm ships as a .cmd shim on Windows, which only runs through a shell. */
function runPnpm(args) {
  console.log(`$ pnpm ${args.join(' ')}`)
  const result = spawnSync(['pnpm', ...args].join(' '), { stdio: 'inherit', shell: true, cwd: BUNDLE_DIR })
  if (result.status !== 0) throw new Error(`pnpm ${args.join(' ')} exited with ${result.status}`)
}

if (!existsSync(join(BUNDLE_DIR, 'package.json'))) {
  throw new Error(`${BUNDLE_DIR} does not look like a package; is the bundle still there?`)
}

runPnpm(['install'])
runPnpm(['run', 'build'])
console.log(`\nBundle rebuilt: ${join(BUNDLE_DIR, 'lib', 'index.js')}`)
console.log('Restart the service to load it: node scripts/vivy-dsh.mjs restart')
