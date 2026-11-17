/* genui 准入闸（DV-UI-021）：dsh-ui 围栏教学、render_ui / validate_dsh_ui、genui 技能
 * 只对 superagent 的主会话、worker 及其子 agent 开放。
 *
 * 这里用假 ctx / 假 agent 直接跑插件，不起宿主：闸门的三个动作（遮蔽段、restrict deny、
 * 注册同名残桩技能）全部是可观察的调用；白名单规则（`orchestrator-*` / `worker-*` 及
 * parentSession 链）用会话 id 造。真实语义（空段被 renderPrompt 滤掉、restrict 真的收窄
 * 工具表、同名技能顶掉全局那条）属于 DSH 自身的契约，靠重启后的运行期验收。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const PLUGIN = new URL('../plugins/dsh-ui-scope/index.js', import.meta.url)
const { apply, isSuperagentAgent, name } = await import(PLUGIN)

/** 所有用例共用的假宿主：工具表可变，事件可以有多个监听者。 */
function scene({ tools = ['render_ui', 'validate_dsh_ui'] } = {}) {
  const agents = new Map()
  const handlers = new Map()
  const live = new Set(tools)
  const warns = []
  const ctx = {
    agents: { list: () => [...agents.values()], get: id => agents.get(id) },
    tools: { get: tool => live.has(tool) ? { name: tool } : undefined },
    systemPrompt: { getSectionOrder: section => section === 'STRUCTURED_OUTPUT' ? 1234 : 0 },
    logger: { warn: (...args) => warns.push(args) },
    on: (event, handler) => { handlers.set(event, [...(handlers.get(event) ?? []), handler]) },
  }
  /** 造一条 agent；返回它被闸门碰过的东西。 */
  function agent(id, parentSession) {
    const touched = { sections: [], restricts: [], skills: [] }
    const session = { id, header: parentSession === undefined ? {} : { parentSession } }
    const record = {
      id,
      session,
      ctx: {
        systemPrompt: { section: part => touched.sections.push(part) },
        tools: { restrict: filter => touched.restricts.push(filter) },
        inject: (_deps, run) => run({ skills: { register: registration => touched.skills.push(registration) } }),
      },
    }
    agents.set(id, record)
    return { record, touched }
  }
  const emit = (event, payload) => { for (const handler of handlers.get(event) ?? []) handler(payload) }
  return { ctx, agent, agents, handlers, emit, live, warns }
}

/** 跑一遍插件，再触发一条 `agent/created`，返回那条 agent 被碰过的东西。 */
function gateCreated(target, options) {
  const env = scene(options)
  apply(env.ctx)
  env.agents.set(target.record.id, target.record)
  env.emit('agent/created', { agent: target.record })
  return { env, touched: target.touched }
}

test('插件名与注入保持契约形状', () => {
  assert.equal(name, 'dsh-ui-scope')
})

test('普通会话三处一起拦：空段遮蔽、deny 两个工具、同名残桩技能', () => {
  const target = scene().agent('sess-plain')
  const { touched, env } = gateCreated(target)
  assert.deepEqual(touched.sections, [{ name: 'genui:fence', order: 1234, text: '' }])
  assert.deepEqual(touched.restricts, [{ deny: ['render_ui', 'validate_dsh_ui'] }])
  assert.deepEqual(touched.skills, [{
    name: 'genui',
    description: 'not available in this session: genui is limited to dsh-superagent',
    content: '',
    source: 'runtime',
    invocation: { modelInvocable: false, userInvocable: false },
  }])
  assert.equal(env.warns.length, 0)
})

test('superagent 主会话与 worker 都放行，一个动作都不做', () => {
  for (const id of ['orchestrator-1a2b3c', 'worker-ticket-7']) {
    const target = scene().agent(id)
    const { touched } = gateCreated(target)
    assert.deepEqual({ sections: touched.sections, restricts: touched.restricts, skills: touched.skills },
      { sections: [], restricts: [], skills: [] }, `${id} 不应被闸`)
  }
})

test('parentSession 链顶峰到 worker 的子 agent、孙 agent 一并放行', () => {
  const env = scene()
  const { record: worker } = env.agent('worker-ticket-7')
  const { record: child } = env.agent('sub-child', worker.session.id)
  const { record: grandchild, touched: grandTouched } = env.agent('sub-grandchild', child.session.id)
  apply(env.ctx)
  env.emit('agent/created', { agent: grandchild })
  assert.deepEqual(grandTouched.sections, [], '孙 agent 通过 child 追到 worker，应放行')
  assert.equal(isSuperagentAgent(env.ctx.agents, child), true)
  assert.equal(isSuperagentAgent(env.ctx.agents, grandchild), true)
  assert.equal(isSuperagentAgent(env.ctx.agents, worker), true)
})

test('普通会话的子 agent 照样拦，断链与超深度也拦', () => {
  const env = scene()
  const { record: plain } = env.agent('sess-plain')
  const { record: child } = env.agent('sub-of-plain', plain.session.id)
  apply(env.ctx)
  assert.equal(isSuperagentAgent(env.ctx.agents, child), false)

  // 断链：父会话不在注册表里（例如已经 dispose），不能靠猜放行。
  const orphan = scene()
  const { record: lost } = orphan.agent('sub-orphan', 'worker-gone')
  apply(orphan.ctx)
  assert.equal(isSuperagentAgent(orphan.ctx.agents, lost), false)

  // 超深度：10 层之外才是 worker，超出 8 层就不再往上追。
  const deep = scene()
  let parent = 'worker-far'
  let deepest
  for (let level = 0; level < 10; level++) {
    const made = deep.agent(`sub-${level}`, parent)
    parent = made.record.session.id
    deepest = made
  }
  apply(deep.ctx)
  assert.equal(isSuperagentAgent(deep.ctx.agents, deepest.record), false)
})

test('启动时扫一遍已经在跑的 agent，重复 created 不重复登记', () => {
  const env = scene()
  const { record, touched } = env.agent('sess-before-plugin')
  apply(env.ctx)
  assert.equal(touched.sections.length, 1, '启动扫描应已拦下这条早于插件创建的会话')
  env.emit('agent/created', { agent: record })
  assert.equal(touched.sections.length, 1, '同一条 agent 不该被重复遮蔽')
  assert.equal(touched.restricts.length, 1)
  assert.equal(touched.skills.length, 1)
})

test('genui 工具晚注册：先不 deny，tools/change 时补上', () => {
  const target = scene({ tools: [] }).agent('sess-early')
  const { env, touched } = gateCreated(target, { tools: [] })
  assert.deepEqual(touched.restricts, [], '工具还没注册时调 restrict 会抛，应先跳过')
  env.live.add('render_ui')
  env.emit('tools/change')
  assert.deepEqual(touched.restricts, [{ deny: ['render_ui'] }], '先到的那一个先 deny')
  env.live.add('validate_dsh_ui')
  env.emit('tools/change')
  assert.deepEqual(touched.restricts, [{ deny: ['render_ui'] }, { deny: ['validate_dsh_ui'] }], '后到的补上，不再重复 deny')
  assert.equal(env.warns.length, 0)
})

test('agent 走掉后不再挂在待办里', () => {
  const env = scene({ tools: [] })
  const { record } = env.agent('sess-gone')
  apply(env.ctx)
  env.emit('agent/created', { agent: record })
  env.emit('agent/disposed', { agent: record })
  env.live.add('render_ui')
  env.live.add('validate_dsh_ui')
  env.emit('tools/change')
})

test('闸门挂不上只记 warn，不拖垮会话', () => {
  const env = scene()
  const { record } = env.agent('sess-broken')
  record.ctx.systemPrompt.section = () => { throw new Error('systemPrompt is gone') }
  apply(env.ctx)
  env.emit('agent/created', { agent: record })
  assert.equal(env.warns.length, 1)
  assert.match(String(env.warns[0]), /could not gate/)
  assert.match(String(env.warns[0]), /sess-broken/)
})
