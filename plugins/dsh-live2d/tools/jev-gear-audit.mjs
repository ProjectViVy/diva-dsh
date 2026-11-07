// 逐通道看语义档位落点（"数值上可读吗"），以及哪些通道不该进候选池。
//
// 规则不再自己抄一份：一律走 src/performance-rules.mjs —— 那边的判定与运行时共用，
// 曾经抄一份的代价是审计漏报了 23 个编辑器分隔线通道（它们量程是 [-1,1]，落在连续池里）。
//
// 只读、离线、不需要密钥。默认写一份 JSON 到 --out。
//
// 用法：
//   node plugins/dsh-live2d/tools/jev-gear-audit.mjs
//   node plugins/dsh-live2d/tools/jev-gear-audit.mjs --model DeepSeek --out /tmp/audit.json

import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  GEAR_LADDER, LEGACY_GEAR_LADDER, gearShape, isDiscreteActionParameter, selectPools,
} from '../../../stage-app/src/performance-rules.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..')
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index < 0 ? fallback : args[index + 1]
}

const MODEL_NAME = option('--model', 'DeepSeek')
const KNOWLEDGE_PATH = resolve(option('--knowledge', join(REPO, 'plugins', 'dsh-live2d', 'data', 'knowledge', 'deepseek.json')))
const DSH_HOME = process.env.DSH_HOME ?? join(REPO, '.artifacts', 'dsh-home')
const MODEL_DIR = join(DSH_HOME, 'live2d', 'models', MODEL_NAME)
const OUT = option('--out', join(HERE, 'jev-gear-audit.out.json'))

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))
const findAsset = async (suffix) => {
  const entries = await readdir(MODEL_DIR)
  const hit = entries.find((entry) => entry.toLowerCase().endsWith(suffix))
  if (!hit) throw new Error(`No ${suffix} in ${MODEL_DIR}`)
  return hit
}

const knowledge = await readJson(KNOWLEDGE_PATH)
const knowledgeDir = dirname(KNOWLEDGE_PATH)
const inventory = await readJson(resolve(knowledgeDir, knowledge.inventory ?? '../core-inventory.json'))
const cdi = await readJson(join(MODEL_DIR, await findAsset('.cdi3.json')))
const physics = await readJson(join(MODEL_DIR, await findAsset('.physics3.json')))

const names = Object.fromEntries((cdi.Parameters ?? []).map((entry) => [entry.Id, entry.Name]))
const physicsIds = new Set(
  (physics.PhysicsSettings ?? []).flatMap((setting) => setting.Output ?? []).map((output) => output.Destination.Id),
)
const parameters = inventory.parameters.map((parameter) => ({ ...parameter, name: names[parameter.id] ?? parameter.id }))

const pools = selectPools(parameters, { physicsIds, knowledge })
const declared = knowledge.performanceRules?.declared ?? null
const excluded = new Set(
  declared ? Object.values(declared.excluded ?? {}).flat().map((entry) => entry.id ?? entry) : [],
)

const rows = pools.continuous.map((parameter) => {
  const shape = gearShape(parameter)
  const legacy = gearShape(parameter, LEGACY_GEAR_LADDER)
  return {
    id: parameter.id,
    name: parameter.name,
    min: parameter.min,
    max: parameter.max,
    default: parameter.default,
    sides: shape.sides,
    gears: shape.options,
    smallPctOfSpan: shape.smallPctOfSpan,
    smallPctOfSpanLegacyLadder: legacy.smallPctOfSpan,
    excluded: excluded.has(parameter.id),
  }
})

const switchRows = pools.switches.map((parameter) => ({
  id: parameter.id,
  name: parameter.name,
  default: parameter.default,
  excluded: excluded.has(parameter.id),
}))

const inPool = (row) => !row.excluded
const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  model: MODEL_NAME,
  knowledge: KNOWLEDGE_PATH,
  parameterCount: parameters.length,
  poolCounts: {
    ...pools.counts,
    eligibleSwitch: pools.switches.length,
    eligibleContinuous: pools.continuous.length,
  },
  effectivePools: {
    // 减掉 declared.excluded 之后，判断层真正能碰的通道数
    switches: switchRows.filter(inPool).length,
    continuous: rows.filter(inPool).length,
    excluded: excluded.size,
  },
  gearHealth: {
    continuous: rows.length,
    bothSides: rows.filter((row) => row.sides === 'both').length,
    oneSided: rows.filter((row) => row.sides !== 'both').length,
    noGear: rows.filter((row) => row.sides === 'none').length,
    minSmallPctOfSpan: Math.min(...rows.map((row) => row.smallPctOfSpan)),
    maxSmallPctOfSpan: Math.max(...rows.map((row) => row.smallPctOfSpan)),
    minSmallPctOfSpanLegacyLadder: Math.min(...rows.map((row) => row.smallPctOfSpanLegacyLadder)),
    maxSmallPctOfSpanLegacyLadder: Math.max(...rows.map((row) => row.smallPctOfSpanLegacyLadder)),
    ladder: GEAR_LADDER.map(([key, ratio]) => `${key} ${Math.abs(ratio) * 100}%`),
  },
  soullinkDetectedHandSwitches: [...pools.handIds],
  gestureJoints: pools.jointIds,
  continuous: rows,
  switches: switchRows,
}
await writeFile(OUT, `${JSON.stringify(report, null, 2)}\n`)

const health = report.gearHealth
console.log(`model=${MODEL_NAME} parameters=${parameters.length}`)
console.log(`池子：${JSON.stringify(pools.counts)}`)
console.log(`有效池（减掉排除项）：连续 ${report.effectivePools.continuous} · 开关 ${report.effectivePools.switches} · 排除 ${report.effectivePools.excluded}`)
console.log(`档位：双边 ${health.bothSides} · 单边 ${health.oneSided} · 动不了 ${health.noGear} · small 占量程 ${health.minSmallPctOfSpan}~${health.maxSmallPctOfSpan}%（旧阶梯 ${health.minSmallPctOfSpanLegacyLadder}~${health.maxSmallPctOfSpanLegacyLadder}%）`)
console.log(`连续池里被判成二值开关又被知识纠回来的：${(knowledge.performanceRules?.derived?.forcedContinuous ?? []).length} 个`)
console.log(`-> ${OUT}`)
