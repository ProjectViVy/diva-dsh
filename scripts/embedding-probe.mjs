/**
 * One real round trip against the configured cloud embedding endpoint.
 *
 * Reads the persisted plugin config and the world-gateway embedding slot, then asks
 * for a single vector so the width and the key can be checked before switching the
 * whole plugin over. It never writes to the database and never prints the key.
 *
 *   DASHSCOPE_API_KEY=... node scripts/embedding-probe.mjs [--dim 512] [--json]
 */

import * as fs from 'node:fs'
import { join, resolve } from 'node:path'
import { loadPersistedConfig, resolveConfig } from '../plugins/dsh-mempalace/src/config.mjs'
import { readEmbeddingSlot } from '../plugins/dsh-mempalace/src/store/capability_slot.mjs'
import { CloudEmbeddingService } from '../plugins/dsh-mempalace/src/store/cloud_embedding.mjs'

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const value = name => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const home = resolve(value('--home') || process.env.DSH_HOME || join(process.cwd(), '.artifacts', 'dsh-home'))
const stateDir = join(home, 'mempalace')
const config = resolveConfig({}, fs.existsSync(join(stateDir, 'config.json')) ? loadPersistedConfig(stateDir) : {})

function print(ok, payload) {
  if (flag('--json')) {
    console.log(JSON.stringify({ ok, ...payload }, null, 2))
    return
  }
  if (!ok) {
    console.log(`探测失败：${payload.error}`)
    if (payload.hint) console.log(`建议：${payload.hint}`)
    return
  }
  console.log(`接入点：${payload.endpoint}`)
  console.log(`模型：${payload.model}（${payload.kind}）`)
  console.log(`凭据引用：${payload.authRef}`)
  console.log(`期望维度：${payload.expectedDim}，实际返回：${payload.measuredDim}，用时：${payload.latencyMs}ms`)
  if (payload.expectedDim !== payload.measuredDim) {
    console.log(`注意：维度不一致。把 config.json 的 cloudEmbeddingDim 改成 ${payload.measuredDim} 再切换来源。`)
  } else {
    console.log('结论：维度一致，可把 embeddingSource 设为 cloud。')
  }
}

async function main() {
  const read = readEmbeddingSlot({ home })
  if (!read.ok) {
    print(false, { error: read.error.message, hint: read.error.hint })
    return 1
  }
  const expectedDim = Number(value('--dim') || config.cloudEmbeddingDim)
  const service = new CloudEmbeddingService({
    slot: read.slot,
    dim: expectedDim,
    timeoutMs: config.cloudEmbeddingTimeoutMs,
    batchSize: 1,
    resolveKey: async ref => process.env[ref] ?? null,
    logger: { warn(message) { if (!flag('--json')) console.log(`警告：${message}`) } },
  })
  const probe = await service.probe()
  print(probe.ok, probe)
  if (!probe.ok && probe.code === 'MEMPALACE_EMBEDDING_AUTH') {
    console.log(`在没有环境变量时，也可以在面板的“模型与网络”里点“探测向量接口”。`)
  }
  return probe.ok ? 0 : 1
}

process.exitCode = await main()
