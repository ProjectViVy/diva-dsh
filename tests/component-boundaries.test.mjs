import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

function sources(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...sources(path))
    else if (/\.(?:mjs|js)$/.test(entry.name)) files.push(path)
  }
  return files
}

const specifiers = source => {
  const found = []
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) found.push(match[1])
  return found
}

const FORBIDDEN_NAME = /^(?:persona|personality|role|roles|pet|character|chars)(?:[-_.]|$)/i

test('memory, voice and shared component code never imports persona, role or pet modules', () => {
  const offenders = []
  for (const dir of [join(ROOT, 'plugins/memory/src'), join(ROOT, 'plugins/voice/src'), join(ROOT, 'plugins/_shared')]) {
    for (const file of sources(dir)) {
      for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
        const base = specifier.split('/').pop()?.replace(/\.(?:mjs|cjs|js)$/i, '') ?? ''
        if (FORBIDDEN_NAME.test(base)) offenders.push(`${relative(ROOT, file)} -> ${specifier}`)
      }
    }
  }
  assert.deepEqual(offenders, [], `人格模块不得迁入记忆/语音插件：\n${offenders.join('\n')}`)
})

test('component and adapter code never imports the pinned SurfCore source tree', () => {
  const offenders = []
  for (const dir of [join(ROOT, 'plugins/memory/src'), join(ROOT, 'plugins/voice/src'), join(ROOT, 'plugins/_shared'), join(ROOT, 'scripts')]) {
    for (const file of sources(dir)) {
      for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
        if (!specifier.startsWith('.') && !specifier.startsWith('/')) continue
        if (/(?:^|\/)plugins\/surfcore\//.test(specifier) || /(?:^|\/)surfcore\/src\//.test(specifier)) {
          offenders.push(`${relative(ROOT, file)} -> ${specifier}`)
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `插件不得直接依赖 SurfCore 源码：\n${offenders.join('\n')}`)
})
