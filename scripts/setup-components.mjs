#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { ROOT, PROFILE, processes, profileDir, state } from './lib/vivy.mjs'
import { prepareLocalDirectories, sourceRuntimeInvocation, verifyPinnedSubmodule } from './lib/source.mjs'
import { componentCutoverReady, componentPackages, inspectComponents, relocateProfileDependencies } from './lib/component-setup.mjs'
import { migrateComponents } from './lib/component-migration.mjs'
import { ensureSurfcoreAdapter } from './lib/surfcore.mjs'

prepareLocalDirectories(ROOT)
if (processes().length || (await state()) !== undefined) throw new Error('Stop the local panel with "npm run stop" before migrating components')
verifyPinnedSubmodule(ROOT, 'plugins/surfcore')
const packages = componentPackages(ROOT)
const profile = profileDir()
if (relocateProfileDependencies(ROOT, PROFILE)) console.log('Relocated project-owned profile dependencies; originals were backed up.')
const before = inspectComponents(profile, packages)
const migrated = migrateComponents(ROOT)
console.log(migrated.alreadyMigrated ? 'Preserved the existing component data.' : `Component backup: ${migrated.backup}`)
if (before.missing.length) {
  const invocation = sourceRuntimeInvocation(ROOT, ['plugin', '--profile', PROFILE, 'add', ...before.missing.map(([, target]) => `link:${target}`)])
  const result = spawnSync(process.execPath, invocation.args, { cwd: invocation.cwd, env: { ...invocation.env, CI: 'true' }, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Component registration failed (${result.status ?? result.signal})`)
}
if (!componentCutoverReady(ROOT, profile, packages)) throw new Error('Component migration or profile registration is incomplete')
ensureSurfcoreAdapter(ROOT, join(ROOT, '.artifacts', 'surfcore-adapter'), { splitComponents: true })
console.log('Voice, memory, mempalace, continual-harness, evolution, laputa and SurfCore adapter components are registered locally.')
