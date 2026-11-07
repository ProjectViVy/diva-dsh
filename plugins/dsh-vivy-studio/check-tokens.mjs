import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/* The official sheet lives in the DSH checkout this template pins:
   <template>/deepseek-harness/packages/client/ui-theme/src/styles/ */
const here = dirname(fileURLToPath(import.meta.url))
const sheet = join(here, '..', '..', 'deepseek-harness', 'packages', 'client',
  'ui-theme', 'src', 'styles', 'design-platform.css')
const official = readFileSync(sheet, 'utf8')
const ours = readFileSync(join(here, 'theme.css'), 'utf8')

const names = new Set()
for (const match of official.matchAll(/--dsw-(?:alias|specific)-[a-z0-9-]+/g)) {
  names.add(match[0])
}

const missing = [...names].filter((name) => !ours.includes(name)).sort()
if (missing.length > 0) {
  console.error(`missing ${missing.length} official tokens:`)
  for (const name of missing) console.error(`  ${name}`)
  process.exit(1)
}
console.log(`ok: ${names.size} official alias/specific tokens covered`)
