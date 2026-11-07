// 从真实模型资产派生「表演规则」的机械那一半，并给声明的另一半起个草稿。
//
// 只读模型资产与档案，不联外网、不需要密钥。默认只打印摘要；--write 才落盘。
//
// 用法：
//   node plugins/dsh-live2d/tools/derive-performance-rules.mjs
//   node plugins/dsh-live2d/tools/derive-performance-rules.mjs --write
//   node plugins/dsh-live2d/tools/derive-performance-rules.mjs --model DeepSeek --knowledge plugins/dsh-live2d/data/knowledge/deepseek.json
//
// 落盘规则：**derived 归工具、declared 归人**。
// - derived 每次重算覆盖（池子、手势关节、危害、档位健康度）。
// - declared 只在缺失时起草，之后一律不动（互斥组、外观排除、档位覆写都是判断，不是推导）。

import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { derivePerformanceRules, validatePerformanceRules } from '../../../stage-app/src/performance-rules.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..')
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index < 0 ? fallback : args[index + 1]
}
const has = (name) => args.includes(name)

const MODEL_NAME = option('--model', 'DeepSeek')
const KNOWLEDGE_PATH = resolve(option('--knowledge', join(REPO, 'plugins', 'dsh-live2d', 'data', 'knowledge', 'deepseek.json')))
const DSH_HOME = process.env.DSH_HOME ?? join(REPO, '.artifacts', 'dsh-home')
const MODEL_DIR = join(DSH_HOME, 'live2d', 'models', MODEL_NAME)

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

const derived = derivePerformanceRules({ parameters, physicsIds, knowledge, modelName: MODEL_NAME })
const rules = { schemaVersion: 1, derived, declared: knowledge.performanceRules?.declared ?? draftDeclared(derived) }

const { errors, warnings } = validatePerformanceRules(rules, { parameters })

console.log(`model=${MODEL_NAME} knowledge=${KNOWLEDGE_PATH}`)
console.log(`池子：${JSON.stringify(derived.pools)}`)
console.log(`档位：${JSON.stringify(derived.gearHealth)}`)
console.log(`Soullink 认出的手部开关：${derived.soullinkDetectedHandSwitches.join(', ') || '(无)'}`)
console.log(`手势开关：${JSON.stringify(derived.gestureSwitches)}`)
console.log(`手势关节 ${derived.gestureJoints.length} 个：${derived.gestureJoints.map((joint) => joint.id).join(', ')}`)
console.log(`危害 ${derived.hazards.length} 个、动画触发器 ${derived.animationTriggers.length} 个、外观候选 ${derived.appearanceCandidates.length} 个、default=1 开关 ${derived.defaultOnSwitches.length} 个`)
for (const group of derived.families) console.log(`  互斥候选 ${group.id}(${group.mode}) ${group.members.length} 个：${group.members.join(' ')}`)
for (const error of errors) console.log(`ERROR ${error}`)
for (const warning of warnings) console.log(`WARN  ${warning}`)

if (has('--write')) {
  knowledge.performanceRules = rules
  await writeFile(KNOWLEDGE_PATH, `${JSON.stringify(knowledge, null, 2)}\n`)
  console.log(`-> 已写入 ${KNOWLEDGE_PATH}`)
} else {
  console.log('（未落盘；加 --write 才写）')
}

if (errors.length) process.exitCode = 1

/**
 * 起草 declared：把工具发现的候选摆成待确认的形状，人再删改。
 * 这里出现的每一条都是"建议"，不是结论 —— 尤其是外观排除与互斥组成员。
 */
function draftDeclared(derived) {
  const entry = (item) => ({ id: item.id, name: item.name })
  const hazardsMatching = (pattern) => derived.hazards.filter((hazard) => pattern.test(hazard.id)).map(entry)
  return {
    excluded: {
      editorOnly: hazardsMatching(/^Divider\d+$/u),
      idleTrigger: hazardsMatching(/^IDLE$/u),
      experimental: derived.experimentalInputs.map(entry),
      gestureSystem: [
        ...Object.entries(derived.gestureSwitches).map(([name, id]) => ({ id, name: `手势 ${name}` })),
        ...derived.gestureJoints.map((joint) => ({ id: joint.id, name: joint.name })),
      ],
      appearance: derived.appearanceCandidates.map(entry),
      animationTrigger: derived.animationTriggers.map(entry),
    },
    exclusiveGroups: derived.families.map((group) => ({ ...group, members: [...group.members] })),
    gearOverrides: Object.fromEntries(derived.animationTriggers
      .filter((trigger) => !(trigger.min === 0 && trigger.max === 1))
      .map((trigger) => [trigger.id, { mode: 'step', reason: trigger.reason }])),
    notes: ['declared 是判断不是推导：工具只在缺失时起草，之后不覆盖'],
  }
}
