// 动作控制的工具层：只是舞台的遥控器，不是舞台本身。
//
// 这里刻意很薄——编译、编排、参数映射、渲染全在独立舞台进程里。
// 理由是研究包划的边界：Mirror（呈现与具身）应当独立演进，
// 宿主只保留「调用」这一件事，而不是把渲染和模型资产焊进自己的构建。
//
// 所以这个文件里没有 compilePlan，没有 MotionEngine，没有模型扫描。
// 只有五个转发函数，和把失败翻译成人话的那点耐心。
import { createStageClient } from './stage-client.mjs'

const EMPTY_OBJECT = { type: 'object', properties: {}, additionalProperties: false }

const text = (value) => ({ content: [{ type: 'text', text: String(value) }] })

/** 计划的结构说明：让它和舞台的编译器对得上，但不受具体模型约束。 */
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    version: { type: 'number', description: '固定写 1' },
    intent: { type: 'string', description: '这段表演想表达什么（一句话，给自己看的）' },
    actions: {
      type: 'array',
      description: '语义动作列表。动作种类与可用名字必须先查 l2d_capabilities / l2d_catalog',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: '动作种类，如 nod / smile / expression / gesture / look / tilt / talk' },
          at: { type: 'number', description: '开始时间（秒）' },
          duration: { type: 'number', description: '持续时间（秒）' },
          strength: { type: 'number', description: '强度 0~1' },
          name: { type: 'string', description: '表情/手势/动作的名字（必须是真实存在的）' },
          count: { type: 'number', description: '重复次数（nod / shake_head / blink 用）' },
          direction: { type: 'string', description: '方向：left / right / up / down / center' },
          layer: { type: 'string', description: 'expression 用的层：overlay / base' },
        },
        required: ['kind'],
        additionalProperties: false,
      },
    },
  },
  required: ['version', 'actions'],
  additionalProperties: false,
}

export function registerLive2dTools(ctx, { home, logger = null } = {}) {
  if (!ctx?.tools || typeof ctx.tools.register !== 'function') {
    throw new Error('l2d 工具需要 tools 服务：请检查插件的 inject 是否包含 tools')
  }
  const client = createStageClient({ home, logger })
  const disposers = []

  /** 统一的失败出口：舞台的拒绝原句已经够清楚，别再包一层术语。 */
  const rejected = (error) => new Error(error?.error ?? String(error))

  function describe(state) {
    if (state.killed === true) return '舞台已按下 Kill Switch：重启舞台进程后才能再演。'
    const hints = []
    if (state.visibility === 'hidden') hints.push('页面在后台，动作可能被浏览器节流')
    if (typeof state.lastSeenMs === 'number' && state.lastSeenMs > 45_000) {
      hints.push(`心跳在 ${Math.round(state.lastSeenMs / 1000)} 秒前，页面可能已关`)
    }
    if (typeof state.stageError === 'string' && state.stageError !== '') hints.push(`舞台报过错误：${state.stageError}`)
    const hint = hints.length === 0 ? '' : `（${hints.join('；')}）`
    const job = state.job ?? null

    if (!state.stageAlive) return `舞台没有响应（最后一次心跳 ${state.lastSeenMs === null ? '从来没有过' : `${Math.round(state.lastSeenMs / 1000)} 秒前`}）：把独立舞台的窗口打开${hint}。`
    if (job === null) return `舞台在线${hint}，没有任务在演（排队 ${state.pending} 个）。`
    if (job.status === 'queued') return `任务 ${job.jobId} 在排队，等页面来取${hint}。`
    if (job.status === 'claimed' || job.status === 'started' || job.status === 'progress') {
      return `任务 ${job.jobId} 正在演：${Math.round((job.progress ?? 0) * 100)}%${hint}。`
    }
    if (job.status === 'completed') return `任务 ${job.jobId} 演完了。`
    if (job.status === 'failed') return `任务 ${job.jobId} 演失败了：${job.error ?? '舞台没说原因'}。`
    if (job.status === 'expired') return `任务 ${job.jobId} 过期了：舞台一直没来取${hint}。`
    if (job.status === 'stalled') return `任务 ${job.jobId} 卡住了：舞台取走后没有回执${hint}。`
    return `任务 ${job.jobId}：${job.status}。`
  }

  // ---- l2d_capabilities ----
  disposers.push(ctx.tools.register({
    name: 'l2d_capabilities',
    description: '读取角色真实可用的动作种类、语义参数、表情、手势与硬规矩。编排前先调用它，不要凭印象写参数名。',
    parameters: EMPTY_OBJECT,
    output: {
      schema: { type: 'object', properties: { text: { type: 'string' } }, additionalProperties: false, required: ['text'] },
      render: (_args, value) => text(value.text),
    },
    async execute() {
      const result = await client.capabilities()
      if (!result.ok) throw rejected(result)
      // 文本由舞台给：编排规矩属于 Mirror，宿主不重写一份。
      return { text: typeof result.text === 'string' && result.text !== '' ? result.text : '舞台没有给出能力说明' }
    },
  }))

  // ---- l2d_catalog ----
  disposers.push(ctx.tools.register({
    name: 'l2d_catalog',
    description: '列出角色真实存在的表情、动作、手势与语义参数名。写 name 之前先查这里，不要编名字。',
    parameters: EMPTY_OBJECT,
    output: {
      schema: {
        type: 'object',
        properties: {
          emotion: { type: 'array', items: { type: 'string' } },
          costume: { type: 'array', items: { type: 'string' } },
          motions: { type: 'array', items: { type: 'string' } },
          gestures: { type: 'array', items: { type: 'string' } },
          text: { type: 'string' },
        },
        additionalProperties: false,
        required: ['text'],
      },
      render: (_args, value) => text(value.text),
    },
    async execute() {
      const result = await client.catalog()
      if (!result.ok) throw rejected(result)
      const emotion = result.expressions?.emotion ?? []
      const costume = result.expressions?.costume ?? []
      const motions = result.motions ?? []
      const gestures = result.gestures ?? []
      const lines = [
        `表情（情绪）：${emotion.join('、') || '无'}`,
        `表情（服装/道具开关，别当情绪用）：${costume.join('、') || '无'}`,
        `动作：${motions.join('、') || '无'}`,
        `手势：${gestures.join('、') || '无'}`,
      ]
      return { emotion, costume, motions, gestures, text: lines.join('\n') }
    },
  }))

  // ---- l2d_compile ----
  disposers.push(ctx.tools.register({
    name: 'l2d_compile',
    description: '只校验计划、不执行：返回轨迹条数、时长与警告，或一句拒绝原因。适合先试再演。',
    parameters: {
      type: 'object',
      properties: { plan: PLAN_SCHEMA },
      required: ['plan'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          duration: { type: 'number' },
          tracks: { type: 'number' },
          error: { type: 'string' },
          text: { type: 'string' },
        },
        additionalProperties: false,
        required: ['ok', 'text'],
      },
      render: (_args, value) => text(value.text),
    },
    async execute(args) {
      const result = await client.compile(args.plan)
      if (!result.ok) return { ok: false, error: result.error, text: `这段演不了：${result.error}` }
      return {
        ok: true,
        duration: result.duration,
        tracks: result.tracks,
        text: `可以演：${result.tracks} 条轨迹，${result.duration} 秒${Array.isArray(result.warnings) && result.warnings.length > 0 ? `；注意：${result.warnings.join('；')}` : ''}。`,
      }
    },
  }))

  // ---- l2d_execute ----
  disposers.push(ctx.tools.register({
    name: 'l2d_execute',
    description: '让角色把一段语义动作计划演出来。返回 jobId 之后，用 l2d_state 追到 progress=1 才算真的演完。舞台没打开会被拒绝。',
    parameters: {
      type: 'object',
      properties: {
        plan: PLAN_SCHEMA,
        requestId: { type: 'string', description: '幂等键：同一个 requestId 重试不会演两遍' },
      },
      required: ['plan'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          jobId: { type: 'string' },
          duration: { type: 'number' },
          tracks: { type: 'number' },
          deduplicated: { type: 'boolean' },
          warning: { type: 'string' },
          error: { type: 'string' },
          text: { type: 'string' },
        },
        additionalProperties: false,
        required: ['ok', 'text'],
      },
      render: (_args, value) => text(value.text),
    },
    async execute(args) {
      const result = await client.perform(args.plan, { requestId: args.requestId })
      if (!result.ok) throw rejected(result)
      const parts = [`已交给舞台：${result.jobId}，${result.tracks} 条轨迹，${result.duration} 秒。用 l2d_state 追到 progress=1 才算演完。`]
      if (result.deduplicated === true) parts.push('（这个 requestId 演过了，没有重演）')

      // 排队成功但页面在后台/刚关：先说清楚，别等人盯着屏幕才发现没动。
      const state = await client.state().catch(() => null)
      if (state?.ok) {
        const hints = []
        if (state.stageAlive === false) hints.push('舞台现在没有响应：打开独立舞台的窗口才会演')
        else if (state.visibility === 'hidden') hints.push('舞台页面在后台：可能被浏览器节流，切到前台最稳')
        if (hints.length > 0) parts.push(`提醒：${hints.join('；')}。`)
      }
      const warnings = Array.isArray(result.warnings) && result.warnings.length > 0 ? `注意：${result.warnings.join('；')}。` : ''
      if (warnings !== '') parts.push(warnings)
      return { ok: true, jobId: result.jobId, duration: result.duration, tracks: result.tracks, deduplicated: result.deduplicated === true, text: parts.join('') }
    },
  }))

  // ---- l2d_state ----
  disposers.push(ctx.tools.register({
    name: 'l2d_state',
    description: '读取舞台是否在线、当前任务演到哪了。progress=1 或 status=completed 才代表演完；expired/stalled 代表不会演了。',
    parameters: EMPTY_OBJECT,
    output: {
      schema: {
        type: 'object',
        properties: {
          stageAlive: { type: 'boolean' },
          jobId: { type: 'string' },
          status: { type: 'string' },
          progress: { type: 'number' },
          killed: { type: 'boolean' },
          text: { type: 'string' },
        },
        additionalProperties: false,
        required: ['stageAlive', 'text'],
      },
      render: (_args, value) => text(value.text),
    },
    async execute() {
      const state = await client.state()
      if (!state.ok) throw rejected(state)
      const job = state.job ?? null
      return {
        stageAlive: state.stageAlive === true,
        killed: state.killed === true,
        ...job === null ? {} : { jobId: job.jobId, status: job.status, progress: job.progress ?? 0 },
        text: describe(state),
      }
    },
  }))

  // ---- l2d_stop ----
  disposers.push(ctx.tools.register({
    name: 'l2d_stop',
    description: '让角色停止当前表演并平滑回到待机。下一轮取指令时生效。',
    parameters: EMPTY_OBJECT,
    output: {
      schema: { type: 'object', properties: { text: { type: 'string' } }, additionalProperties: false, required: ['text'] },
      render: (_args, value) => text(value.text),
    },
    async execute() {
      const result = await client.stop()
      if (!result.ok) throw rejected(result)
      return { text: '已请求停止：角色会平滑回到待机。' }
    },
  }))

  return () => {
    for (const dispose of disposers) {
      try { dispose?.() } catch { /* 已经释放过 */ }
    }
  }
}
