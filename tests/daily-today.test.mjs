/* 「今天的界面」宿主半边：worker 写文件 → 右栏来取。
 *
 * 2026-11-15 深夜改结构（主人「先两条链路保留一下」）：一条 `GET /dsh-daily/api/today`
 * 同时下发 `cards`（结构化卡）、`html`（旧整页链路，可空）、`history`（更早的日子，
 * 倒序、只含有卡的日子）。这些用例只打 handler，不起真服务器：用假 ctx 把 webServer
 * 的 register 抓住，再按 (method, path) 直接调 handler。写法照
 * `tests/superagent-reset.test.mjs`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const API = '/dsh-daily/api'
const TODAY = '2026-11-15'

/** 一个装了 today/ 的空 DSH_HOME。 */
function scene() {
  const root = mkdtempSync(join(tmpdir(), 'daily-today-'))
  mkdirSync(join(root, 'today'), { recursive: true })
  return root
}

/** 往 today/ 里放一天：cards 走结构化、html 走旧链路，都按需。 */
function writeDay(root, date, { cards, html } = {}) {
  if (cards !== undefined) {
    writeFileSync(join(root, 'today', date + '.json'), JSON.stringify({ cards }), 'utf8')
  }
  if (html !== undefined) writeFileSync(join(root, 'today', date + '.html'), html, 'utf8')
}

function answer() {
  const res = {
    status: 0,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(text) {
      this.body = JSON.parse(text)
    },
  }
  return res
}

function request(method, url, options = {}) {
  return {
    method,
    url,
    headers: { host: '127.0.0.1:3082', ...(options.headers ?? {}) },
  }
}

/** 用假上下文把 host 半边挂起来，返回可直接调用的 handler。 */
async function hostBridge(root) {
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = root
  const routes = []
  const logs = []
  const ctx = {
    logger: () => ({ info: (message) => logs.push(message), warn: (message) => logs.push(message) }),
    inject(deps, callback) {
      assert.deepEqual(deps, ['webServer', 'connection'])
      callback({
        effect(run) {
          run()
        },
        get(name) {
          if (name === 'webServer') return { register: (route) => { routes.push(route); return () => {} } }
          return { requestRejection: () => undefined }
        },
      })
    },
  }
  const module = await import('../plugins/dsh-daily/index.js')
  module.apply(ctx)
  assert.equal(routes.length, 1)
  return {
    routes,
    logs,
    async call(method, path, options) {
      const res = answer()
      await routes[0].handler(request(method, path, options), res)
      return res
    },
    restore() {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    },
  }
}

/** 每个用例都用这一套：造场景、起 handler、跑完清干净。 */
async function withScene(run) {
  const root = scene()
  const bridge = await hostBridge(root)
  try {
    await run({ root, bridge })
  } finally {
    bridge.restore()
    rmSync(root, { recursive: true, force: true })
  }
}

test('路由挂在 /dsh-daily/api 前缀上，只依赖 webServer 与 connection', async () => {
  await withScene(async ({ bridge }) => {
    assert.equal(bridge.routes[0].kind, 'prefix')
    assert.equal(bridge.routes[0].path, API)
  })
})

test('worker 写了 today/<今天>.json：200 把卡片交出去，日期不进卡里', async () => {
  await withScene(async ({ root, bridge }) => {
    writeDay(root, TODAY, { cards: [{ title: '九点的评审', body: '记得带上三页纸。' }] })
    const res = await bridge.call('GET', `${API}/today?date=${TODAY}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.ok, true)
    assert.equal(res.body.date, TODAY)
    assert.deepEqual(res.body.cards, [{ title: '九点的评审', body: '记得带上三页纸。' }])
    assert.equal(res.body.html, null, '没有旧链路那页就说 null')
    assert.deepEqual(res.body.history, [], '今天不算自己的历史')
    assert.equal(res.headers['cache-control'], 'no-store', '不许缓存：worker 可能刚改过')
  })
})

test('旧链路没删：today/<今天>.html 照旧从 html 字段交出去', async () => {
  await withScene(async ({ root, bridge }) => {
    writeDay(root, TODAY, { html: '<h1>今天三件事</h1>' })
    const res = await bridge.call('GET', `${API}/today?date=${TODAY}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.html, '<h1>今天三件事</h1>')
    assert.deepEqual(res.body.cards, [], '没有 json 就是没有卡，不是错误')
  })
})

test('两条链路的文件同时存在：一个响应里都带，右栏切开关就够了', async () => {
  await withScene(async ({ root, bridge }) => {
    writeDay(root, TODAY, { cards: [{ title: '卡', body: '内容' }], html: '<p>整页</p>' })
    const res = await bridge.call('GET', `${API}/today?date=${TODAY}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.cards.length, 1)
    assert.equal(res.body.html, '<p>整页</p>')
  })
})

test('还没人写：200 + 空数组，而且不当成故障记日志', async () => {
  await withScene(async ({ bridge }) => {
    const res = await bridge.call('GET', `${API}/today?date=${TODAY}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.ok, true)
    assert.deepEqual(res.body.cards, [])
    assert.equal(res.body.html, null)
    assert.deepEqual(res.body.history, [])
    assert.deepEqual(bridge.logs, [], '没有文件不是错，别刷日志')
  })
})

test('坏 JSON 当没有：卡片空、不报错、不记日志', async () => {
  await withScene(async ({ root, bridge }) => {
    writeFileSync(join(root, 'today', TODAY + '.json'), '{cards: [坏掉的', 'utf8')
    const res = await bridge.call('GET', `${API}/today?date=${TODAY}`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.cards, [])
    assert.deepEqual(bridge.logs, [])
  })
})

test('形状不对只丢自己：cards 不是数组 / 缺标题或内容 / 不是字符串，一律过滤', async () => {
  await withScene(async ({ root, bridge }) => {
    writeFileSync(join(root, 'today', TODAY + '.json'), JSON.stringify({
      cards: [
        { title: '留下', body: '正文' },
        { title: '  只有标题  ' },
        { body: '只有内容' },
        { title: 42, body: '标题不是字符串' },
        { title: '正文不是字符串', body: null },
        null,
        ['数组也不是卡'],
        { title: '  两边都去空白  ', body: '  正文  ' },
      ],
    }), 'utf8')
    const res = await bridge.call('GET', `${API}/today?date=${TODAY}`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.cards, [
      { title: '留下', body: '正文' },
      { title: '两边都去空白', body: '正文' },
    ])
  })
})

test('字符串上限：标题 200、正文 2000，超了截断而不是整条丢', async () => {
  await withScene(async ({ root, bridge }) => {
    writeDay(root, TODAY, { cards: [{ title: 'X'.repeat(300), body: 'Y'.repeat(2500) }] })
    const res = await bridge.call('GET', `${API}/today?date=${TODAY}`)
    assert.equal(res.body.cards.length, 1)
    assert.equal(res.body.cards[0].title.length, 200)
    assert.equal(res.body.cards[0].body.length, 2000)
  })
})

test('历史：倒序、只留比今天早且有卡的日子，没卡的日子整块不出现', async () => {
  await withScene(async ({ root, bridge }) => {
    writeDay(root, '2026-11-13', { cards: [{ title: '十三', body: '更早' }] })
    writeDay(root, '2026-11-14', { cards: [{ title: '十四', body: '昨天' }] })
    writeDay(root, '2026-11-12', { cards: [] })                 // 有文件没卡 → 不出现
    writeDay(root, '2026-11-11', { html: '<p>只有旧链路</p>' })  // 没有结构化卡 → 不出现
    writeDay(root, '2026-11-16', { cards: [{ title: '未来', body: '不该出现' }] })
    writeDay(root, TODAY, { cards: [{ title: '今天', body: '今天不进历史' }] })
    const res = await bridge.call('GET', `${API}/today?date=${TODAY}`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.history.map((day) => day.date), ['2026-11-14', '2026-11-13'])
    assert.equal(res.body.history[0].cards[0].title, '十四')
    assert.deepEqual(res.body.cards.map((card) => card.title), ['今天'])
  })
})

test('历史里的坏 JSON / 超大文件：跳过那一天，不拖垮整页', async () => {
  await withScene(async ({ root, bridge }) => {
    writeDay(root, '2026-11-14', { cards: [{ title: '好的', body: '留下' }] })
    writeFileSync(join(root, 'today', '2026-11-13.json'), '{oops', 'utf8')
    writeFileSync(join(root, 'today', '2026-11-12.json'), 'x'.repeat(600 * 1024), 'utf8')
    const res = await bridge.call('GET', `${API}/today?date=${TODAY}`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.history.map((day) => day.date), ['2026-11-14'])
    assert.deepEqual(bridge.logs, [])
  })
})

test('历史上限 14 天：再往前的不带（只为封顶一次请求的体积）', async () => {
  await withScene(async ({ root, bridge }) => {
    const days = []
    for (let index = 1; index <= 20; index += 1) {
      const date = '2026-10-' + String(index).padStart(2, '0')
      writeDay(root, date, { cards: [{ title: date, body: '第 ' + index + ' 天' }] })
      days.push(date)
    }
    const res = await bridge.call('GET', `${API}/today?date=${TODAY}`)
    assert.equal(res.body.history.length, 14)
    assert.deepEqual(res.body.history.map((day) => day.date), days.slice(-14).reverse())
  })
})

test('文件过大：当成没有，别把右栏拖死（结构化与旧链路都是）', async () => {
  await withScene(async ({ root, bridge }) => {
    writeFileSync(join(root, 'today', TODAY + '.json'), 'x'.repeat(600 * 1024), 'utf8')
    writeFileSync(join(root, 'today', TODAY + '.html'), 'x'.repeat(600 * 1024), 'utf8')
    const res = await bridge.call('GET', `${API}/today?date=${TODAY}`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.cards, [])
    assert.equal(res.body.html, null)
  })
})

test('date 写得不像日期：400，穿不出 today 目录', async () => {
  await withScene(async ({ root, bridge }) => {
    writeFileSync(join(root, 'secret.json'), '{"cards":[]}', 'utf8')
    for (const bad of ['', '../secret', '../../etc/passwd', '2026-11-15.json', '20261115']) {
      const res = await bridge.call('GET', `${API}/today?date=` + encodeURIComponent(bad))
      assert.equal(res.status, 400, `「${bad}」应当被拒`)
      assert.equal(res.body.cards, undefined)
      assert.equal(res.body.history, undefined)
    }
  })
})

test('外部 host 一律 403；跨站的非 GET 也 403', async () => {
  await withScene(async ({ bridge }) => {
    const foreign = await bridge.call('GET', `${API}/today?date=${TODAY}`, { headers: { host: 'evil.example.com' } })
    assert.equal(foreign.status, 403)
    const crossSite = await bridge.call('POST', `${API}/today`, { headers: { origin: 'http://evil.example.com' } })
    assert.equal(crossSite.status, 403)
  })
})

test('DSH_HOME 没设置：503，说清为什么', async () => {
  const previous = process.env.DSH_HOME
  delete process.env.DSH_HOME
  const routes = []
  const ctx = {
    logger: () => ({ info() {}, warn() {} }),
    inject(_deps, callback) {
      callback({
        effect(run) { run() },
        get(name) {
          if (name === 'webServer') return { register: (route) => { routes.push(route); return () => {} } }
          return { requestRejection: () => undefined }
        },
      })
    },
  }
  try {
    const module = await import('../plugins/dsh-daily/index.js')
    module.apply(ctx)
    const res = answer()
    await routes[0].handler(request('GET', `${API}/today?date=${TODAY}`), res)
    assert.equal(res.status, 503)
    assert.match(res.body.message, /DSH_HOME/)
  } finally {
    if (previous !== undefined) process.env.DSH_HOME = previous
  }
})

/* ── 卡的 nodes（genui spec）：向后兼容、坏树整张丢、边界值放过 ──────────────── */

test('nodes：合法数组原样交给右栏；没有 nodes 的旧卡形状一点不变', async () => {
  await withScene(async ({ root, bridge }) => {
    const nodes = [
      { type: 'row', items: [{ type: 'badge', label: '线索级', tone: 'warn' }] },
      { type: 'chart', kind: 'bars', data: [{ label: '缓存命中', value: 0.5 }] },
    ]
    writeDay(root, TODAY, {
      cards: [
        { title: '带图的新卡', body: '一句正文', nodes },
        { title: '旧卡', body: '还是两行' },
      ],
    })
    const res = await bridge.call('GET', `${API}/today?date=${TODAY}`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.cards[0], { title: '带图的新卡', body: '一句正文', nodes })
    assert.deepEqual(res.body.cards[1], { title: '旧卡', body: '还是两行' }, '旧卡不多出 nodes 字段')
  })
})

test('body 可选：只有 title + nodes 的卡也交出去', async () => {
  await withScene(async ({ root, bridge }) => {
    writeDay(root, TODAY, {
      cards: [{ title: '只有图', nodes: [{ type: 'text', content: '一句话' }] }],
    })
    const res = await bridge.call('GET', `${API}/today?date=${TODAY}`)
    assert.deepEqual(res.body.cards, [
      { title: '只有图', nodes: [{ type: 'text', content: '一句话' }] },
    ])
  })
})

test('空 nodes 又不给正文：没有内容可画，整张卡丢', async () => {
  await withScene(async ({ root, bridge }) => {
    writeDay(root, TODAY, {
      cards: [
        { title: '只有标题', nodes: [] },
        { title: '有正文', body: '留着', nodes: [] },
      ],
    })
    const res = await bridge.call('GET', `${API}/today?date=${TODAY}`)
    assert.deepEqual(res.body.cards, [{ title: '有正文', body: '留着' }])
  })
})

test('坏 nodes 整张卡丢：不是数组 / 超 40 节点 / 嵌套超 6 层 / 单串超 2000', async () => {
  await withScene(async ({ root, bridge }) => {
    let deep = { type: 'text', content: '最深' }
    for (let level = 0; level < 6; level += 1) deep = { type: 'card', items: [deep] }
    writeDay(root, TODAY, {
      cards: [
        { title: 'nodes 不是数组', body: '正文', nodes: { type: 'text', content: '坏' } },
        { title: '单串太长', body: '正文', nodes: [{ type: 'text', content: 'X'.repeat(2001) }] },
        { title: '节点太多', body: '正文', nodes: Array.from({ length: 41 }, () => ({ type: 'text', content: '点' })) },
        { title: '嵌得太深', body: '正文', nodes: [deep] },
        { title: '好卡', body: '留下' },
      ],
    })
    const res = await bridge.call('GET', `${API}/today?date=${TODAY}`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.cards, [{ title: '好卡', body: '留下' }], '一棵坏树只丢自己那张卡')
  })
})

test('边界：40 个节点、6 层嵌套算合法；未知节点类型交给渲染器，宿主不拦', async () => {
  await withScene(async ({ root, bridge }) => {
    let deep = { type: 'text', content: '第 6 层' }
    for (let level = 0; level < 5; level += 1) deep = { type: 'card', items: [deep] }
    writeDay(root, TODAY, {
      cards: [
        { title: '刚好 40 个', nodes: Array.from({ length: 40 }, () => ({ type: 'text', content: '点' })) },
        { title: '刚好 6 层', nodes: [deep] },
        {
          title: '未知类型',
          nodes: [
            { type: 'not-a-real-node', label: '未知' },
            { type: 'text', content: '兄弟还在' },
          ],
        },
      ],
    })
    const res = await bridge.call('GET', `${API}/today?date=${TODAY}`)
    assert.equal(res.body.cards.length, 3, '边界值不丢')
    assert.equal(res.body.cards[0].nodes.length, 40)
    assert.deepEqual(res.body.cards[2].nodes, [
      { type: 'not-a-real-node', label: '未知' },
      { type: 'text', content: '兄弟还在' },
    ], '类型名不归宿主管')
  })
})

test('历史里的卡也带 nodes：和今天走同一条读取路径', async () => {
  await withScene(async ({ root, bridge }) => {
    writeDay(root, '2026-11-14', {
      cards: [{ title: '昨天带图', body: '正文', nodes: [{ type: 'badge', label: '待核实', tone: 'warn' }] }],
    })
    const res = await bridge.call('GET', `${API}/today?date=${TODAY}`)
    assert.equal(res.body.history.length, 1)
    assert.deepEqual(res.body.history[0].cards[0].nodes, [{ type: 'badge', label: '待核实', tone: 'warn' }])
  })
})
