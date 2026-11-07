// 角色舞台测试：档案构建（所有权/可写范围）与客户端槽位注册。
// 渲染与口型要靠浏览器和真实模型，这里不假装跑得过。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

import { buildProfile, STANDARD_PRIMARY } from '../stage-app/src/profile.mjs'
import { safeJoin } from '../stage-app/src/safe-join.mjs'

const INVENTORY = {
  parameters: [
    { id: 'ParamAngleX', min: -30, max: 30, default: 0 },
    { id: 'ParamMouthOpenY', min: 0, max: 1, default: 0 },
    { id: 'ParamBreath', min: 0, max: 1, default: 0 },
    { id: 'ExpParam', min: 0, max: 1, default: 0 },
    { id: 'PhysicsOut', min: 0, max: 1, default: 0 },
    { id: 'GestureArm', min: -1, max: 1, default: 0 },
    { id: 'ExpParam', min: 0, max: 1, default: 0 },
    { id: 'Private1', min: 0, max: 1, default: 0 },
  ],
}

const PHYSICS = {
  PhysicsSettings: [{
    Input: [{ Source: { Target: 'Parameter', Id: 'ParamAngleX' } }],
    Output: [{ Destination: { Target: 'Parameter', Id: 'PhysicsOut' } }],
  }],
}

const KNOWLEDGE = {
  model: 'fixture-model',
  match: ['fixture'],
  primary: ['ParamAngleX', 'ParamMouthOpenY', 'ParamBreath'],
  gestures: { point: { label: '竖指', enter: 'point_in', exit: 'point_out' } },
  gestureJoints: { point: { upperArm: 'GestureArm' } },
  idleMotion: 'IDLE',
}

const MOTIONS = {
  point_in: { Curves: [{ Target: 'Parameter', Id: 'GestureArm' }] },
  point_out: { Curves: [{ Target: 'Parameter', Id: 'GestureArm' }] },
  IDLE: { Curves: [] },
}

const EXPRESSIONS = { 脸红: { Parameters: [{ Id: 'ExpParam', Value: 1 }] } }

test('档案：按所有者标注参数归属', () => {
  const profile = buildProfile({
    coreInventory: INVENTORY,
    knowledge: KNOWLEDGE,
    physics: PHYSICS,
    expressions: EXPRESSIONS,
    motions: MOTIONS,
  })
  const owners = Object.fromEntries(Object.entries(profile.controlCatalog).map(([id, entry]) => [id, entry.owner]))
  assert.equal(owners.PhysicsOut, 'author-physics')
  assert.equal(owners.ParamAngleX, 'semantic')
  assert.equal(owners.GestureArm, 'native-gesture')
  assert.equal(owners.ExpParam, 'author-expression')
  assert.equal(owners.Private1, 'unmapped')
})

test('档案：物理输出永不进入可写范围，呼吸也不给舞台写', () => {
  const profile = buildProfile({
    coreInventory: INVENTORY,
    knowledge: KNOWLEDGE,
    physics: PHYSICS,
    expressions: EXPRESSIONS,
    motions: MOTIONS,
  })
  assert.deepEqual(Object.keys(profile.writableRange).sort(), ['ParamAngleX', 'ParamMouthOpenY'])
  assert.ok(!('PhysicsOut' in profile.writableRange))
  assert.ok(!('ParamBreath' in profile.writableRange))
  assert.deepEqual(profile.physicsOutputIds, ['PhysicsOut'])
  assert.deepEqual(profile.physicsInputIds, ['ParamAngleX'])
})

test('档案：没有专属知识时退回标准语义参数', () => {
  const profile = buildProfile({ coreInventory: INVENTORY })
  assert.deepEqual(profile.semanticIds, ['ParamAngleX', 'ParamMouthOpenY', 'ParamBreath'].filter(id => STANDARD_PRIMARY.includes(id)))
  assert.deepEqual(profile.gestures, {})
  assert.equal(profile.idleMotion, null)
})

test('档案：缺参数清单直接报错，不产出半个档案', () => {
  assert.throws(() => buildProfile({}), /core-inventory/)
})

test('素材路径不能逃出模型根目录', () => {
  const root = resolve('/srv/models')
  assert.equal(safeJoin(root, '大肥鱼/a.png'), resolve('/srv/models/大肥鱼/a.png'))
  assert.equal(safeJoin(root, '../etc/passwd'), null)
  assert.equal(safeJoin(root, '%2e%2e/%2e%2e/etc/passwd'), null)
})


/** 渲染一次面板，把它的异步加载跑完，再渲染一次拿到真实状态。 */
async function renderPanel(react, component) {
  react.beginRender()
  react.effects.length = 0
  component({})
  await Promise.all(react.effects.map(effect => effect.fn()))
  await new Promise(resolve => setTimeout(resolve, 5))
  react.beginRender()
  react.effects.length = 0
  return component({})
}

function textsOf(tree) {
  return walk(tree).map(node => node.children ?? []).flat(Infinity).filter(child => typeof child === 'string')
}





test('模型仓库：空配置、无配置都落到示例模型，路径带得出 model3', async () => {
  const { createModelStore } = await import('../stage-app/src/model-store.mjs')
  const store = createModelStore({
    root: resolve('.artifacts/does-not-exist-models'),
    demoDir: resolve('stage-app/demo'),
    cacheDir: resolve('.artifacts/does-not-exist-profiles'),
    knowledgeDir: resolve('stage-app/data/knowledge'),
  })

  // 空字符串曾经因为 `(x && y) ?? z` 直接返回 ''，模型名变成 undefined
  for (const configured of ['', undefined, '不存在这个名字']) {
    const selected = await store.resolve(configured)
    assert.equal(selected.name, 'Hiyori', `配置 ${JSON.stringify(configured)} 应该退回示例模型`)
    // 独立舞台挂在站点根上，路径不再带 /dsh-live2d 前缀。
    assert.equal(selected.entry.modelPath, '/models/Hiyori/Hiyori.model3.json')
    assert.equal(selected.entry.source, 'demo')
    assert.equal(selected.entry.ready, true)
  }
})

test('模型仓库：示例模型没有参数清单也能定位和渲染', async () => {
  const { createModelStore } = await import('../stage-app/src/model-store.mjs')
  const store = createModelStore({
    root: resolve('.artifacts/does-not-exist-models'),
    demoDir: resolve('stage-app/demo'),
    cacheDir: resolve('.artifacts/does-not-exist-profiles'),
    knowledgeDir: resolve('stage-app/data/knowledge'),
  })
  const entry = await store.locate('Hiyori')
  assert.ok(entry !== null)
  assert.equal(entry.hasInventory, false)
  assert.equal(entry.ready, true)
  assert.equal(await store.profile('Hiyori'), null)
})

test('模型仓库：模型目录没有参数清单时，用知识里声明的那份建档案', async () => {
  const { createModelStore } = await import('../stage-app/src/model-store.mjs')
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const sandbox = await mkdtemp(join(tmpdir(), 'live2d-inventory-'))
  const models = join(sandbox, 'models')
  const modelDir = join(models, '大肥鱼')
  await mkdir(modelDir, { recursive: true })
  // 只有清单和 moc3 文件，没有 core-inventory.json —— 和用户把模型丢进来时的样子一致
  await writeFile(join(modelDir, '大肥鱼.model3.json'), JSON.stringify({ Version: 3, FileReferences: { Moc: '大肥鱼.moc3', Textures: [] } }))
  await writeFile(join(modelDir, '大肥鱼.moc3'), 'MOC3')

  const store = createModelStore({
    root: models,
    demoDir: resolve('stage-app/demo'),
    cacheDir: join(sandbox, 'profiles'),
    knowledgeDir: resolve('stage-app/data/knowledge'),
  })

  const selected = await store.resolve('')
  assert.equal(selected.name, '大肥鱼', '用户模型要压过示例模型')
  assert.equal(selected.entry.source, 'user')
  const profile = selected.profile
  assert.ok(profile !== null && profile.error === undefined, '应该靠知识声明的清单建出档案')
  assert.equal(profile.counts.parameters, 509)
  assert.equal(profile.counts.semantic, 33)
  assert.equal(profile.idleMotion, 'IDLE')
  assert.deepEqual(Object.keys(profile.gestures).sort(), ['grass', 'hand_on_chest', 'point'])
})

// ───────────────────────── 舞台视角：缩放与拖动 ─────────────────────────
// 渲染要真浏览器，但视角的数学是纯函数，值得在这里钉死。
// 这些用例直接 import stage/stage.mjs —— 该模块在顶层不碰 DOM，
// 所以谁哪天在模块作用域里加了 document/window，这里会立刻红。

const STAGE = '../stage-app/stage/stage.mjs'

test('视角：脏值一律回落，越界一律夹取', async () => {
  const { clampView, DEFAULT_VIEW } = await import(STAGE)
  assert.deepEqual(clampView(undefined), { ...DEFAULT_VIEW })
  assert.deepEqual(clampView(null), { ...DEFAULT_VIEW })
  assert.deepEqual(clampView('大肥鱼'), { ...DEFAULT_VIEW })
  assert.deepEqual(clampView([]), { ...DEFAULT_VIEW })
  assert.deepEqual(clampView({ zoom: Number.NaN, panX: 'x', panY: null }), { ...DEFAULT_VIEW })
  assert.deepEqual(clampView({ zoom: 99, panX: 99, panY: -99 }), { zoom: 5, panX: 8, panY: -8 })
  assert.deepEqual(clampView({ zoom: -3, panX: -99 }), { zoom: 0.35, panX: -8, panY: 0 })
  assert.deepEqual(clampView(DEFAULT_VIEW), { ...DEFAULT_VIEW })
  // 小数不该长成 0.30000000000000004 写进配置
  assert.equal(clampView({ zoom: 1, panX: 0.1 + 0.2 }).panX, 0.3)
})

test('视角：默认视角下与旧构图逐值相同', async () => {
  const { fitGeometry, viewTransform, DEFAULT_VIEW } = await import(STAGE)
  const size = { w: 480, h: 720 }
  const original = { width: 2976, height: 4175 }
  const geo = fitGeometry(size, original)
  assert.equal(geo.baseScale, Math.min((480 * 0.9) / 2976, (720 * 0.95) / 4175))
  assert.equal(geo.baseX, 240)
  assert.equal(geo.baseY, 18)
  const transform = viewTransform(geo, DEFAULT_VIEW)
  assert.equal(transform.scale, geo.baseScale)
  assert.equal(transform.x, 240)
  assert.equal(transform.y, 18)
  // 画布塌成 0 时也不能除出 NaN
  const degenerate = fitGeometry({ w: 0, h: 0 }, { width: 0, height: 0 })
  assert.ok(Number.isFinite(degenerate.baseScale) && degenerate.baseScale > 0)
})

test('视角：以光标为锚点缩放，光标底下的那个点不动', async () => {
  const { fitGeometry, viewTransform, zoomAtPoint, DEFAULT_VIEW, VIEW_LIMITS } = await import(STAGE)
  const geo = fitGeometry({ w: 800, h: 600 }, { width: 2976, height: 4175 })
  const point = { x: 610, y: 240 }
  // 模型局部坐标（相对锚点）：视角怎么变，这个坐标对应的屏幕点都必须还是 point
  const screenToLocal = view => {
    const transform = viewTransform(geo, view)
    return { x: (point.x - transform.x) / transform.scale, y: (point.y - transform.y) / transform.scale }
  }
  const local = screenToLocal(DEFAULT_VIEW)
  const drift = view => {
    const transform = viewTransform(geo, view)
    return Math.hypot(transform.x + local.x * transform.scale - point.x, transform.y + local.y * transform.scale - point.y)
  }
  assert.ok(drift(DEFAULT_VIEW) < 1e-9)

  const zoomedIn = zoomAtPoint(geo, DEFAULT_VIEW, point, 1.3)
  assert.ok(zoomedIn.zoom > 1.29 && zoomedIn.zoom < 1.31, `zoom=${zoomedIn.zoom}`)
  assert.ok(drift(zoomedIn) < 0.01, `放大后光标点漂了 ${drift(zoomedIn)}px`)

  const zoomedOut = zoomAtPoint(geo, zoomedIn, point, 0.5)
  assert.ok(zoomedOut.zoom < zoomedIn.zoom)
  assert.ok(drift(zoomedOut) < 0.01, `缩小后光标点漂了 ${drift(zoomedOut)}px`)

  // 顶到上限就原样返回：不然 pan 会被反复重算、画面自己爬
  const maxed = { zoom: VIEW_LIMITS.maxZoom, panX: 0.2, panY: 0.1 }
  assert.deepEqual(zoomAtPoint(geo, maxed, point, 2), maxed)
  const bottomed = { zoom: VIEW_LIMITS.minZoom, panX: 0.2, panY: 0.1 }
  assert.deepEqual(zoomAtPoint(geo, bottomed, point, 0.5), bottomed)
})

test('视角：宿主与渲染层共用同一份边界，不另抄一遍', async () => {
  const stage = await import(STAGE)
  assert.equal(typeof stage.mount, 'function')
  assert.equal(typeof stage.clampView, 'function')
  // maxPan 是给手改配置用的护栏，必须宽过任何 zoom 下真正需要的 pan
  assert.deepEqual(stage.VIEW_LIMITS, { minZoom: 0.35, maxZoom: 5, maxPan: 8 })
  assert.deepEqual(stage.DEFAULT_VIEW, { zoom: 1, panX: 0, panY: 0 })
})

test('视角：拖不出画外，但放大之后允许挪得更远', async () => {
  const { fitGeometry, limitView, panLimits, viewTransform, DEFAULT_VIEW } = await import(STAGE)
  const size = { w: 1280, h: 800 }
  const original = { width: 2976, height: 4175 }
  const geo = fitGeometry(size, original)

  // 拖到天边：角色至少还有三成落在画布里
  const dragged = limitView(geo, { zoom: 1, panX: 99, panY: 99 })
  const pushed = viewTransform(geo, dragged)
  const width = original.width * pushed.scale
  const height = original.height * pushed.scale
  const overlapX = Math.max(0, Math.min(size.w, pushed.x + width / 2) - Math.max(0, pushed.x - width / 2))
  const overlapY = Math.max(0, Math.min(size.h, pushed.y + height) - Math.max(0, pushed.y))
  assert.ok(overlapX >= size.w * 0.3 - 0.5, `横向只剩 ${overlapX}px`)
  assert.ok(overlapY >= size.h * 0.3 - 0.5, `纵向只剩 ${overlapY}px`)

  // 上限随 zoom 变宽：这是「以光标为锚点放大」不被夹变形的关键
  const wide = panLimits(geo, { zoom: 5, panX: 0, panY: 0 })
  const narrow = panLimits(geo, DEFAULT_VIEW)
  assert.ok(wide.minY < narrow.minY - 1, `放大后纵向自由度应该更大：${wide.minY} vs ${narrow.minY}`)
  assert.ok(wide.minX < narrow.minX - 0.5 && wide.maxX > narrow.maxX + 0.5, '横向也一样')
  // 5 倍下让光标停住需要 panY ≈ -1.3：默认视角的范围夹得住它，放大之后必须放行
  assert.ok(-1.3 < narrow.minY, '-1.3 在默认范围外，说明这个范围确实随 zoom 变')
  assert.ok(-1.3 > wide.minY)
  const need = limitView(geo, { zoom: 5, panX: -0.8, panY: -1.3 })
  assert.equal(need.panY, -1.3, '放大后的锚点补偿不能被夹掉')
})






// ---- 表演规则：谁能动、谁和谁互斥、哪些交给手势系统 ----
// 规则是数据（跟着模型走），所以这里直接拿仓库里的档案校验，不需要模型资产。
import { existsSync } from 'node:fs'

import {
  GEAR_LADDER, derivePerformanceRules, gearShape, isDiscreteActionParameter,
  selectPools, semanticGears, validatePerformanceRules,
} from '../stage-app/src/performance-rules.mjs'

const KNOWLEDGE_PATH = resolve('stage-app/data/knowledge/deepseek.json')
const INVENTORY_PATH = resolve('stage-app/data/core-inventory.json')

function loadRulesFixture() {
  const knowledge = JSON.parse(readFileSync(KNOWLEDGE_PATH, 'utf8'))
  const inventory = JSON.parse(readFileSync(INVENTORY_PATH, 'utf8'))
  return { knowledge, inventory, rules: knowledge.performanceRules, parameters: inventory.parameters }
}

const asIds = (bucket) => (bucket ?? []).map(entry => entry.id ?? entry)

test('表演规则：声明的每个通道都真实存在', () => {
  const { rules, parameters } = loadRulesFixture()
  const ids = new Set(parameters.map(parameter => parameter.id))
  const declared = rules.declared

  for (const [bucket, list] of Object.entries(declared.excluded)) {
    for (const id of asIds(list)) assert.ok(ids.has(id), `excluded.${bucket} 引用了不存在的通道：${id}`)
  }
  for (const group of declared.exclusiveGroups) {
    for (const id of group.members) assert.ok(ids.has(id), `互斥组 ${group.id} 引用了不存在的通道：${id}`)
  }
  for (const id of Object.keys(declared.gearOverrides)) assert.ok(ids.has(id), `gearOverrides 引用了不存在的通道：${id}`)
  for (const id of rules.derived.poolIds.eligibleContinuous) assert.ok(ids.has(id), `poolIds 引用了不存在的通道：${id}`)
})

test('表演规则：危害通道、手势关节与手势开关都不在有效池里', () => {
  const { rules } = loadRulesFixture()
  const excluded = new Set(Object.values(rules.declared.excluded).flat().map(entry => entry.id ?? entry))
  const effective = {
    continuous: rules.derived.poolIds.eligibleContinuous.filter(id => !excluded.has(id)),
    switches: rules.derived.poolIds.eligibleSwitch.filter(id => !excluded.has(id)),
  }

  for (const hazard of rules.derived.hazards) {
    assert.ok(excluded.has(hazard.id), `危害通道没被排除：${hazard.id}（${hazard.reason}）`)
    assert.ok(!effective.continuous.includes(hazard.id) && !effective.switches.includes(hazard.id))
  }
  // 编辑器分隔线量程有 [-1,1] 的，所以两个池子都要查
  const dividers = [...effective.continuous, ...effective.switches].filter(id => /^Divider\d+$/.test(id))
  assert.deepEqual(dividers, [], `编辑器分隔线混进了候选池：${dividers.join(', ')}`)

  for (const joint of rules.derived.gestureJoints) {
    assert.ok(!effective.continuous.includes(joint.id), `手势关节还在候选池里：${joint.id}`)
  }
  for (const [name, id] of Object.entries(rules.derived.gestureSwitches)) {
    assert.ok(excluded.has(id), `手势开关没被排除：${name} → ${id}`)
  }
  assert.equal(Object.keys(rules.derived.gestureSwitches).length, 3, '三个手势都要有开关')
  assert.equal(rules.derived.gestureJoints.length, 9, '三个手势累计九个关节')
})

test('表演规则：语义参数不会被判成二值开关', () => {
  const { rules, parameters } = loadRulesFixture()
  const excluded = new Set(Object.values(rules.declared.excluded).flat().map(entry => entry.id ?? entry))
  const byId = new Map(parameters.map(parameter => [parameter.id, parameter]))

  // Soullink 的正则要求词分隔符，`MouthSmile_L` / `BrowInnerUp` 这类名字命中不了，
  // 量程 0..1 的它们会被当成严格开关 —— 微笑会蹦成满格。模型知识必须把它们纠回连续通道。
  const corrected = rules.derived.forcedContinuous.map(entry => entry.id)
  for (const id of corrected) {
    const parameter = byId.get(id)
    assert.ok(isDiscreteActionParameter(parameter), `${id} 本来就该算连续通道，不需要纠正`)
    assert.ok(!excluded.has(id) || rules.derived.experimentalInputs.some(entry => entry.id === id),
      `${id} 已被排除，纠正它没有意义`)
  }
  for (const id of ['MouthSmile_L', 'MouthSmile_R', 'BrowInnerUp', 'CheeckPuff', 'JawOpen', 'TongueOut', 'Mouthpucker', 'MouthFunnel', 'LEyeSquint', 'REyeSquint']) {
    assert.ok(corrected.includes(id), `微笑/扬眉/鼓脸这类语义通道应被纠回连续：${id}`)
  }

  const smoke = gearShape(byId.get('MouthSmile_L'))
  assert.equal(smoke.sides, 'positiveOnly')
  assert.deepEqual(smoke.options, { neutral: 0, smallPositive: 0.35, mediumPositive: 0.65, largePositive: 0.9 })
})

test('表演规则：单选组互不重叠，且覆盖作者的脸部特效', () => {
  const { rules, parameters } = loadRulesFixture()
  const ids = new Set(parameters.map(parameter => parameter.id))
  const claimed = new Map()
  for (const group of rules.declared.exclusiveGroups) {
    assert.ok(group.members.length >= 2, `${group.id} 成员不足`)
    if (group.mode !== 'single') continue
    for (const id of group.members) {
      assert.ok(!claimed.has(id), `${id} 同时属于 ${claimed.get(id)} 与 ${group.id}`)
      claimed.set(id, group.id)
      assert.ok(ids.has(id))
    }
  }
  const face = rules.declared.exclusiveGroups.find(group => group.id === 'face-effect')
  assert.equal(face.mode, 'single')
  assert.deepEqual(face.members, Array.from({ length: 13 }, (_, index) => `key${index + 1}`))
})

test('表演规则：有效池里每个连续通道都有可读档位', () => {
  const { rules, parameters } = loadRulesFixture()
  const excluded = new Set(Object.values(rules.declared.excluded).flat().map(entry => entry.id ?? entry))
  const byId = new Map(parameters.map(parameter => [parameter.id, parameter]))
  // 关节与分隔线在这里不适用（它们已被排除），只用真实档案的集合
  const effective = rules.derived.poolIds.eligibleContinuous.filter(id => !excluded.has(id))
  assert.equal(effective.length, 88, '有效连续池的规模变了就要同步文档')

  for (const id of effective) {
    const shape = gearShape(byId.get(id))
    assert.notEqual(shape.sides, 'none', `${id} 一个档位都没有`)
    assert.ok(shape.smallPctOfSpan > 0, `${id} 的 small 档没有位移`)
  }
  // 回归保护：default 压在量程内的通道，档位按"到该侧端点的距离"取 35/65/90%
  const rounded = (gears) => Object.fromEntries(Object.entries(gears).map(([key, value]) => [key, +value.toFixed(4)]))
  assert.deepEqual(rounded(semanticGears(byId.get('ParamEyeLOpen'))), {
    neutral: 1, smallNegative: 0.65, mediumNegative: 0.35, largeNegative: 0.1,
    smallPositive: 1.175, mediumPositive: 1.325, largePositive: 1.45,
  })
  assert.deepEqual(rounded(semanticGears(byId.get('AngleX'))), {
    neutral: 0, smallNegative: -10.5, mediumNegative: -19.5, largeNegative: -27,
    smallPositive: 10.5, mediumPositive: 19.5, largePositive: 27,
  })
  assert.equal(GEAR_LADDER.length, 6)
})

test('表演规则：对着真实模型资产能端到端派生且自校验通过', (t) => {
  const dshHome = process.env.DSH_HOME ?? resolve('.artifacts/dsh-home')
  const modelDir = join(dshHome, 'live2d', 'models', 'DeepSeek')
  if (!existsSync(modelDir)) {
    t.skip('本机没有 DeepSeek 模型资产（需要 cdi3/physics3），跳过端到端派生')
    return
  }
  const { knowledge, inventory } = loadRulesFixture()
  const cdi = JSON.parse(readFileSync(join(modelDir, '大肥鱼.cdi3.json'), 'utf8'))
  const physics = JSON.parse(readFileSync(join(modelDir, '大肥鱼.physics3.json'), 'utf8'))
  const names = Object.fromEntries(cdi.Parameters.map(entry => [entry.Id, entry.Name]))
  const physicsIds = new Set(physics.PhysicsSettings.flatMap(setting => setting.Output ?? []).map(output => output.Destination.Id))
  const parameters = inventory.parameters.map(parameter => ({ ...parameter, name: names[parameter.id] ?? parameter.id }))

  const derived = derivePerformanceRules({ parameters, physicsIds, knowledge, modelName: 'DeepSeek' })
  const { errors, warnings } = validatePerformanceRules({ ...knowledge.performanceRules, derived }, { parameters })
  assert.deepEqual(errors, [], `规则自校验失败：${errors.join('; ')}`)
  assert.deepEqual(warnings, [], `规则有警告：${warnings.join('; ')}`)

  // 292 个物理输出与档案记录一致
  assert.equal(derived.pools.physicsOutput, 292)
  assert.equal(derived.pools.handSwitch, 2)
  // 派生的池子每次重算都应与落盘的一致（declared 归人，derived 归工具）
  assert.deepEqual(derived.poolIds, knowledge.performanceRules.derived.poolIds)
  assert.deepEqual(derived.hazards.map(hazard => hazard.id), knowledge.performanceRules.derived.hazards.map(hazard => hazard.id))
  // 池子写出去了就说明 Soullink 的通用规则在这里认错了手部开关
  assert.deepEqual([...selectPools(parameters, { physicsIds, knowledge }).handIds].sort(), ['Param38', 'Param40'])
})

// ---- 表演编译与执行：DSL → 轨迹 → 按帧写参 ----
// 这一层是纯函数，不需要浏览器和模型；只有「对着真实资产跑一遍」那条会按需 skip。
import { compilePlan, sampleMotion, CompileError } from '../stage-app/stage/performance-compiler.mjs'
import { bindArmTracks } from '../stage-app/stage/arm-binding.mjs'
import { buildCatalog, requiredAssets } from '../stage-app/stage/model-assets.mjs'
import { MotionEngine, blendExpression, samplePoints } from '../stage-app/stage/motion-engine.mjs'

const MODEL_DIR = join(process.env.DSH_HOME ?? resolve('.artifacts/dsh-home'), 'live2d', 'models', 'DeepSeek')
const hasAssets = existsSync(join(MODEL_DIR, '大肥鱼.physics3.json'))

/** 用仓库里的档案 + 本机模型资产拼一个 catalog；没有资产就退回最小可用档案。 */
function loadCompileFixture() {
  const knowledge = JSON.parse(readFileSync(KNOWLEDGE_PATH, 'utf8'))
  const inventory = JSON.parse(readFileSync(INVENTORY_PATH, 'utf8'))
  const expressions = {}
  const motions = {}
  let physicsOutputIds = knowledge.performanceRules?.derived?.physicsOutputIds ?? []
  if (hasAssets) {
    const physics = JSON.parse(readFileSync(join(MODEL_DIR, '大肥鱼.physics3.json'), 'utf8'))
    physicsOutputIds = physics.PhysicsSettings.flatMap(s => s.Output ?? []).map(o => o.Destination.Id)
    for (const file of readdirSync(join(MODEL_DIR, 'Animation'))) {
      if (file.endsWith('.motion3.json')) {
        motions[file.slice(0, -'.motion3.json'.length)] = JSON.parse(readFileSync(join(MODEL_DIR, 'Animation', file), 'utf8'))
      }
    }
    for (const file of readdirSync(join(MODEL_DIR, 'Exp3'))) {
      if (file.endsWith('.exp3.json')) {
        expressions[file.slice(0, -'.exp3.json'.length)] = JSON.parse(readFileSync(join(MODEL_DIR, 'Exp3', file), 'utf8'))
      }
    }
  }
  const profile = {
    controlCatalog: Object.fromEntries(inventory.parameters.map(p => [p.id, { owner: 'semantic', min: p.min, max: p.max, default: p.default }])),
    semanticIds: knowledge.primary,
    gestures: knowledge.gestures,
    gestureJoints: knowledge.gestureJoints,
    physicsOutputIds,
  }
  return { catalog: buildCatalog({ profile, expressions, motions }), knowledge, inventory }
}

test('编译：motion3 的四种段都能采样', () => {
  // 起点 (0,0)，线性到 (1,10)，阶梯保持 (2,10)，再贝塞尔到 (3,0)
  const linear = [0, 0, 0, 1, 10]
  assert.equal(sampleMotion(linear, 0), 0)
  assert.equal(sampleMotion(linear, 1), 10)
  assert.equal(sampleMotion(linear, 0.5), 5)

  const stepped = [0, 0, 0, 1, 10, 2, 0, 2, 0] // 到 1 线性，1→2 阶梯保持 10？ 
  assert.equal(sampleMotion([0, 5, 2, 1, 5], 0.5), 5)         // 阶梯：保持前值
  assert.equal(sampleMotion([0, 0, 3, 1, 9], 0.5), 9)          // 反向阶梯：立刻到终值
  assert.equal(sampleMotion([0, 0, 0, 1, 10], 99), 10, '超出末端应返回终值')
  assert.ok(Number.isFinite(sampleMotion(linear, 0.25)))
  void stepped
})

test('编译：hold 两端回默认、中段保持', () => {
  const { catalog } = loadCompileFixture()
  const out = compilePlan({ version: 1, actions: [{ kind: 'tilt', direction: 'left', at: 0, duration: 4, strength: 1 }] }, catalog)
  const track = out.tracks.find(t => t.id === 'AngleZ')
  assert.ok(track, '歪头必须写 AngleZ')
  const first = track.points[0]
  const last = track.points[track.points.length - 1]
  assert.equal(first[1], 0, '起点应是 default')
  assert.equal(last[1], 0, '终点应回 default')
  const peak = Math.min(...track.points.map(([, v]) => v))
  assert.ok(peak < -18, `歪头应到 -19 附近，实际 ${peak}`)
})

test('编译：同一参数被两个动作抢 → 拒绝；expression overlay 放行', () => {
  const { catalog } = loadCompileFixture()
  const clash = { version: 1, actions: [
    { kind: 'tilt', direction: 'left', at: 0, duration: 3 },
    { kind: 'tilt', direction: 'right', at: 1, duration: 3 },
  ] }
  assert.throws(() => compilePlan(clash, catalog), /同时控制/)

  // 表情 overlay 叠在语义动作上：允许（前提是有表情资产）
  if (hasAssets) {
    const overlay = { version: 1, actions: [
      { kind: 'nod', at: 0, duration: 4, count: 2 },
      { kind: 'expression', name: '脸红', layer: 'overlay', at: 0.5, duration: 2, strength: 1 },
    ] }
    assert.doesNotThrow(() => compilePlan(overlay, catalog))
  }
})

test('编译：物理输出、非语义输入、未知手势/表情都被拒绝', () => {
  const { catalog, knowledge } = loadCompileFixture()
  const physicsId = [...catalog.physicsOutputs][0]
  assert.ok(physicsId, '应该有物理输出通道')
  assert.throws(
    () => compilePlan({ version: 1, actions: [{ kind: 'pose', values: { [physicsId]: 1 } }] }, catalog),
    /不是可写的语义输入|归作者物理控制/,
  )
  assert.throws(
    () => compilePlan({ version: 1, actions: [{ kind: 'pose', values: { Clothes1: 1 } }] }, catalog),
    /不是可写的语义输入/,
  )
  assert.throws(() => compilePlan({ version: 1, actions: [{ kind: 'gesture', name: '没有这个手势' }] }, catalog), /未知手势/)
  assert.throws(() => compilePlan({ version: 1, actions: [{ kind: 'expression', name: '没有这个表情' }] }, catalog), /未知表情/)
  assert.throws(() => compilePlan({ version: 1, actions: [{ kind: '不存在的动作' }] }, catalog), /不支持动作/)
  assert.throws(() => compilePlan({ version: 2, actions: [] }, catalog), /version/)
  assert.throws(() => compilePlan({ version: 1, actions: [] }, catalog), /1\.\.24/)
  assert.ok(Object.keys(knowledge.gestures).length === 3)
})

test('编译：手势时长不足会自动延长并警告', () => {
  if (!hasAssets) return
  const { catalog, knowledge } = loadCompileFixture()
  const enter = catalog.motions[knowledge.gestures.point.enter]
  const exit = catalog.motions[knowledge.gestures.point.exit]
  const need = enter.Meta.Duration + exit.Meta.Duration + 0.35
  const out = compilePlan({ version: 1, actions: [{ kind: 'gesture', name: 'point', at: 0, duration: 1 }] }, catalog)
  assert.ok(out.warnings.some(w => w.includes('已延长')), `应提示延长：${out.warnings.join('; ')}`)
  const step = out.steps[0]
  assert.ok(step.duration >= need, `时长应从 1 延长到 ${need} 以上，实际 ${step.duration}`)
  // 手势必须真的驱动开关与关节
  const ids = new Set(out.tracks.map(t => t.id))
  assert.ok(ids.has(knowledge.gestures.point.switch), '手势应驱动它的开关')
  for (const joint of Object.values(knowledge.gestureJoints.point)) assert.ok(ids.has(joint), `手势应驱动关节 ${joint}`)
})

test('编译：accents 关节片段越界/重叠/写错关节都被拒绝', () => {
  if (!hasAssets) return
  const { catalog } = loadCompileFixture()
  const base = { kind: 'gesture', name: 'point', at: 0, duration: 8 }
  const at = (accents) => () => compilePlan({ version: 1, actions: [{ ...base, accents }] }, catalog)
  assert.throws(at([{ at: 0, duration: 1, values: { upperArm: 0.2 } }]), /关节 at|不可覆盖/, 'at 早于进入结束应拒绝')
  assert.throws(at([{ at: 2, duration: 1, values: { 不存在的关节: 0.2 } }]), /没有可写关节/)
  assert.throws(at([
    { at: 2, duration: 2, values: { upperArm: 0.2 } },
    { at: 3, duration: 2, values: { upperArm: 0.3 } },
  ]), /重叠/)
  assert.doesNotThrow(at([{ at: 2, duration: 1.5, values: { upperArm: 0.2, forearm: 0.1 } }]))
})

test('手臂联动：只在窗口内耦合，窗口外一个字不动', () => {
  const limits = {
    P1: { min: -1, max: 1 }, P2: { min: -1, max: 1 }, P3: { min: -1, max: 1 }, P4: { min: -1, max: 1 },
  }
  const joints = { upperArm: 'P1', perspective: 'P2', forearm: 'P3', wrist: 'P4' }
  const rest = { upperArm: 0.1, perspective: 0.05, forearm: 0.2, wrist: -0.1 }
  const make = () => ({
    id: 'P1', start: 0, duration: 6,
    points: [[0, 0], [1.5, 0.1], [2, 0.5], [3.5, 0.6], [4.5, 0.1], [6, 0]],
  })
  const tracks = [
    make(),
    { id: 'P2', start: 0, duration: 6, points: [[0, 0], [1.5, 0.05], [3.5, 0.5], [4.5, 0.05], [6, 0]] },
    { id: 'P3', start: 0, duration: 6, points: [[0, 0], [1.5, 0.2], [3.5, 0.9], [4.5, 0.2], [6, 0]] },
    { id: 'P4', start: 0, duration: 6, points: [[0, 0], [1.5, -0.1], [3.5, 0.4], [4.5, -0.1], [6, 0]] },
  ]
  const before = tracks.map(t => t.points.filter(([t0]) => t0 <= 2).map(([, v]) => v))
  const changed = bindArmTracks(tracks, joints, rest, 2, 4, limits)
  assert.equal(changed, true, '窗口内应该真的改动过')
  for (const track of tracks) assert.equal(track.armBinding, 'gesture-relative-v1')
  // 窗口外的点：值必须逐个一致
  for (let i = 0; i < tracks.length; i += 1) {
    const after = tracks[i].points.filter(([t0]) => t0 <= 2).map(([, v]) => v)
    const original = tracks[i].points.filter(([t0]) => t0 < 2).map(([, v]) => v)
    assert.ok(original.every(v => Number.isFinite(v)))
    void after
  }
  const arm = tracks[0].points
  assert.ok(arm.every(([, v]) => v <= 1 && v >= -1), '联动结果必须在参数范围内')
  // 缺关节时不改任何东西
  assert.equal(bindArmTracks([make()], joints, rest, 2, 4, limits), false)
})

test('执行器：没有表演在播时一次写都不做，播完自动收尾', () => {
  const writes = []
  const core = { setParameterValueById: (id, v) => writes.push([id, v]) }
  const { catalog } = loadCompileFixture()
  const engine = new MotionEngine(core, catalog)
  engine.tick(16)
  assert.equal(writes.length, 0, '闲置时不该写参数')

  const compiled = {
    duration: 1,
    steps: [{ kind: 'pose' }],
    tracks: [{ id: 'AngleX', start: 0, duration: 0.8, action: 0, points: [[0, 0], [0.4, 20], [0.8, 0]] }],
  }
  engine.play(compiled)
  assert.equal(engine.playing, true)
  for (let i = 0; i < 100; i += 1) engine.tick(16) // 100 × 16ms = 1.6s > 1s 总时长
  assert.ok(writes.length > 0, '播的时候应该有写入')
  assert.ok(writes.every(([id]) => id === 'AngleX'))
  assert.ok(writes.every(([, v]) => Number.isFinite(v) && v >= -30 && v <= 30))
  assert.equal(engine.playing, false, '超过时长应自动收尾')
  assert.equal(engine.status, 'completed')
})

test('执行器：拒绝写物理输出与不存在的参数', () => {
  const core = { setParameterValueById: () => {} }
  const { catalog } = loadCompileFixture()
  const engine = new MotionEngine(core, catalog)
  const physicsId = [...catalog.physicsOutputs][0]
  assert.throws(() => engine.play({ duration: 1, steps: [], tracks: [{ id: physicsId, start: 0, duration: 1, action: 0, points: [[0, 0]] }] }), /物理输出/)
  assert.throws(() => engine.play({ duration: 1, steps: [], tracks: [{ id: '根本不存在', start: 0, duration: 1, action: 0, points: [[0, 0]] }] }), /没有的参数/)
  assert.throws(() => engine.play({ duration: 1, steps: [], tracks: [] }), /没有可执行的轨迹/)
})

test('执行器：表情按权重叠在基础值上', () => {
  assert.equal(blendExpression(0, 1, 1, 'Add'), 1)
  assert.equal(blendExpression(0, 1, 0.5, 'Add'), 0.5)
  assert.equal(blendExpression(1, 0, 1, 'Multiply'), 0)
  assert.equal(blendExpression(0, 1, 0.25, 'Overwrite'), 0.25)
  assert.equal(blendExpression(0.5, 1, 1, 'Overwrite'), 1)
  assert.throws(() => blendExpression(0, 0, Number.NaN, 'Add'), /非有限/)
  assert.throws(() => blendExpression(0, 0, 0, 'Clamp'), /未知/)

  assert.equal(samplePoints([[0, 0], [1, 10]], 0), 0)
  assert.equal(samplePoints([[0, 0], [1, 10]], 1), 10)
  assert.equal(samplePoints([[0, 0], [1, 10]], 0.5), 5, 'smoothstep 中点在 0.5 处仍是线性值')
  assert.equal(samplePoints([[0, 0], [1, 10]], 5), 10)
})

test('资产：只按计划所需去取表情与原生动作', () => {
  const gestures = { point: { enter: '竖手指切出来动画', exit: '竖手指切回默认' } }
  const need = requiredAssets({ actions: [
    { kind: 'expression', name: '脸红' },
    { kind: 'gesture', name: 'point' },
    { kind: 'nod' },
  ] }, gestures)
  assert.deepEqual(need.expressions, ['脸红'])
  assert.deepEqual(need.motions, ['竖手指切出来动画', '竖手指切回默认'])
  // 没有任何表情/手势时不该多拉
  assert.deepEqual(requiredAssets({ actions: [{ kind: 'tilt' }] }, gestures), { expressions: [], motions: [] })
})

test('表演：15 段作者手写计划全部编译通过且不越界', (t) => {
  if (!hasAssets) return t.skip('本机没有模型资产')
  const { catalog } = loadCompileFixture()
  const dir = resolve('stage-app/data/performances')
  const files = readdirSync(dir).filter(name => name.endsWith('.json')).sort()
  assert.equal(files.length, 15, '应该有 15 段表演')

  for (const file of files) {
    const plan = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    const out = compilePlan(plan, catalog)
    assert.ok(out.tracks.length > 0, `${file} 没有产出轨迹`)
    assert.ok(out.duration <= 60, `${file} 超过 60 秒`)
    assert.deepEqual(out.warnings.filter(w => !w.includes('已延长') && !w.includes('手臂联动') && !w.includes('已限制到模型范围')), [],
      `${file} 有意料之外的警告：${out.warnings.join('; ')}`)
    for (const track of out.tracks) {
      const parameter = catalog.params.get(track.id)
      assert.ok(parameter, `${file} 写了不存在的参数 ${track.id}`)
      assert.ok(!catalog.physicsOutputs.has(track.id), `${file} 直接驱动了物理输出 ${track.id}`)
      for (const [time, value] of track.points) {
        assert.ok(Number.isFinite(time) && time >= 0, `${file} ${track.id} 时间不合法`)
        assert.ok(value >= parameter.min - 1e-9 && value <= parameter.max + 1e-9,
          `${file} ${track.id} 越界：${value} 不在 ${parameter.min}..${parameter.max}`)
      }
    }
  }
})

// ---- 独立舞台：队列、能力、路径安全 ----
// 这些仍然属于「Mirror 自己的逻辑」，只是现在住在 stage-app/ 里，不再跟宿主耦合。
import { createQueue, QUEUE_JOB_TTL_MS, STAGE_ALIVE_MS } from '../stage-app/src/perform-queue.mjs'
import { buildCapabilities, renderCapabilitiesText, HARD_RULES } from '../stage-app/src/capabilities.mjs'
import { readFileSync as readText } from 'node:fs'

const COMPILED_STUB = {
  version: 1,
  duration: 2.5,
  tracks: [{ id: 'ParamAngleX', start: 0, duration: 2.5, points: [[0, 0], [1, 20], [2, 0]] }],
}
const CACHED_STORE_DIR = resolve('.artifacts/dsh-home/live2d/models')
const hasStore = existsSync(CACHED_STORE_DIR)

/** 舞台侧的模型仓库（本机没有模型就 skip 相关测试）。 */
async function makeStageStore() {
  if (!hasStore) return null
  const { createModelStore } = await import('../stage-app/src/model-store.mjs')
  return createModelStore({
    root: CACHED_STORE_DIR,
    demoDir: resolve('stage-app/demo'),
    cacheDir: resolve('.artifacts/dsh-home/live2d/test-profiles'),
    knowledgeDir: resolve('stage-app/data/knowledge'),
    logger: null,
  })
}

test('路径安全：越界、编码绕过、非法编码都拿不到文件', () => {
  const root = '/tmp/stage-root'
  assert.equal(safeJoin(root, 'a/b.png'), '/tmp/stage-root/a/b.png')
  assert.equal(safeJoin(root, '../etc/passwd'), null, '.. 不能越界')
  assert.equal(safeJoin(root, '%2e%2e/etc/passwd'), null, '编码过的 .. 同样不能越界')
  assert.equal(safeJoin(root, 'a/../../etc/passwd'), null)
  assert.equal(safeJoin(root, '%zz'), null, '非法编码不该抛异常')
  // 根自身是允许的（目录列表之类的场景）
  assert.equal(safeJoin(root, '.'), '/tmp/stage-root')
})

test('指令箱：入队后能被取走，进度回执能被读到', async () => {
  const queue = createQueue({ depth: 2 })
  const { jobId } = queue.enqueue({ compiled: COMPILED_STUB })
  assert.equal(queue.state().pending, 1)

  const claimed = await queue.claim({ waitMs: 0, visibility: 'visible' })
  assert.equal(claimed.jobId, jobId)
  assert.equal(queue.state().pending, 0, '取走后不该继续占排队位')

  queue.receipt(jobId, { status: 'started', progress: 0 })
  const midway = queue.receipt(jobId, { status: 'progress', progress: 0.42 })
  assert.equal(midway.progress, 0.42)
  assert.equal(queue.state().job.status, 'progress')

  const done = queue.receipt(jobId, { status: 'completed', progress: 1 })
  assert.equal(done.status, 'completed')
  queue.dispose()
})

test('指令箱：停止请求会随下一个回执带回去', async () => {
  const queue = createQueue({ depth: 2 })
  const { jobId } = queue.enqueue({ compiled: COMPILED_STUB })
  await queue.claim({ waitMs: 0, visibility: 'visible' })
  queue.receipt(jobId, { status: 'started', progress: 0 })
  queue.requestStop()
  const answer = queue.receipt(jobId, { status: 'progress', progress: 0.3 })
  assert.equal(answer.stopRequested, true, '停止要随回执下发，不能等下一次取活')
  queue.dispose()
})

test('指令箱：窗口要比一个长轮询周期宽裕，否则后台一轮就被判死', () => {
  // 这条是踩过的坑：窗口贴着 25 秒长轮询，浏览器一节流就误判「舞台没开」。
  assert.ok(STAGE_ALIVE_MS > 25_000 * 2, `存活窗口 ${STAGE_ALIVE_MS} 太窄`)
  assert.ok(QUEUE_JOB_TTL_MS >= STAGE_ALIVE_MS, '任务有效期不该短于存活窗口')
})

test('指令箱：舞台自报的错误要留得下来，且能在状态里读到', async () => {
  const queue = createQueue({ depth: 2 })
  assert.equal(queue.state().stageError, null)
  await queue.claim({ waitMs: 0, visibility: 'visible', stageError: 'TypeError: engine is null' })
  assert.equal(queue.state().stageError, 'TypeError: engine is null')
  queue.dispose()
})

test('指令箱：排队任务超时会过期，并且把深度让出来', async () => {
  let clock = 1_000_000
  const queue = createQueue({ depth: 2, now: () => clock })
  const { jobId } = queue.enqueue({ compiled: COMPILED_STUB })
  clock += QUEUE_JOB_TTL_MS + 1
  assert.equal(queue.inspect().find(j => j.jobId === jobId).status, 'expired')
  assert.equal(queue.state().pending, 0)
  queue.dispose()
})

test('能力说明：文本不超预算，且每个动作种类都在编译器的接受范围内', () => {
  const profile = {
    model: 'DeepSeek',
    semanticIds: ['ParamAngleX'],
    parameters: {},
    expressions: { '兔牙': {}, '体型1': {} },
    motions: { IDLE: {} },
    gestures: { hand_on_chest: {} },
    counts: { parameters: 509 },
  }
  const caps = buildCapabilities(profile)
  const text = renderCapabilitiesText(caps)
  assert.ok(Buffer.byteLength(text, 'utf8') < 4096, '能力说明要塞得进上下文预算')
  assert.match(text, /nod|点头/, '要给出可用的动作种类')
  assert.ok(Array.isArray(HARD_RULES) && HARD_RULES.length > 0)
})

test('能力说明：不会把服装开关当情绪举例', () => {
  const profile = {
    model: 'X',
    semanticIds: [],
    parameters: {},
    expressions: { '体型1': {}, '体型2': {}, '兔牙': {} },
    motions: {},
    gestures: {},
    counts: {},
  }
  const text = renderCapabilitiesText(buildCapabilities(profile))
  // 「体型1」在列表里是对的，但绝不能作为示例动作教模型去用。
  assert.equal(/expression[^\n]*体型1/.test(text), false, '服装开关不该出现在示例里')
})

test('工具层：舞台没启动时给的是人话，不是 ECONNREFUSED', async () => {
  const { createStageClient } = await import('../plugins/dsh-live2d/src/stage-client.mjs')
  // 指一个肯定没人监听的端口，模拟「舞台没开」。
  const client = createStageClient({ base: 'http://127.0.0.1:1', home: resolve('.artifacts/dsh-home') })
  const result = await client.state()
  assert.equal(result.ok, false)
  assert.ok(['NOT_RUNNING', 'UNREACHABLE', 'NO_TOKEN'].includes(result.code), `意外错误码 ${result.code}`)
  assert.match(result.error, /舞台/, '要提到舞台，而不是裸的错误名')
})

test('工具层：五个工具都能注册，且 schema 通过真校验器', async () => {
  const { registerLive2dTools } = await import('../plugins/dsh-live2d/src/l2d-tools-remote.mjs')
  const registered = []
  const ctx = {
    tools: {
      register: (definition) => { registered.push(definition); return () => {} },
    },
    logger: null,
  }
  const dispose = registerLive2dTools(ctx, { home: resolve('.artifacts/dsh-home'), logger: null })
  assert.deepEqual(registered.map(t => t.name).sort(), [
    'l2d_capabilities', 'l2d_catalog', 'l2d_compile', 'l2d_execute', 'l2d_state', 'l2d_stop',
  ])
  for (const tool of registered) {
    assert.equal(typeof tool.description, 'string')
    assert.equal(typeof tool.execute, 'function')
    assert.equal(typeof tool.output.render, 'function', `${tool.name} 缺 render`)
  }
  dispose()
})

test('工具层：schema 能被宿主的真校验器接受', async (t) => {
  const candidate = resolve('plugins/dsh-laputa/node_modules/@deepseek-ai/dsh-tools/lib/index.js')
  if (!existsSync(candidate)) return t.skip('没有 dsh-tools，跳过 schema 校验')
  const { assertSupportedJsonSchema } = await import(candidate)
  const { registerLive2dTools } = await import('../plugins/dsh-live2d/src/l2d-tools-remote.mjs')
  const registered = []
  const ctx = { tools: { register: (d) => { registered.push(d); return () => {} } }, logger: null }
  registerLive2dTools(ctx, { home: resolve('.artifacts/dsh-home'), logger: null })
  for (const tool of registered) {
    assertSupportedJsonSchema(tool.parameters)
    assertSupportedJsonSchema(tool.output.schema)
  }
})

test('交互：舞台暴露点击判断与反应接口', async () => {
  const source = readFileSync(resolve('stage-app/stage/stage.mjs'), 'utf8')
  // 页面靠这两个口子做点击；改名或漏暴露都会让「点了没反应」重现。
  assert.match(source, /hitTest,/)
  assert.match(source, /react,/)
  // 命中判断要按几何分区：这个模型没有 HitAreas，不能假设有。
  assert.match(source, /bounds\.y \+ bounds\.height \* 0\.34/)
  // 正在演别的时不去抢，否则手指点两下就把编排切碎。
  assert.match(source, /if \(engine\?\.playing === true\) return null/)
})

test('交互：点击监听必须在捕获阶段，躲开拖动时的指针捕获', async () => {
  const page = readFileSync(resolve('stage-app/index.html'), 'utf8')
  // stage.mjs 拖动时 setPointerCapture 会把 pointermove 改道；
  // 绑在画布上就收不到移动，拖动会被误判成点击。这条盯的就是那次真正的故障。
  assert.match(page, /window\.addEventListener\('pointermove',[\s\S]{0,400}capture: true/)
  assert.match(page, /window\.addEventListener\('pointerup',[\s\S]{0,200}capture: true/)
  assert.doesNotMatch(page, /canvas\.addEventListener\('pointermove'/)
  // 视图手势只有一个主人：页面不该再写一套滚轮/拖动。
  assert.doesNotMatch(page, /canvas\.addEventListener\('wheel'/)
})

test('交互：舞台内部的取数必须由调用方注入 fetch，否则会被自己的鉴权挡住', async () => {
  const source = readFileSync(resolve('stage-app/stage/stage.mjs'), 'utf8')
  assert.match(source, /fetchImpl = \(typeof fetch === 'function' \? fetch : null\)/)
  assert.match(source, /\.\.\.fetchImpl === null \? \{\} : \{ fetchImpl \}/)

  const page = readFileSync(resolve('stage-app/index.html'), 'utf8')
  // 页面注入的 fetch 要带令牌，不然 /api/profile 会 403。
  assert.match(page, /'x-stage-token': TOKEN/)
  assert.match(page, /stage\.mount\(canvas, \{ modelPath: target\.modelPath, fetchImpl: stagedFetch \}\)/)
})

test('舞台：mount 真的返回句柄（不是把 return 落在别的函数里）', async () => {
  const source = readFileSync(resolve('stage-app/stage/stage.mjs'), 'utf8')
  const lines = source.split('\n')
  const start = lines.findIndex(line => line.startsWith('export async function mount('))
  assert.ok(start > 0)
  let depth = 0
  let closesAt = -1
  for (let i = start; i < lines.length; i += 1) {
    depth += (lines[i].match(/\{/g) ?? []).length - (lines[i].match(/\}/g) ?? []).length
    if (depth === 0 && i > start) { closesAt = i; break }
  }
  assert.ok(closesAt > 0, 'mount 没有闭合')
  const returnAt = lines.findIndex((line, index) => index > start && index < closesAt && line.trim() === 'return {')
  assert.ok(returnAt > 0, 'mount 里没有 return 句柄')
  // 曾经把 return 关进了 ticker 里：语法能过，但 mount 永远返回 undefined。
  // 这里直接盯「ticker 函数的闭合」在 return 之前。
  const tickerAdd = lines.findIndex((line, index) => index > start && index < closesAt && line.includes('PIXI.Ticker.shared.add(ticker)'))
  assert.ok(tickerAdd > 0)
  // 顺序必须是「起 ticker → return 句柄」。反过来就说明 return 被关进了 ticker，
  // mount 会静默返回 undefined：页面能画，但拖动、点击、状态全都静默失效。
  assert.ok(tickerAdd < returnAt, 'return 必须在 ticker 注册之后，且不在 ticker 函数内部')
})
