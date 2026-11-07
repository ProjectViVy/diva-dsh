#!/usr/bin/env node
/**
 * dsh-vivy-tone — run the install from a shell.
 *
 * The same two calls the plugin makes, for the two things a plugin cannot do:
 * writing without waiting for a restart, and taking the translation back out
 * while still mounted.
 *
 *   node plugins/dsh-vivy-tone/src/cli.mjs --install   [--url http://127.0.0.1:3082]
 *   node plugins/dsh-vivy-tone/src/cli.mjs --remove    [--url ...]
 *   node plugins/dsh-vivy-tone/src/cli.mjs --status    [--url ...]
 *
 * `--dry-run` prints the plan and saves nothing; `--force` replaces an override
 * this package did not write (do that only after reading the diff).
 *
 * @module dsh-vivy-tone/cli
 */

import { readPrompts } from './write.mjs'
import { applyTranslations, removeTranslations, resolveStateDir } from './install.mjs'
import { TRANSLATIONS, WAVE, missingPlaceholders } from './zh.mjs'

const USAGE = `用法：
  node plugins/dsh-vivy-tone/src/cli.mjs --install [--url http://127.0.0.1:3082] [--dry-run] [--force]
  node plugins/dsh-vivy-tone/src/cli.mjs --remove  [--url http://127.0.0.1:3082] [--dry-run]
  node plugins/dsh-vivy-tone/src/cli.mjs --status  [--url http://127.0.0.1:3082]
`

const DEFAULT_URL = 'http://127.0.0.1:3082'

/** @param {readonly string[]} argv */
export function parseArgs(argv) {
  const options = { action: '', url: DEFAULT_URL, dryRun: false, force: false, stateDir: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--install' || argument === '--remove' || argument === '--status') {
      options.action = argument.slice(2)
    } else if (argument === '--dry-run') options.dryRun = true
    else if (argument === '--force') options.force = true
    else if (argument === '--url') options.url = argv[++index] ?? ''
    else if (argument === '--state-dir') options.stateDir = argv[++index] ?? ''
    else if (argument === '--help' || argument === '-h') options.action = 'help'
    else throw new TypeError(`dsh-vivy-tone: unknown argument "${argument}"`)
  }
  if (!options.url) throw new TypeError('dsh-vivy-tone: --url needs a value')
  return options
}

/** @param {readonly string[]} [argv] */
async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (!options.action || options.action === 'help') {
    process.stdout.write(USAGE)
    return options.action === 'help' ? 0 : 2
  }
  const stateDir = resolveStateDir(options.stateDir)
  const baseUrl = options.url.replace(/\/+$/, '')
  const log = message => process.stdout.write(`${message}\n`)

  if (options.action === 'status') {
    const view = await readPrompts({ baseUrl })
    const overridden = Object.keys(view.config.overrides ?? {})
    log(`revision ${view.revision}；已覆盖 ${overridden.length} 个 part`)
    for (const part of Object.keys(TRANSLATIONS)) {
      const current = view.config.overrides?.[part]
      const state = !current ? '未覆盖（内置英文）' : current.text === TRANSLATIONS[part] ? '已是本包文本' : '有其它覆盖'
      log(`  ${part}: ${state}`)
      const missing = missingPlaceholders(part, TRANSLATIONS[part])
      if (missing.length) log(`    ⚠ 本包文本缺少占位符：${missing.join(', ')}`)
    }
    log(`state dir: ${stateDir}`)
    return 0
  }

  const result = options.action === 'install'
    ? await applyTranslations({
      baseUrl, stateDir, force: options.force, dryRun: options.dryRun, log,
    })
    : await removeTranslations({ baseUrl, stateDir, dryRun: options.dryRun, log })

  if (options.action === 'install' && !result.written?.length) log(`wave ${WAVE}: 没有需要写的 part`)
  return 0
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cli.mjs')) {
  main().then(code => process.exit(code)).catch(error => {
    process.stderr.write(`${error?.name === 'PromptsApiError' ? error.message : (error?.stack ?? String(error))}\n`)
    if (error?.body) process.stderr.write(`  server said: ${error.body}\n`)
    process.exit(1)
  })
}
