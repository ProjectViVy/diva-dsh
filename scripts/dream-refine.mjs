#!/usr/bin/env node
/** Domain CLI for an ordinary Superagent Executor's existing shell tool. */
import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callComponent } from '../plugins/_shared/ipc.mjs'

export async function main(argv = process.argv.slice(2), { home = process.env.DSH_HOME, call = callComponent } = {}) {
  const [command, ...args] = argv
  const options = {}
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith('--') || !args[i + 1]) throw new Error('Expected --request ID --ticket ID [--file plan.json]')
    options[args[i].slice(2)] = args[i + 1]
  }
  if (!home || !isAbsolute(home)) throw new Error('Absolute DSH_HOME is required')
  if (!['status', 'claim', 'evidence', 'baseline', 'plan', 'execute'].includes(command)) throw new Error('Commands: status, claim, evidence, baseline, plan --file plan.json, execute')
  if (command !== 'status' && (!options.ticket || !options.request)) throw new Error('--request and --ticket are required; use your actual owning Ticket')
  const body = command === 'status' ? {} : { requestId: options.request, ticketId: options.ticket }
  if (command === 'plan') {
    if (!options.file) throw new Error('plan requires --file JSON path')
    body.plan = JSON.parse(await readFile(resolve(options.file), 'utf8'))
  }
  return call({ home, name: 'evolution', path: `/dream/${command}`, body, timeoutMs: 130000 })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch(error => { process.stderr.write(`${error.code ?? 'DREAM_ERROR'}: ${error.message}\n`); process.exitCode = 1 })
}
