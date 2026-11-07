/**
 * Re-extract the oh-dsh skin catalog from an upstream checkout, so the ported
 * token values stay verbatim instead of being transcribed by hand.
 *
 *   node tools/extract-catalog.mjs <path-to-oh-dsh>/plugins/skins/src/skins.ts [out.js]
 *
 * The output is the `OH_DSH_SKINS` block embedded in `src/client.js`; paste it
 * over that block and keep the surrounding catalog entry (`vivy`) untouched.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const upstream = process.argv[2] ?? '/tmp/oh-dsh-probe/plugins/skins/src/skins.ts'
const output = process.argv[3] ?? '/tmp/oh-dsh-catalog.js'
const source = readFileSync(upstream, 'utf8')

const CONSTS = {
  'oh-dsh-skin-deep-current': 'DEEP_CURRENT_TOKENS',
  'oh-dsh-skin-jade-circuit': 'JADE_CIRCUIT_TOKENS',
  'oh-dsh-skin-porcelain': 'PORCELAIN_TOKENS',
  'oh-dsh-skin-ember-dusk': 'EMBER_DUSK_TOKENS',
}

function tokensOf(name) {
  const start = source.indexOf(`const ${name} = {`)
  if (start === -1) throw new Error(`missing ${name}`)
  const end = source.indexOf('} as const', start)
  const literal = source.slice(source.indexOf('{', start), end + 1)
  return Function(`"use strict";return (${literal})`)()
}

function metadataOf(id) {
  const at = source.indexOf(`id: '${id}'`)
  if (at === -1) throw new Error(`missing metadata for ${id}`)
  const block = source.slice(at, source.indexOf('}),', at))
  const field = (key) => {
    const match = new RegExp(`${key}: '((?:[^'\\\\]|\\\\.)*)'`).exec(block)
    if (match === null) throw new Error(`missing ${key} for ${id}`)
    return match[1]
  }
  return { colorScheme: field('colorScheme'), displayName: field('displayName'), preview: field('preview'), accent: field('accent') }
}

const entries = []
for (const [id, constant] of Object.entries(CONSTS)) {
  const tokens = tokensOf(constant)
  const meta = metadataOf(id)
  const keys = Object.keys(tokens)
  for (const key of keys) {
    if (!key.startsWith('--')) throw new Error(`${id}: token ${key} is not a custom property`)
    if (typeof tokens[key] !== 'string') throw new Error(`${id}: token ${key} is not a string`)
  }
  entries.push({ id, ...meta, tokens })
  console.log(`${id.padEnd(28)} ${String(keys.length).padStart(2)} tokens  ${meta.colorScheme.padEnd(5)} ${meta.displayName}`)
}

function tokenLines(tokens) {
  return JSON.stringify(tokens, null, 2)
    .split('\n')
    .map((line, index, all) => {
      if (index === 0) return '        tokens: Object.freeze({'
      if (index === all.length - 1) return '        }),'
      return `          ${line.trimStart()}`
    })
    .join('\n')
}

const body = entries.map((entry) => [
  '      {',
  `        id: ${JSON.stringify(entry.id)},`,
  `        scheme: ${JSON.stringify(entry.colorScheme)},`,
  `        name: ${JSON.stringify(entry.displayName)},`,
  `        summary: { zh: ${JSON.stringify(`${entry.displayName} · ${entry.colorScheme === 'dark' ? '深色' : '浅色'}`)}, en: ${JSON.stringify(`${entry.displayName} · ${entry.colorScheme}`)} },`,
  `        preview: ${JSON.stringify(entry.preview)},`,
  `        accent: ${JSON.stringify(entry.accent)},`,
  tokenLines(entry.tokens),
  '      },',
].join('\n')).join('\n')

writeFileSync(output, `const OH_DSH_SKINS = [\n${body}\n    ]\n`)
console.log(`\nwrote ${output} (${entries.reduce((sum, entry) => sum + Object.keys(entry.tokens).length, 0)} tokens total)`)
