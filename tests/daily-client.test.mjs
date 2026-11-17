/**
 * dsh-daily —— 接线与照搬检查（不碰浏览器）。
 *
 * 这一层的失败方式很安静：`id` 与包名差一个字、槽位名打错、`order` 落错，宿主都不报错，
 * 用户看到的现象只是"左栏没有这一栏"。所以用假的 `window.__ModuleLoader__` 抓 factory，
 * 再用一个二十行的假 React 跑 `apply()` 与组件，把注册形状、页面骨架、三个页签与
 * 几个交互都断言掉。右栏内容按 2026-11-15 删掉示例卡与演示任务之后的空态断言。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ── 假宿主 ────────────────────────────────────────────────────────────────────

let captured = null;
/* 折叠分界存在 localStorage 里：这里给一个够用的内存版，reset() 会清空它。 */
const stored = new Map();
const fakeWindow = {
  __ModuleLoader__: {
    load(spec) {
      captured = spec;
    },
  },
  localStorage: {
    getItem: (key) => (stored.has(key) ? stored.get(key) : null),
    setItem: (key, value) => { stored.set(key, String(value)); },
    removeItem: (key) => { stored.delete(key); },
  },
};
globalThis.document = { head: { appendChild() {} }, createElement: () => ({ setAttribute() {}, remove() {} }) };

/* 假 React：元素是普通对象；useState/useCallback 有最小可用的实现，
   这样点一下按钮再重跑一次组件就能看到新状态。effect 由 render() 跑；
   依赖数组要真的比对，否则每渲染一次就重新 retain 一次，观察不到 ready 的结果。 */
const hookState = [];
const refState = [];
const effectDeps = [];
const effectCleanups = [];
const pendingEffects = [];
let cursor = 0;
let refCursor = 0;
let effectCursor = 0;
let dirty = false;

const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState(initial) {
    const index = cursor++;
    if (!(index in hookState)) hookState[index] = initial;
    return [hookState[index], (next) => {
      hookState[index] = typeof next === 'function' ? next(hookState[index]) : next;
      dirty = true;
    }];
  },
  useCallback: (fn) => fn,
  useMemo: (compute) => compute(),
  useRef(initial) {
    const index = refCursor++;
    if (!(index in refState)) refState[index] = { current: initial };
    return refState[index];
  },
  useEffect(fn, deps) {
    const index = effectCursor++;
    const previous = effectDeps[index];
    const same = Array.isArray(previous)
      && Array.isArray(deps)
      && previous.length === deps.length
      && deps.every((dep, at) => Object.is(dep, previous[at]));
    if (same) return;
    effectDeps[index] = Array.isArray(deps) ? deps.slice() : undefined;
    pendingEffects.push({ index, fn });
  },
  useSyncExternalStore(subscribe, read) { return read(); },
};

/* 按浏览器脚本执行原文：只提供 window/document，不提供 CommonJS 的 module。
   ModuleLoader 工厂只接收 require，必须直接返回插件导出对象。

   折叠与卡片修复是工厂闭包里的纯函数，宿主用不到它们，所以不在生产对象里开洞；
   这里在源码里把导出对象补一个 `internals`，再照常装配。锚点找不到就让 `patched`
   等于原文（后面 `internals` 断言会立刻炸，不会静默略过）。 */
const source = readFileSync(new URL('../plugins/dsh-daily/client.js', import.meta.url), 'utf8');
const ANCHOR = "return { apply, inject, name: 'dsh-daily' };";
const INTERNALS = "return { apply, inject, name: 'dsh-daily', internals: { foldThread, textBlocks, mainSessionId, splitThread, splitUiFences, FREE_HTML_UI, uiDocument, uiThemeVars, uiPickText, deliverUiPick, setUiPickSink, validateSpec, renderSpec, splitDshUiFences, parseSpecFence, dayHeading, daySection, todaySpec, cardsOf, historyOf, TODAY_EMPTY_TEXT } };";
const patched = source.includes(ANCHOR) ? source.replace(ANCHOR, INTERNALS) : source;
const runPackage = new Function('window', 'document', patched);
runPackage(fakeWindow, globalThis.document);

const mod = captured.factory((name) => (name === 'react' ? fakeReact : {}));

// ── 包与工厂 ──────────────────────────────────────────────────────────────────

test('ModuleLoader 的 id 与导出的 name 都是包名', () => {
  assert.equal(captured.id, 'dsh-daily');
  assert.equal(mod.name, 'dsh-daily');
});

test('inject 只声明 slots', () => {
  assert.deepEqual(mod.inject, ['slots']);
});

// ── 槽位注册 ──────────────────────────────────────────────────────────────────

// ── 假会话服务 ────────────────────────────────────────────────────────────────

/* 左栏现在读的是真会话。这里给一个可改的运行期：列表、事件窗口、会话快照、
   retain 记录与发送记录都放在 harness 上，测试按需摆。 */
const emptyWindow = () => ({ entries: [], hasMore: false, revision: 0, change: { kind: 'replace', entries: [] } });
const emptySnapshot = () => ({ pendingSubmissions: [], running: false, openState: 'open', blank: false, removed: false });

const harness = {
  list: { ids: [], byId: {}, phase: 'ready' },
  window: emptyWindow(),
  snapshot: emptySnapshot(),
  retained: [],
  created: [],
  renamed: [],
  sends: [],
  refreshes: 0,
  refs: 0,
  released: 0,
  abandoned: 0,
  cancels: 0,
  readyError: null,
  createError: null,
};

const fakeSessions = {
  list: { getSnapshot: () => harness.list, subscribe: () => () => {} },
  refresh() {
    harness.refreshes += 1;
    return Promise.resolve();
  },
  /* 建会话：像宿主那样把它加进列表，并给一个可预期的 id。 */
  create(opts) {
    harness.created.push(opts);
    if (harness.createError !== null) return Promise.reject(new Error(harness.createError));
    const id = 'daily-created-1';
    harness.list = {
      ...harness.list,
      ids: [...harness.list.ids, id],
      byId: { ...harness.list.byId, [id]: { id, displayTitle: id, running: false, blank: true } },
    };
    return Promise.resolve(id);
  },
  retain(id, options) {
    harness.retained.push({ id, options });
    harness.refs += 1;
    const binding = {
      sessionId: id,
      session: {
        getSnapshot: () => harness.snapshot,
        subscribe: () => () => {},
        rename(title) {
          harness.renamed.push({ id, title });
          return Promise.resolve({ ok: true, value: { title, seq: 1 } });
        },
        beginSubmission(input) {
          harness.sends.push({ kind: 'begin', input });
          return {
            requestId: 'req-' + harness.sends.length,
            abandon() { harness.abandoned += 1; },
          };
        },
        prompt(content, mode, signal, requestId) {
          harness.sends.push({ kind: 'prompt', content, mode, requestId });
          return Promise.resolve({ ok: true, value: { accepted: true } });
        },
      },
      eventSource: { getSnapshot: () => harness.window, subscribe: () => () => {} },
      ctx: {
        conversation: {
          cancel() { harness.cancels += 1; return Promise.resolve(); },
        },
      },
    };
    return {
      sessionId: id,
      binding,
      ready: harness.readyError === null
        ? Promise.resolve(binding)
        : Promise.reject(new Error(harness.readyError)),
      release() { harness.released += 1; },
    };
  },
};

/* 每个用例从头来：清掉 hook 状态、effect、refs、本地存储与假会话运行期。 */
function reset() {
  for (const cleanup of effectCleanups.splice(0)) {
    if (typeof cleanup === 'function') cleanup();
  }
  hookState.length = 0;
  refState.length = 0;
  effectDeps.length = 0;
  pendingEffects.length = 0;
  cursor = 0;
  refCursor = 0;
  effectCursor = 0;
  dirty = false;
  harness.list = { ids: [], byId: {}, phase: 'ready' };
  harness.window = emptyWindow();
  harness.snapshot = emptySnapshot();
  harness.retained = [];
  harness.created = [];
  harness.renamed = [];
  harness.sends = [];
  harness.refreshes = 0;
  harness.refs = 0;
  harness.released = 0;
  harness.abandoned = 0;
  harness.cancels = 0;
  harness.readyError = null;
  harness.createError = null;
  stored.clear();
}

function runApply() {
  const registered = [];
  const injected = [];
  const services = [];
  const ctx = {
    effect: (fn) => fn(),
    inject: (deps, callback) => {
      services.push(deps);
      callback({ sessions: fakeSessions });
    },
    slots: {
      inject: (name, fn) => {
        injected.push(name);
        return fn();
      },
      register: (def, render) => {
        registered.push({ def, render });
        return () => {};
      },
    },
  };
  mod.apply(ctx);
  return { registered, injected, services };
}

test('注册 main 与左栏「日常」两个槽位', () => {
  const { registered, injected } = runApply();
  assert.deepEqual(injected, ['main', 'sidebar.panellist']);
  assert.equal(registered.length, 2);
});

test('主面板 key 与左栏入口 id 同名', () => {
  const { registered } = runApply();
  const main = registered.find((entry) => entry.def.name === 'main');
  const sidebar = registered.find((entry) => entry.def.name === 'sidebar.panellist');
  assert.equal(main.def.key, 'daily');
  assert.equal(sidebar.def.id, 'daily');
});

test('左栏入口在「插件」(order 0) 之前，且名字在 VIVY 分组白名单里', async () => {
  const { registered } = runApply();
  const sidebar = registered.find((entry) => entry.def.name === 'sidebar.panellist');
  assert.equal(sidebar.def.label(), '日常');
  assert.equal(sidebar.def.order, -5);
  const KEEP = /^(插件|plugins|自动化任务|automation( tasks)?|相遇|日常|更多|more)$/i;
  assert.match('日常', KEEP, '不在白名单里就会被折进 VIVY心核');
});

// ── 假渲染 ────────────────────────────────────────────────────────────────────

function render() {
  const { registered } = runApply();
  const Page = registered.find((entry) => entry.def.name === 'main').render;
  let nodes = paint(Page);
  /* effect 跑到稳定为止（最多四轮）：effect 里的 setState 会再触发一轮，
     依赖没变的 effect 不会重跑，所以 retain 不会虚高。 */
  for (let pass = 0; pass < 4 && (pendingEffects.length > 0 || dirty); pass += 1) {
    for (const { index, fn } of pendingEffects.splice(0)) {
      const previous = effectCleanups[index];
      if (typeof previous === 'function') previous();
      effectCleanups[index] = fn();
    }
    if (!dirty) break;
    dirty = false;
    nodes = paint(Page);
  }
  return nodes;
}

/* 一次重绘：hooks 游标归零，effect 攒起来交给 render()。 */
function paint(Page) {
  cursor = 0;
  refCursor = 0;
  effectCursor = 0;
  pendingEffects.length = 0;
  return flatten(Page({}));
}

/* retain 的 ready 是 Promise：等它落地才拿得到 binding。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 摊平一棵假元素树；函数组件就地展开。 */
function flatten(node) {
  const out = [];
  const walk = (current) => {
    if (current === null || current === undefined || typeof current === 'boolean') return;
    if (Array.isArray(current)) {
      for (const item of current) walk(item);
      return;
    }
    if (typeof current !== 'object') return;
    if (typeof current.type === 'function') {
      walk(current.type(current.props));
      return;
    }
    out.push(current);
    for (const child of current.children ?? []) walk(child);
  };
  walk(node);
  return out;
}

const byClass = (nodes, className) => nodes.filter((node) => node.props?.className === className);
const textOf = (node) => {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object') return (node.children ?? []).map(textOf).join('');
  return '';
};
const whole = (nodes) => nodes.map(textOf).join(' ');

const click = (element) => {
  dirty = false;
  element.props.onClick?.();
  return dirty;
};

test('整页是两栏：左对话栏 + 右上下文栏', () => {
  const nodes = render();
  assert.ok(byClass(nodes, 'dl-app')[0], '缺两栏容器');
  assert.ok(byClass(nodes, 'dl-chat')[0], '缺左栏');
  assert.ok(byClass(nodes, 'dl-ctx')[0], '缺右栏');
  assert.equal(byClass(nodes, 'dl-tab').length, 3);
  assert.deepEqual(byClass(nodes, 'dl-tab').map(textOf), ['Today', '任务', '悄悄话']);
});

// ── 左栏：接 superagent 主会话 ────────────────────────────────────────────────

/** 摆一个「主会话在列表里」的运行期。 */
function withMainSession() {
  harness.list = {
    ids: ['orchestrator-4d18', 'session-other'],
    byId: {
      'orchestrator-4d18': { title: 'dsh-superagent orchestrator', displayTitle: 'Superagent · 主会话' },
      'session-other': { displayTitle: '别的会话' },
    },
    phase: 'ready',
  };
}

test('左栏是对话：品牌、状态、输入条，原型里那段假对话已经退场', async () => {
  reset();
  withMainSession();
  render();
  await settle();
  const nodes = render();
  const all = whole(nodes);
  assert.ok(byClass(nodes, 'dl-chat')[0], '缺左栏');
  assert.ok(byClass(nodes, 'dl-composer')[0], '缺输入条');
  assert.ok(byClass(nodes, 'dl-send')[0], '缺发送键');
  assert.equal(byClass(nodes, 'dl-input dl-input--area')[0].props.placeholder, '和她说点什么…');
  assert.ok(all.includes('diva'), '页头是 diva 字标，不重复侧栏的「日常」');
  assert.ok(!all.includes('日常'), '「日常」只留在侧栏，页头不再重复');
  assert.ok(!all.includes('主会话'), '页头不再挂「主会话」这种副标题');
  for (const gone of [
    '帮我把下午的评审挪到 15:00', '早上好。今天是 11 月 14 日星期六。',
    '批准改动', '稍后提醒', '已完成 3 个步骤',
  ]) {
    assert.ok(!all.includes(gone), `「${gone}」应该已经退场`);
  }
});

test('没有主会话时是空态，不是空白页，也不会 retain 别人', () => {
  reset();
  const nodes = render();
  assert.equal(harness.retained.length, 0, '认不出主会话就不 retain');
  assert.deepEqual(harness.created, [], '也不自己建会话');
  const all = whole(nodes);
  assert.ok(all.includes('还没有接上 Superagent 主会话'));
  assert.ok(all.includes('重试'));
  assert.equal(byClass(nodes, 'dl-input dl-input--area')[0].props.disabled, true, '接不上时输入框不可用');
});

test('接上主会话：她的话在左、你的话在右，注入上下文与瞬态都不进列表', async () => {
  reset();
  withMainSession();
  harness.window = {
    ...emptyWindow(),
    entries: [
      { type: 'event', event: { type: 'user/message', seq: 1, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '在吗' }] } } },
      { type: 'event', event: { type: 'user/message', seq: 2, time: 2, data: { source: { kind: 'inject' }, content: [{ type: 'text', text: '这是注入的上下文' }] } } },
      { type: 'event', event: { type: 'assistant/message', seq: 3, time: 3, data: { message: { content: [{ kind: 'text', text: '在。' }, { kind: 'tool-call', callId: 'c1', name: 'bash', argsRaw: '{}' }] } } } },
      { type: 'transient', event: { type: 'assistant/live-chunk', seq: 4, time: 4, data: { attemptId: 'a', turn: 1, step: 1, chunk: { type: 'text-delta', text: '半句' } } } },
    ],
  };
  render();
  await settle();
  const nodes = render();
  const mine = nodes.filter((node) => node.props && node.props.className === 'dl-msg dl-msg--me').map(textOf);
  const hers = nodes.filter((node) => node.props && node.props.className === 'dl-msg').map(textOf);
  assert.deepEqual(mine, ['在吗']);
  assert.deepEqual(hers, ['在。']);
  const all = whole(nodes);
  assert.ok(!all.includes('这是注入的上下文'), '注入的上下文不是人话');
  assert.ok(!all.includes('半句'), '瞬态 live-chunk 不渲');
  assert.ok(!all.includes('bash'), '工具调用不该出现');
  assert.equal(harness.retained[0].id, 'orchestrator-4d18');
  assert.equal(harness.retained[0].options.source, 'daily');
});

test('发送走 beginSubmission + prompt，带了 requestId', async () => {
  reset();
  withMainSession();
  render();
  await settle();
  let nodes = render();
  nodes.find((node) => node.props && node.props.className === 'dl-input dl-input--area').props.onChange({ target: { value: '今天天气怎么样' } });
  nodes = render();
  const send = nodes.find((node) => node.props && node.props.className === 'dl-send');
  assert.equal(send.props.disabled, false);
  await send.props.onClick();
  assert.equal(harness.sends[0].kind, 'begin');
  assert.deepEqual(harness.sends[0].input, { mode: 'queue', text: '今天天气怎么样', attachments: [] });
  assert.equal(harness.sends[1].kind, 'prompt');
  assert.deepEqual(harness.sends[1].content, [{ type: 'text', text: '今天天气怎么样' }]);
  assert.equal(harness.sends[1].requestId, 'req-1');
  assert.equal(harness.abandoned, 0, '发送成功不该 abandon');
});

// ── 新建聊天：只收起显示，会话还是同一条 ──────────────────────────────────────

/** 两轮对话：一问一答。 */
const twoTurns = () => ({
  ...emptyWindow(),
  entries: [
    { type: 'event', event: { type: 'user/message', seq: 1, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '早上好' }] } } },
    { type: 'event', event: { type: 'assistant/message', seq: 2, time: 2, data: { message: { content: [{ kind: 'text', text: '早。' }] } } } },
  ],
});

const mineOf = (nodes) => nodes.filter((node) => node.props && node.props.className === 'dl-msg dl-msg--me').map(textOf);
const newChatButton = (nodes) => nodes.find((node) => node.props && node.props.className === 'dl-btn dl-btn--ghost' && textOf(node) === '新建聊天');

test('分界只切显示：不晚于分界的收起来，之后的是新的一段', () => {
  const { splitThread } = mod.internals;
  const thread = [
    { key: 'u1', seq: 1, role: 'me', text: 'a' },
    { key: 'a2', seq: 2, role: 'her', text: 'b' },
    { key: 'u5', seq: 5, role: 'me', text: 'c' },
  ];
  const all = splitThread(thread, null);
  assert.equal(all.shown.length, 3, '没有分界时一条都不收');
  assert.equal(all.folded.length, 0);

  const split = splitThread(thread, 2);
  assert.deepEqual(split.folded.map((bubble) => bubble.text), ['a', 'b']);
  assert.deepEqual(split.shown.map((bubble) => bubble.text), ['c']);

  /* 没有 seq 的气泡留在看得见的一侧，不因为分界被误吞。 */
  assert.equal(splitThread([{ key: 'x', role: 'me', text: 'd' }], 2).shown.length, 1);
});

test('「新建聊天」把前面的气泡收起来，会话与发送都不受影响', async () => {
  reset();
  withMainSession();
  harness.window = twoTurns();
  render();
  await settle();
  let nodes = render();
  assert.deepEqual(mineOf(nodes), ['早上好']);

  const button = newChatButton(nodes);
  assert.ok(button, '头部缺「新建聊天」');
  assert.equal(button.props.disabled, false);
  click(button);

  nodes = render();
  assert.deepEqual(mineOf(nodes), [], '旧气泡应该收起来');
  const foldRow = byClass(nodes, 'dl-fold-btn')[0];
  assert.ok(foldRow, '缺折叠行');
  assert.equal(textOf(foldRow), '展开更早的 2 条');
  assert.ok(whole(nodes).includes('新的一段，从这句话开始。'));
  assert.equal(harness.sends.length, 0, '折叠不发送任何消息');
  assert.equal(harness.retained[0].id, 'orchestrator-4d18', '还是同一条 master 会话');
  assert.equal(harness.created.length, 0, '也不新建会话');

  /* 收起之后开口说话：新气泡出现在折叠行下面，旧的一段仍然收着。 */
  const next = twoTurns();
  harness.window = {
    ...next,
    entries: [...next.entries, { type: 'event', event: { type: 'user/message', seq: 9, time: 9, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '换个话题' }] } } }],
  };
  nodes = render();
  assert.deepEqual(mineOf(nodes), ['换个话题'], '新气泡在新的一段里');
  assert.equal(textOf(byClass(nodes, 'dl-fold-btn')[0]), '展开更早的 2 条', '旧的一段仍收着');
  assert.ok(!whole(nodes).includes('新的一段，从这句话开始。'), '有话说之后提示退场');

  click(byClass(nodes, 'dl-fold-btn')[0]);
  nodes = render();
  assert.deepEqual(mineOf(nodes), ['早上好', '换个话题'], '展开后两段都在');
  assert.equal(textOf(byClass(nodes, 'dl-fold-btn')[0]), '收起');
});

test('折叠分界存在本地，刷新之后还收着', async () => {
  reset();
  withMainSession();
  harness.window = twoTurns();
  render();
  await settle();
  click(newChatButton(render()));

  /* 模拟一次硬刷新：hooks 与 effect 清掉，本地存储留着。 */
  hookState.length = 0;
  refState.length = 0;
  effectDeps.length = 0;
  pendingEffects.length = 0;
  cursor = 0;
  refCursor = 0;
  effectCursor = 0;
  for (const cleanup of effectCleanups.splice(0)) if (typeof cleanup === 'function') cleanup();

  render();
  await settle();
  const nodes = render();
  assert.ok(byClass(nodes, 'dl-fold-btn')[0], '刷新后仍应有折叠行');
  assert.deepEqual(mineOf(nodes), [], '刷新后旧气泡仍然收着');
});

test('分界指向已不存在的消息时作废：历史被清空后不吞新的一段', async () => {
  reset();
  withMainSession();
  /* 上一代历史（seq 到 999）留下的分界，新会话只有 seq 1..2。 */
  stored.set('dsh-daily/fold/orchestrator-4d18', '999');
  harness.window = twoTurns();
  render();
  await settle();
  const nodes = render();
  assert.deepEqual(mineOf(nodes), ['早上好'], '过期分界不该把新的一段收起来');
  assert.equal(byClass(nodes, 'dl-fold-btn').length, 0, '不该留一条收着空东西的折叠行');
  assert.equal(stored.has('dsh-daily/fold/orchestrator-4d18'), false, '过期分界从本地抹掉');
});

test('她跑着的时候是「正在输入」，停止键调 cancel', async () => {
  reset();
  withMainSession();
  harness.snapshot = { ...emptySnapshot(), running: true };
  render();
  await settle();
  const nodes = render();
  assert.ok(byClass(nodes, 'dl-bubble dl-typing')[0], '缺「正在输入」');
  const stop = nodes.find((node) => node.props && node.props.className === 'dl-btn dl-btn--ghost' && textOf(node) === '停止');
  assert.ok(stop, '缺停止键');
  await stop.props.onClick();
  assert.equal(harness.cancels, 1);
});

test('接不上时把原因写出来，重试会再拉一次列表', async () => {
  reset();
  withMainSession();
  harness.readyError = 'connect ECONNREFUSED';
  render();
  await settle();
  const nodes = render();
  const all = whole(nodes);
  assert.ok(all.includes('接不上 Superagent 主会话'));
  assert.ok(all.includes('connect ECONNREFUSED'));
  const retry = nodes.find((node) => node.props && node.props.className === 'dl-btn dl-btn--ghost' && textOf(node) === '重试');
  assert.ok(retry, '缺重试键');
  const before = harness.refreshes;
  retry.props.onClick();
  assert.equal(harness.refreshes, before + 1);
});

test('折叠只收文本：推理块丢掉、只有工具调用的步骤不留空泡', () => {
  const { foldThread, textBlocks, mainSessionId } = mod.internals;
  assert.equal(textBlocks([{ kind: 'reasoning', text: '想一下' }, { kind: 'text', text: '答' }]), '答');
  assert.equal(textBlocks([{ type: 'text', text: '人话' }, { type: 'image', attachment: {} }]), '人话');
  assert.equal(textBlocks([{ kind: 'tool-call', callId: 'c' }]), '');
  const feed = {
    entries: [
      { type: 'event', event: { type: 'assistant/message', seq: 9, data: { message: { content: [{ kind: 'tool-call', callId: 'c', name: 'read', argsRaw: '{}' }] } } } },
      { type: 'event', event: { type: 'user/message', seq: 10, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] } } },
    ],
  };
  assert.deepEqual(foldThread(feed).map((bubble) => bubble.role + ':' + bubble.text), ['me:你好']);
  assert.equal(mainSessionId({ ids: ['x', 'orchestrator-1'], byId: {} }), 'orchestrator-1');
  assert.equal(mainSessionId({ ids: ['x'], byId: { x: { displayTitle: 'dsh-superagent orchestrator' } } }), 'x');
  assert.equal(mainSessionId({ ids: ['x'], byId: { x: { displayTitle: '别的' } } }), undefined);
});

// ── 自由 UI（2026-11-15 深夜临时停用）：html 围栏不再渲成框，代码与边界都留着 ──
//
// 停用改走 genui 结构化 spec；恢复 = client.js 里 FREE_HTML_UI 改回 true + 硬刷新。
// 下面带选项的用例在停用期间跳过，恢复后自动重新生效。

const uiOn = mod.internals.FREE_HTML_UI;

const assistantOnly = (text) => ({
  ...emptyWindow(),
  entries: [{ type: 'event', event: { type: 'assistant/message', seq: 2, time: 2, data: { message: { content: [{ kind: 'text', text }] } } } }],
});

test('splitUiFences：停用期间整条当文字；打开时切出文字与界面', () => {
  const { splitUiFences } = mod.internals;
  const text = '前一句\n```html\n<p>hi</p>\n```\n后一句';
  assert.deepEqual(splitUiFences('没有围栏').map((s) => s.kind), ['text']);
  if (uiOn) {
    const ok = splitUiFences(text);
    assert.deepEqual(ok.map((segment) => segment.kind), ['text', 'ui', 'text']);
    assert.equal(ok[1].code.trim(), '<p>hi</p>');
    const broken = splitUiFences('前\n```html\n<p>hi</p>');
    assert.deepEqual(broken.map((s) => s.kind), ['text'], '没闭合就当普通文字');
    assert.ok(broken[0].text.includes('<p>hi</p>'), '后面的正文一个字不丢');
  } else {
    const segments = splitUiFences(text);
    assert.deepEqual(segments.map((s) => s.kind), ['text'], '停用期间不出界面段');
    assert.equal(segments[0].text, text, '整条原样当文字');
  }
});

test('打开开关时 html 围栏渲成沙箱 iframe：只给 allow-scripts，srcdoc 里断网', { skip: !uiOn }, async () => {
  reset();
  withMainSession();
  harness.window = assistantOnly('给你做了个东西\n```html\n<h1>朝</h1>\n```\n你看看');
  render();
  await settle();
  const nodes = render();
  const frames = nodes.filter((node) => node.type === 'iframe');
  assert.equal(frames.length, 1, '一条围栏一个框');
  const { props } = frames[0];
  assert.equal(props.sandbox, 'allow-scripts', '没有 allow-same-origin：它碰不到父页面');
  assert.ok(props.srcDoc.includes('<h1>朝</h1>'), '她的代码原样进 srcdoc');
  assert.ok(props.srcDoc.includes("connect-src 'none'"), 'srcdoc 里断网');
  assert.ok(props.srcDoc.includes('Content-Security-Policy'), 'CSP 得在，否则断网那句是空话');
  const all = whole(nodes);
  assert.ok(all.includes('给你做了个东西') && all.includes('你看看'), '围栏外的文字照常显示');
  assert.ok(!all.includes('```'), '围栏标记本身不该露出来');
  assert.equal(nodes.filter((node) => node.props && node.props.className === 'dl-msg dl-msg--ui').length, 1, '带界面的气泡放宽宽度');
});


test('停用期间 html 围栏当成原文：不长 iframe，字一个不丢', { skip: uiOn }, async () => {
  reset();
  withMainSession();
  harness.window = assistantOnly('给你做了个东西\n```html\n<h1>朝</h1>\n```\n你看看');
  render();
  await settle();
  const nodes = render();
  assert.equal(nodes.filter((node) => node.type === 'iframe').length, 0, '停用期间没有框');
  const all = whole(nodes);
  assert.ok(all.includes('给你做了个东西') && all.includes('你看看'), '围栏外文字照常');
  assert.ok(all.includes('<h1>朝</h1>'), '围栏里的代码当文字留着，不丢');
  assert.equal(nodes.filter((node) => node.props && node.props.className === 'dl-msg dl-msg--ui').length, 0, '没有界面气泡');
});

test('没有围栏的气泡一个 iframe 都不长（不许把普通回复当界面）', async () => {
  reset();
  withMainSession();
  harness.window = assistantOnly('今天还好，就是有点累。');
  render();
  await settle();
  const nodes = render();
  assert.equal(nodes.filter((node) => node.type === 'iframe').length, 0);
  assert.equal(nodes.filter((node) => node.props && node.props.className === 'dl-msg').length, 1);
});

// ── 左栏：dsh-ui 围栏 → genui spec 卡 ────────────────────────────────────────
//
// 2026-11-15 深夜：普通会话里 genui 客户端把 ```dsh-ui 围栏渲成卡，但日常左栏是
// 本插件自己的 React 树，genui 的 DOM 通道看不到它。这里走同一套 code-fence
// 分段，再喂给本文件里与右栏共用的 vendored 渲染器（renderSpec）。

const specFence = (body) => '```dsh-ui\n' + body + '\n```';

test('splitDshUiFences：多段围栏各自成段，没闭合按文字，标签手滑也认', () => {
  const { splitDshUiFences } = mod.internals;
  assert.deepEqual(splitDshUiFences(''), []);
  assert.deepEqual(splitDshUiFences('   '), [], '整条空白不算一段');
  assert.deepEqual(splitDshUiFences('只有话').map((s) => s.kind), ['text']);

  const two = splitDshUiFences('前\n```dsh-ui\n{"items":[]}\n```\n中间\n```DSH-UI>\n{"items":[]}\n```\n后');
  assert.deepEqual(two.map((s) => s.kind), ['text', 'spec', 'text', 'spec', 'text'], '两段围栏各自成段');
  assert.equal(two[1].code.trim(), '{"items":[]}');
  assert.ok(two[2].text.includes('中间'), '围栏之间的文字留着');

  const unclosed = splitDshUiFences('前\n```dsh-ui\n{"items":[]}');
  assert.deepEqual(unclosed.map((s) => s.kind), ['text'], '没闭合就当普通文字');
  assert.ok(unclosed[0].text.includes('{"items":[]}'), '围栏里的字一个不丢');

  assert.deepEqual(splitDshUiFences('```html\n<p>hi</p>\n```').map((s) => s.kind), ['text'], '不认别的语言标记');
});

test('parseSpecFence：坏 JSON 与空卡返回 null；只有一个组件根的 spec 会被包成 items', () => {
  const { parseSpecFence } = mod.internals;
  assert.equal(parseSpecFence('{"items":[]}'), null, '一个节点都不剩 → 降级');
  assert.equal(parseSpecFence('{oops'), null, '坏 JSON → 降级');
  assert.equal(parseSpecFence('[]'), null, '不是对象 → 降级');
  assert.equal(parseSpecFence('{"items":[{"type":"nope"}]}'), null, '全是不认识的类型 → 降级');

  const clean = parseSpecFence('{"title":"今天","items":[{"type":"text","content":"在"}]}');
  assert.equal(clean.title, '今天');
  assert.deepEqual(clean.items.map((node) => node.type), ['text']);

  const bare = parseSpecFence('{"type":"card","title":"单根","items":[{"type":"text","content":"卡里"}]}');
  assert.deepEqual(bare.items.map((node) => node.type), ['card'], '单组件根被包成 items');
});

test('stack 外层换个名字也不退回原文：没标题当 col，有标题当 card', () => {
  const { parseSpecFence } = mod.internals;
  const spec = parseSpecFence(JSON.stringify({
    type: 'stack',
    gap: 12,
    items: [
      { type: 'text', content: '第一条' },
      { type: 'text', content: '第二条' },
    ],
    children: [{ type: 'text', text: '这份 children 不是我们认的字段' }],
  }));
  assert.ok(spec, '不该因为 stack 不认识就整条降级');
  assert.equal(spec.items.length, 1);
  assert.equal(spec.items[0].type, 'col', '没标题的 stack 按 col 收下');
  assert.equal(spec.items[0].gap, 12, 'gap 保留');
  assert.equal(spec.items[0].items.length, 2, 'items 里的子节点照常渲染');
  assert.ok(!('children' in spec.items[0]), '不认的 children 不往渲染器里带');

  const titled = parseSpecFence(JSON.stringify({
    type: 'stack',
    title: '图文卡片能长什么样',
    items: [{ type: 'text', content: '内容' }],
  }));
  assert.equal(titled.items[0].type, 'card', '有标题的 stack 当 card，标题留住');
  assert.equal(titled.items[0].title, '图文卡片能长什么样');

  assert.equal(parseSpecFence('{"type":"mystery","items":[{"type":"text","content":"x"}]}'), null, '真正陌生的根仍然降级');
});

test('assistant 气泡里的 dsh-ui 围栏渲成一张卡：围栏标记不露出来，正文照常', async () => {
  reset();
  withMainSession();
  const spec = '{"title":"今天三件事","items":[{"type":"card","title":"今天","items":[{"type":"list","items":["写作","调试"]}]}]}';
  harness.window = assistantOnly('给你画了一张\n' + specFence(spec) + '\n就这些');
  render();
  await settle();
  const nodes = render();
  const all = whole(nodes);
  assert.equal(byClass(nodes, 'dl-spec').length, 1, '一张卡一个容器（右栏三页也用 .dl-g-root，这里只看左栏）');
  assert.ok(byClass(nodes, 'dl-g-card')[0], '卡里的 card 节点画出来了');
  assert.equal(byClass(nodes, 'dl-g-root-title').map(textOf).join(''), '今天三件事', '根标题不丢');
  assert.ok(all.includes('给你画了一张') && all.includes('就这些'), '围栏外的正文照常');
  assert.ok(!all.includes('```'), '围栏标记本身不该露出来');
  assert.ok(!all.includes('"items"'), 'JSON 原文不该露出来');
  assert.equal(nodes.filter((node) => node.type === 'iframe').length, 0, 'spec 不走 iframe');
  assert.equal(nodes.filter((node) => node.props?.className === 'dl-msg dl-msg--ui').length, 1, '带卡的气泡放宽宽度');
});

test('左栏气泡渲染 Markdown：标题、粗体、列表、代码块、链接', async () => {
  reset();
  withMainSession();
  harness.window = assistantOnly([
    '## 小结',
    '**结论**：先别动，等 `审核` 结果。',
    '- 第一项',
    '- 第二项',
    '```js',
    'const a = 1 < 2;',
    '```',
    '[官网](https://example.com) 和 [坏链](javascript:alert(1)) 与 <script>alert(1)</script>',
  ].join('\n'));
  render();
  await settle();
  const nodes = render();
  const types = nodes.map((node) => node.type);
  assert.ok(types.includes('h2'), '标题');
  assert.ok(types.includes('strong'), '粗体');
  assert.ok(types.includes('ul'), '列表');
  assert.ok(types.includes('pre'), '代码块');
  assert.ok(types.includes('code'), '行内代码');
  const links = nodes.filter((node) => node.type === 'a');
  assert.equal(links.length, 1, '只放行 http(s)/mailto');
  assert.equal(links[0].props.href, 'https://example.com');
  assert.equal(links[0].props.rel, 'noreferrer noopener');
  assert.ok(!types.includes('script'), '原始 HTML 不当元素');
  const all = whole(nodes);
  assert.ok(!all.includes('**'), '粗体标记不露出来');
  assert.ok(!all.includes('`审核`'), '行内代码标记不露出来');
  assert.ok(!all.includes('## 小结'), '标题标记不露出来');
  assert.ok(all.includes('const a = 1 < 2;'), '代码块内容照常');
});

test('多段围栏：一条回复里两张卡各自成卡，中间的文字照常', async () => {
  reset();
  withMainSession();
  harness.window = assistantOnly([
    specFence('{"items":[{"type":"text","content":"第一张"}]}'),
    '中间一句话',
    specFence('{"items":[{"type":"text","content":"第二张"}]}'),
  ].join('\n'));
  render();
  await settle();
  const nodes = render();
  const all = whole(nodes);
  assert.equal(byClass(nodes, 'dl-spec').length, 2, '两条围栏两张卡');
  const cards = nodes.filter((node) => node.props?.className === 'dl-spec');
  assert.deepEqual(cards.map(textOf), ['第一张', '第二张'], '两张卡各自只装自己的内容');
  assert.ok(all.includes('中间一句话'));
});

test('画不出来的围栏降级成原文：卡片没有，字一个不丢', async () => {
  reset();
  withMainSession();
  harness.window = assistantOnly('前\n```dsh-ui\n{"items":[{"type":"unknown-widget","x":1}]}\n```\n后');
  render();
  await settle();
  const nodes = render();
  const all = whole(nodes);
  assert.equal(byClass(nodes, 'dl-spec').length, 0, '不认识的节点不硬画');
  assert.ok(all.includes('前') && all.includes('后'), '围栏外的正文不能被吞');
  assert.ok(all.includes('unknown-widget'), '围栏原文降级成文字摆出来');
  assert.equal(nodes.filter((node) => node.props?.className === 'dl-msg dl-msg--ui').length, 0, '降级不算界面');
});

test('没闭合的 dsh-ui 围栏整条按文字走：不吞后面的正文', async () => {
  reset();
  withMainSession();
  harness.window = assistantOnly('开始\n```dsh-ui\n{"items":[{"type":"text","content":"画不出来"\n后面这句必须还在');
  render();
  await settle();
  const nodes = render();
  const all = whole(nodes);
  assert.equal(byClass(nodes, 'dl-spec').length, 0);
  assert.ok(all.includes('后面这句必须还在'), '围栏没闭合时，后半段的正文一个字都不能吞');
});

test('新节点：table / chart / steps / timeline / code / link 都画得出来', () => {
  const { renderSpec } = mod.internals;
  const tree = renderSpec({
    items: [
      { type: 'table', columns: ['站点', '耗时'], types: ['text', 'num'], rows: [['写', 6], ['调', 3]] },
      { type: 'chart', kind: 'bars', data: [{ label: '写作', value: 6 }, { label: '调试', value: 3 }] },
      { type: 'chart', kind: 'donut', data: [{ label: '甲', value: 2 }, { label: '乙', value: 1 }] },
      { type: 'steps', current: 1, steps: [{ title: '一' }, { title: '二', desc: '现在' }] },
      { type: 'timeline', items: [{ title: '早上', time: '09:00' }] },
      { type: 'code', lang: 'ts', code: 'const a = 1' },
      { type: 'json', value: { a: 1 } },
      { type: 'link', label: '文档', href: 'https://example.com' },
      { type: 'link', label: '坏链接', href: 'javascript:alert(1)' },
    ],
  });
  const nodes = flattenTree(tree);
  assert.equal(byClass(nodes, 'dl-g-table').length, 1);
  assert.equal(nodes.filter((node) => node.type === 'th').length, 2);
  assert.equal(nodes.filter((node) => node.type === 'td').length, 4);
  assert.equal(nodes.filter((node) => node.type === 'td' && node.props?.className === 'dl-g-table-cell dl-g-table--num').length, 2, 'num 列右对齐');
  assert.equal(nodes.filter((node) => node.type === 'th' && node.props?.className === 'dl-g-table-cell dl-g-table--num').length, 1, '表头也跟着列型右对齐');
  const hasClass = (nodes, name) => nodes.filter((node) => typeof node.props?.className === 'string'
    && node.props.className.split(' ').indexOf(name) !== -1);
  assert.equal(hasClass(nodes, 'dl-g-chart--bars').length, 1);
  assert.equal(hasClass(nodes, 'dl-g-chart--donut').length, 1);
  assert.equal(byClass(nodes, 'dl-g-steps').length, 1);
  assert.equal(nodes.filter((node) => node.props?.className === 'dl-g-step dl-g-step--now').length, 1, 'current 标出当前步');
  assert.equal(byClass(nodes, 'dl-g-timeline').length, 1);
  assert.equal(hasClass(nodes, 'dl-g-code').length, 2, 'code 与 json 都是 pre');
  const links = nodes.filter((node) => node.props?.className === 'dl-g-link');
  assert.equal(links.length, 2);
  assert.equal(links[0].type, 'a', 'http(s) 才做成链接');
  assert.equal(links[1].type, 'span', 'javascript: 只当文字');
  assert.ok(!nodes.some((node) => node.type === 'iframe'), '新节点也不走 iframe');
});

// ── 右栏 Today：结构化卡（按天分区）───────────────────────────────────────────
//
// 2026-11-15 深夜（主人「先两条链路保留一下」）：worker 写
// `$DSH_HOME/today/<日期>.json`，`{"cards":[{"title":"…","body":"…"}]}`；宿主一次
// 把今天 + 历史交过来。右栏把「天」映射成已有的 genui 词汇——分区头 = divider 的
// label，卡 = card 的 title + 一句 body——再交给左右栏共用的 renderSpec，
// 不另写第二套渲染器。旧 html 链路还在，开关是 client.js 的 FREE_HTML_UI。

/** 相对今天偏移 N 天的 `YYYY-MM-DD`（用例不绑死某一天）。 */
function stamp(offset) {
  const day = new Date();
  day.setDate(day.getDate() + offset);
  return day.getFullYear() + '-'
    + String(day.getMonth() + 1).padStart(2, '0') + '-'
    + String(day.getDate()).padStart(2, '0');
}

/** 解析后一份「今天 + 历史」响应，字段与宿主 index.js 对齐。 */
function dayReply(shape) {
  return { ok: true, json: async () => ({ ok: true, ...shape }) };
}

test('结构化链路：一次请求、按天分区渲卡、不长得像 iframe', { skip: uiOn }, async () => {
  reset();
  withMainSession();
  const asked = stubToday(dayReply({
    date: stamp(0),
    cards: [{ title: '九点的评审', body: '带上三页纸。' }],
    html: '<h1>整页 HTML 还在，只是没开</h1>',
    history: [],
  }));
  try {
    render();
    await settle();
    const nodes = render();
    assert.equal(asked.length, 1, '两条链路共用一次请求');
    assert.match(asked[0], /^\/dsh-daily\/api\/today\?date=\d{4}-\d{2}-\d{2}$/, '按今天问，日期写成 YYYY-MM-DD');
    assert.equal(nodes.filter((node) => node.type === 'iframe').length, 0, 'FREE_HTML_UI 关着就不长框');
    const cards = byClass(nodes, 'dl-g-card');
    assert.equal(cards.length, 1);
    assert.equal(textOf(cards[0]), '九点的评审带上三页纸。', '卡里只有标题 + 内容两行，不重复日期');
    assert.deepEqual(
      byClass(nodes, 'dl-g-divider dl-g-divider--labeled').map(textOf),
      [mod.internals.dayHeading(stamp(0), new Date())],
      '今天一块，分区头是日期');
    const all = whole(nodes);
    assert.ok(all.includes('结构化卡片'), '标题条说清走的是哪条链路');
    assert.ok(!all.includes(mod.internals.TODAY_EMPTY_TEXT), '有卡就不摆空态');
  } finally {
    delete fakeWindow.fetch;
  }
});

test('历史：按日期倒序往下排，每块开头是那天的分区头', async () => {
  reset();
  withMainSession();
  stubToday(dayReply({
    date: stamp(0),
    cards: [{ title: '今天的', body: '一件' }],
    html: null,
    history: [
      { date: stamp(-1), cards: [{ title: '昨天的', body: '两件' }] },
      { date: stamp(-2), cards: [{ title: '前天的', body: '三件' }] },
    ],
  }));
  try {
    render();
    await settle();
    const nodes = render();
    const heads = byClass(nodes, 'dl-g-divider dl-g-divider--labeled').map(textOf);
    const { dayHeading } = mod.internals;
    assert.deepEqual(heads, [
      dayHeading(stamp(0), new Date()),
      dayHeading(stamp(-1), new Date()),
      dayHeading(stamp(-2), new Date()),
    ], '今天在最上，历史照宿主给的倒序往下');
    const cards = byClass(nodes, 'dl-g-card').map(textOf);
    assert.deepEqual(cards, ['今天的' + '一件', '昨天的' + '两件', '前天的' + '三件']);
  } finally {
    delete fakeWindow.fetch;
  }
});

test('今天没卡：一句「今天还没有要注意的事情哦！」，历史照常往下排', async () => {
  reset();
  withMainSession();
  stubToday(dayReply({
    date: stamp(0),
    cards: [],
    html: null,
    history: [{ date: stamp(-1), cards: [{ title: '昨天', body: '还有这一条' }] }],
  }));
  try {
    render();
    await settle();
    const nodes = render();
    const all = whole(nodes);
    assert.ok(all.includes(mod.internals.TODAY_EMPTY_TEXT), '今天的空态是那句话');
    assert.equal(byClass(nodes, 'dl-g-divider dl-g-divider--labeled').length, 2, '今天的头 + 昨天的头');
    assert.deepEqual(byClass(nodes, 'dl-g-card').map(textOf), ['昨天还有这一条'], '历史照常显示');
  } finally {
    delete fakeWindow.fetch;
  }
});

test('读盘途中给骨架：不把「今天没卡」冒充成结果', async () => {
  reset();
  withMainSession();
  let release = null;
  fakeWindow.fetch = () => new Promise((resolve) => {
    release = () => resolve(dayReply({ date: stamp(0), cards: [], html: null, history: [] }));
  });
  try {
    const first = render();
    assert.equal(byClass(first, 'dl-skel-card').length, 3, '先摆三张骨架');
    assert.ok(!whole(first).includes(mod.internals.TODAY_EMPTY_TEXT), '还没读完，不冒充「今天没卡」');
    release();
    await settle();
    const nodes = render();
    assert.equal(byClass(nodes, 'dl-skel-card').length, 0, '读完骨架退场');
    assert.ok(whole(nodes).includes(mod.internals.TODAY_EMPTY_TEXT), '真没卡时才给空态');
  } finally {
    delete fakeWindow.fetch;
  }
});

test('坏形状当没有：半张卡不画、坏日期的历史整块不出现', async () => {
  reset();
  withMainSession();
  stubToday(dayReply({
    date: stamp(0),
    cards: [{ title: '只有标题' }, { body: '只有内容' }, null, '不是对象'],
    html: null,
    history: [
      { date: '不是日期', cards: [{ title: 'x', body: 'y' }] },
      { date: stamp(-1), cards: [] },
      { date: stamp(-2), cards: [{ title: '  ', body: '  ' }] },
    ],
  }));
  try {
    render();
    await settle();
    const nodes = render();
    assert.equal(byClass(nodes, 'dl-g-card').length, 0, '半张卡不画');
    assert.equal(byClass(nodes, 'dl-g-divider dl-g-divider--labeled').length, 1, '没卡的日子不画分区头');
    assert.ok(whole(nodes).includes(mod.internals.TODAY_EMPTY_TEXT), '于是回到空态');
  } finally {
    delete fakeWindow.fetch;
  }
});

test('宿主连不上（fetch 抛错）：不炸、不空白，仍是安静的今天空态', async () => {
  reset();
  withMainSession();
  fakeWindow.fetch = async () => { throw new Error('offline') };
  try {
    render();
    await settle();
    const nodes = render();
    assert.equal(nodes.filter((node) => node.type === 'iframe').length, 0);
    assert.ok(whole(nodes).includes(mod.internals.TODAY_EMPTY_TEXT), '整页还在，不是空白页');
  } finally {
    delete fakeWindow.fetch;
  }
});

test('dayHeading：卡里不写日期，分区头写「11 月 15 日」这种；跨年才带年份', () => {
  const { dayHeading } = mod.internals;
  const now = new Date('2026-11-15T12:00:00');
  assert.equal(dayHeading('2026-11-15', now), '11 月 15 日');
  assert.equal(dayHeading('2026-01-02', now), '1 月 2 日', '不补零，读起来才像日期');
  assert.equal(dayHeading('2025-12-31', now), '2025 年 12 月 31 日', '别的年份要带上年份');
  assert.equal(dayHeading('不是日期', now), '不是日期', '算不出来就原样摆着，不吞字');
  assert.equal(dayHeading(undefined, now), '');
});

test('todaySpec：一张卡就是「标题 + 内容」两行，卡里不重复日期', () => {
  const { todaySpec } = mod.internals;
  const spec = todaySpec({
    date: '2026-11-15',
    cards: [{ title: '事件标题', body: '一两句内容' }],
    history: [{ date: '2026-11-14', cards: [{ title: '昨天的标题', body: '昨天的话' }] }],
  }, new Date('2026-11-15T12:00:00'));
  assert.deepEqual(spec.items[0], { type: 'divider', label: '11 月 15 日' });
  assert.equal(spec.items[1].type, 'card');
  assert.equal(spec.items[1].title, '事件标题');
  assert.deepEqual(spec.items[1].items, [{ type: 'text', content: '一两句内容', size: 'body' }]);
  assert.deepEqual(spec.items[2], { type: 'divider', label: '11 月 14 日' });
  assert.equal(spec.items[3].title, '昨天的标题');
  assert.ok(!JSON.stringify(spec).includes('2026-11-15'), '日期只在分区头，卡里不写');
});

test('todaySpec：带 nodes 的卡按「标题 + 正文 + 图」排，正文可省', () => {
  const { todaySpec } = mod.internals;
  const spec = todaySpec({
    date: '2026-11-15',
    cards: [
      {
        title: '带图的新卡',
        body: '一句正文',
        nodes: [
          { type: 'badge', label: '线索级', tone: 'warn' },
          { type: 'chart', kind: 'bars', data: [{ label: '缓存命中', value: 0.5 }] },
        ],
      },
      { title: '只有图', nodes: [{ type: 'text', content: '一句话' }] },
      { title: '旧格式', body: '两行字' },
      { title: '坏 nodes', body: '正文还在', nodes: '不是数组' },
    ],
    history: [],
  }, new Date('2026-11-15T12:00:00'));
  assert.deepEqual(spec.items[0], { type: 'divider', label: '11 月 15 日' });
  assert.deepEqual(spec.items[1], {
    type: 'card',
    title: '带图的新卡',
    items: [
      { type: 'text', content: '一句正文', size: 'body' },
      { type: 'badge', label: '线索级', tone: 'warn' },
      { type: 'chart', kind: 'bars', data: [{ label: '缓存命中', value: 0.5 }] },
    ],
  });
  assert.deepEqual(spec.items[2], { type: 'card', title: '只有图', items: [{ type: 'text', content: '一句话' }] });
  assert.deepEqual(spec.items[3], {
    type: 'card',
    title: '旧格式',
    items: [{ type: 'text', content: '两行字', size: 'body' }],
  }, '没有 nodes 的旧卡行为不变');
  assert.deepEqual(spec.items[4], {
    type: 'card',
    title: '坏 nodes',
    items: [{ type: 'text', content: '正文还在', size: 'body' }],
  }, 'nodes 不是数组时当没有，正文照常');
});

test('cardsOf：nodes 原样留着；非数组当没有；没正文也没 nodes 的卡不留', () => {
  const { cardsOf } = mod.internals;
  const nodes = [{ type: 'badge', label: '仅知悉' }];
  const cards = cardsOf([
    { title: '新卡', body: '正文', nodes },
    { title: '只有图', nodes },
    { title: '坏 nodes', body: '正文', nodes: '不是数组' },
    { title: '空 nodes 没正文', nodes: [] },
    { title: '标题带空白', body: '正文' },
  ]);
  assert.equal(cards.length, 4);
  assert.deepEqual(cards[0], { title: '新卡', body: '正文', nodes });
  assert.deepEqual(cards[1], { title: '只有图', body: '', nodes });
  assert.deepEqual(cards[2], { title: '坏 nodes', body: '正文', nodes: undefined }, '非数组 nodes 当没有');
  assert.deepEqual(cards[3], { title: '标题带空白', body: '正文', nodes: undefined });
});

test('带 nodes 的卡真的画出来：徽标 + 强调句 + 小图表同卡，旧格式卡并存', async () => {
  reset();
  withMainSession();
  stubToday(dayReply({
    date: stamp(0),
    cards: [
      {
        title: '两条降价先停在线索级',
        body: '官网原文还没现抓过，数字先记着，不下结论。',
        nodes: [
          {
            type: 'row',
            items: [
              { type: 'badge', label: '线索级', tone: 'warn' },
              { type: 'badge', label: '待核实', tone: 'warn' },
            ],
          },
          { type: 'text', content: '缓存命中 0.5 元 / 百万 tokens', size: 'h3' },
          {
            type: 'chart',
            kind: 'bars',
            data: [{ label: '缓存命中', value: 0.5 }, { label: '单任务', value: 11.16 }],
          },
          { type: 'tabs', tabs: [{ label: '未知节点', items: [] }] },
        ],
      },
      { title: '旧格式卡', body: '还是标题加两行字。' },
    ],
    history: [],
  }));
  try {
    render();
    await settle();
    const nodes = render();
    const cards = byClass(nodes, 'dl-g-card');
    assert.equal(cards.length, 2, '带图卡与旧格式卡都在');
    const first = cards.map(textOf).find((text) => text.includes('两条降价'));
    assert.ok(first.includes('线索级') && first.includes('待核实'), '徽标画出来了');
    assert.ok(first.includes('官网原文还没现抓过'), '正文画出来了');
    assert.ok(first.includes('缓存命中 0.5 元 / 百万 tokens'), '强调句画出来了');
    assert.equal(
      nodes.filter((node) => node.props?.className === 'dl-g-chart-row').length,
      2,
      '小图表两条柱',
    );
    assert.ok(!first.includes('未知节点'), '未知节点只丢自己，不连坐整张卡');
    const legacy = cards.map(textOf).find((text) => text.includes('旧格式卡'));
    assert.equal(legacy, '旧格式卡还是标题加两行字。', '旧格式仍是标题 + 正文两行');
  } finally {
    delete fakeWindow.fetch;
  }
});

/** 让宿主的 /dsh-daily/api/today 回一份可预期的答案。返回记录请求地址的盒子。 */
function stubToday(reply) {
  const asked = []
  fakeWindow.fetch = async (url) => {
    asked.push(String(url))
    return reply
  }
  return asked
}

test('worker 写了今天那一页：右栏渲成沙箱 iframe，不摆空态', { skip: !uiOn }, async () => {
  reset();
  withMainSession();
  const asked = stubToday({ ok: true, json: async () => ({ ok: true, html: '<h1>今天三件事</h1>' }) });
  try {
    render();
    await settle();
    const nodes = render();
    const frames = nodes.filter((node) => node.type === 'iframe');
    assert.equal(frames.length, 1, '右栏 Today 应该有一个框');
    assert.equal(frames[0].props.sandbox, 'allow-scripts', '和左栏同一套边界');
    assert.ok(frames[0].props.srcDoc.includes('今天三件事'), 'worker 的 HTML 原样进 srcdoc');
    assert.ok(frames[0].props.srcDoc.includes("connect-src 'none'"), '框里断网');
    assert.equal(byClass(nodes, 'dl-g-card').length, 0, '有真页面就不再摆空态');
    assert.ok(whole(nodes).includes('worker 写的 HTML'), '标题条要说清这是 worker 写的');
    assert.equal(asked.length, 1, '只问一次');
    assert.match(asked[0], /^\/dsh-daily\/api\/today\?date=\d{4}-\d{2}-\d{2}$/, '按今天问，日期写成 YYYY-MM-DD');
  } finally {
    delete fakeWindow.fetch;
  }
});

test('今天还没人写（404）：只给一句空态，不再摆示例卡', { skip: !uiOn }, async () => {
  reset();
  withMainSession();
  stubToday({ ok: false, status: 404, json: async () => ({ ok: false, message: '还没有人写' }) });
  try {
    render();
    await settle();
    const nodes = render();
    const all = whole(nodes);
    assert.equal(nodes.filter((node) => node.type === 'iframe').length, 0, '没有内容就不该长框');
    assert.ok(all.includes('自由 HTML 通道开着，今天没有 HTML'), '标题条要说清没有 HTML');
    assert.ok(all.includes(mod.internals.TODAY_EMPTY_TEXT), '空态退回结构化那句');
    for (const gone of ['今天天气', '每日推荐', '示例数据', '示例封面', '8:00 晨间简报', '身体信号', '快速打开']) {
      assert.ok(!all.includes(gone), `示例内容「${gone}」应该已经删掉`);
    }
    assert.equal(byClass(nodes, 'dl-g-badge').length, 0, '不再有「示例」角标');
    assert.equal(byClass(nodes, 'dl-g-stat').length, 0, '不再有假指标');
    assert.equal(nodes.filter((node) => node.type === 'img').length, 0, '不再有示例配图');
  } finally {
    delete fakeWindow.fetch;
  }
});

test('宿主连不上（fetch 抛错）：不炸、不空白，仍是安静的空态', { skip: !uiOn }, async () => {
  reset();
  withMainSession();
  fakeWindow.fetch = async () => { throw new Error('offline') };
  try {
    render();
    await settle();
    const nodes = render();
    const all = whole(nodes);
    assert.equal(nodes.filter((node) => node.type === 'iframe').length, 0);
    assert.ok(all.includes(mod.internals.TODAY_EMPTY_TEXT), '整页还在，不是空白页');
    assert.ok(!all.includes('示例数据'), '不拿假数据填空白');
  } finally {
    delete fakeWindow.fetch;
  }
});

test('卡片文档注入主题变量：她写 var(--dl-ink) 就是这页的墨色', () => {
  const { uiDocument } = mod.internals;
  const withVars = uiDocument('<p>hi</p>', '--dl-ink:#123456;--dl-paper:#abcdef');
  assert.ok(withVars.includes(':root{--dl-ink:#123456;--dl-paper:#abcdef}'), '变量要进 :root');
  assert.ok(withVars.includes('var(--dl-ink,#241c16)'), '基础排版要用变量，并留兜底');
  assert.ok(withVars.includes('var(--dl-paper'), '纸色同理');
  assert.ok(withVars.indexOf(':root{') < withVars.indexOf('var(--dl-ink'), ':root 必须在用它的样式之前');
  /* 没有变量时不留空 :root，也不许因此变成坏文档 */
  const bare = uiDocument('<p>hi</p>');
  assert.ok(!bare.includes(':root{'), '采集不到就不写空规则');
  assert.ok(bare.includes('Content-Security-Policy'), '没变量也要有 CSP');
});

test('主题变量采集：拿不到 document 时安静返回空，不抛', () => {
  const { uiThemeVars } = mod.internals;
  assert.equal(typeof uiThemeVars, 'function');
  assert.equal(uiThemeVars(), '', '这段代码也可能在服务端/测试里被调到');
});

test('主题变量采集：从 .dl 的 computed style 抠 token，带尖括号的值丢掉', () => {
  const { uiThemeVars } = mod.internals;
  const values = {
    '--dl-ink': ' #241c16 ',
    '--dl-paper': '#fffdfa',
    '--dl-rule': 'rgb(120 86 62/.35)',
    '--dl-grad': 'linear-gradient(135deg,#ff9538 0%,#ff6f61 100%)',
    '--dl-brand': '</style><script>alert(1)</script>',
  };
  /* 模块加载时就把 document 参数收下了，所以要改同一个对象，不能换新的。 */
  const doc = globalThis.document;
  doc.querySelector = () => ({ nodeName: 'DIV' });
  globalThis.getComputedStyle = () => ({ getPropertyValue: (name) => values[name] ?? '' });
  try {
    const css = uiThemeVars();
    assert.ok(css.includes('--dl-ink:#241c16'), '两头的空格要去掉');
    assert.ok(css.includes('--dl-rule:rgb(120 86 62/.35)'), '带括号和斜杠的值要保住');
    assert.ok(css.includes('--dl-grad:linear-gradient('), '渐变要保住');
    assert.ok(!css.includes('<') && !css.includes('>'), '带尖括号的值必须丢掉，否则能提前闭合 style');
    assert.ok(!css.includes('--dl-paper-3'), '取不到值的 token 不该出现空声明');
  } finally {
    delete doc.querySelector;
    delete globalThis.getComputedStyle;
  }
});

test('卡片按钮：点了只把话填进输入框，一个字都不发出去', () => {
  const { deliverUiPick } = mod.internals;
  render();
  const input = () => render()
    .find((node) => node.props && node.props.className === 'dl-input dl-input--area');
  assert.equal(input().props.value, '', '一开始输入框是空的');

  harness.sends = [];
  deliverUiPick('  先做评审  ');
  assert.equal(input().props.value, '先做评审', '两头空白要去掉，话要进输入框');
  assert.equal(harness.sends.length, 0, '点了不能自己发——发不发由人按');

  /* 已经在打字：另起一行，不覆盖 */
  input().props.onChange({ target: { value: '我先说一句' } });
  deliverUiPick('先做评审');
  assert.equal(input().props.value, '我先说一句\n先做评审');
  assert.equal(harness.sends.length, 0);

  /* 空白、非字符串：什么都不做 */
  for (const bad of ['   ', '\n\n', null, 42, undefined, { text: 'x' }]) deliverUiPick(bad);
  assert.equal(input().props.value, '我先说一句\n先做评审', '空话不该改写输入框');
  assert.equal(harness.sends.length, 0);
});

test('卡片按钮送来的话：清洗规则（换行统一、超长截断）', () => {
  const { uiPickText } = mod.internals;
  assert.equal(uiPickText('a\r\nb\rc'), 'a\nb\nc', 'CRLF 与单独的 CR 都要归一');
  assert.equal(uiPickText('  x  '), 'x');
  assert.equal(uiPickText('x'.repeat(600)).length, 500, '截断到 500 字');
  assert.equal(uiPickText(null), '');
  assert.equal(uiPickText(123), '');
});

test('卡片按钮：没有挂接收端时安静丢弃，不抛', () => {
  const { deliverUiPick, setUiPickSink } = mod.internals;
  setUiPickSink(null);
  assert.doesNotThrow(() => deliverUiPick('没人接的话'));
  assert.doesNotThrow(() => setUiPickSink('不是函数'));
  assert.doesNotThrow(() => deliverUiPick('还是没人接'));
});

test('Today 页没有数据时不再有示例卡与演示简报：只留一天的空态', async () => {
  reset();
  render();
  await settle();
  const nodes = render();
  const all = whole(nodes);
  for (const gone of [
    '今天天气', '每日推荐', '示例数据', '示例封面', '示例配图 · 本地 SVG，不联网',
    '8:00 晨间简报', '三件要紧的事都在这里', '身体信号', '快速打开', '待你确认',
    '接下来的安排', '团队站会', '学校旅行准备', '本地演示 · 所有改动仅保存在当前页面',
  ]) {
    assert.ok(!all.includes(gone), `演示内容「${gone}」应该已经删掉`);
  }
  assert.equal(byClass(nodes, 'dl-g-badge').length, 0, '不再有「示例」角标');
  assert.equal(byClass(nodes, 'dl-g-stat').length, 0, '不再有假指标');
  assert.equal(nodes.filter((node) => node.type === 'img').length, 0, '不再有示例配图');
  assert.ok(all.includes(mod.internals.TODAY_EMPTY_TEXT), '留下的是一句空态');
  assert.equal(byClass(nodes, 'dl-g-card').length, 0, '一张卡都不摆');
  assert.equal(byClass(nodes, 'dl-g-divider dl-g-divider--labeled').length, 1, '今天那块的分区头还在');
});

test('任务页不再有演示任务：假计数与筛选器一起退场，只剩空态', () => {
  const nodes = render();
  const tab = byClass(nodes, 'dl-tab').find((node) => textOf(node) === '任务');
  assert.ok(click(tab), '点标签应触发重渲染');
  const next = render();
  const all = whole(next);
  for (const gone of [
    '4 个任务', '2 个进行中或待确认', '新建任务', '4 个结果',
    '把 3 封未读邮件归类', '准备学校旅行清单', '汇总设计评审反馈', '监控机票价格',
    '提示：任务只在本地模拟运行',
  ]) {
    assert.ok(!all.includes(gone), `演示内容「${gone}」应该已经删掉`);
  }
  assert.equal(byClass(next, 'dl-g-seg-opt').length, 0, '没有任务就不再摆筛选器');
  assert.equal(byClass(next, 'dl-g-card').length, 1, '只剩一张空态卡');
  assert.ok(all.includes('她接下任务之后，这里会列出来。'), '空态说清以后放什么');
});

test('悄悄话页是占位：说清还没做、为什么现在不做', () => {
  const nodes = render();
  const tab = byClass(nodes, 'dl-tab').find((node) => textOf(node) === '悄悄话');
  click(tab);
  const next = render();
  const all = whole(next);
  for (const line of [
    '悄悄话', '她没问、但注意到的事，以及她想改的地方',
    '这一页还没有做', '待实现',
    '以后这里放两类话：你没问但她注意到的（小贴士、提醒），以及她自己想改的地方。',
    '占位 · 暂无数据源，不接任何接口',
  ]) {
    assert.ok(all.includes(line), `缺「${line}」`);
  }
  assert.ok(all.includes('《心流》自主能力系统与《野兔》情绪系统'), '占位要说清等什么才做');
  /* 占位页不摆控件：没有开关、没有分段筛选。 */
  assert.equal(byClass(next, 'dl-g-switch').length, 0, '悄悄话页不该有开关');
  assert.equal(byClass(next, 'dl-g-seg-opt').length, 0, '悄悄话页不该有筛选');
});

test('交互：切标签会换页', async () => {
  reset();
  withMainSession();
  let nodes = render();
  await settle();
  nodes = render();
  assert.ok(whole(nodes).includes(mod.internals.TODAY_EMPTY_TEXT), 'Today 页只有一句空态');

  const tasksTab = byClass(nodes, 'dl-tab').find((node) => textOf(node) === '任务');
  click(tasksTab);
  nodes = render();
  assert.ok(whole(nodes).includes('她接下任务之后，这里会列出来。'), '任务页换成空态');

  const whisperTab = byClass(nodes, 'dl-tab').find((node) => textOf(node) === '悄悄话');
  click(whisperTab);
  nodes = render();
  assert.equal(byClass(nodes, 'dl-g-card').length, 1, '悄悄话页只有一张占位卡');
});

// ── 右栏：genui spec 渲染 ─────────────────────────────────────────────────────

/* 摊平任意假元素树（不展开函数组件），给下面的 spec 断言用。 */
function flattenTree(node) {
  const out = [];
  const walk = (current) => {
    if (current === null || current === undefined || typeof current !== 'object') return;
    if (Array.isArray(current)) { current.forEach(walk); return; }
    out.push(current);
    for (const child of current.children ?? []) walk(child);
  };
  walk(node);
  return out;
}

const depthOf = (node) => {
  let depth = 1;
  let current = node;
  while (current && Array.isArray(current.items) && current.items.length > 0) {
    depth += 1;
    current = current.items[0];
  }
  return depth;
};

test('validateSpec 兜住限额：深度 ≤ 8、节点 ≤ 200、字符串 ≤ 2000', () => {
  const { validateSpec } = mod.internals;

  /* 深度：7 层 row 再套一层文本，最深处正好第 8 层，留下。 */
  const chain = (levels) => {
    let node = { type: 'text', content: '底' };
    for (let index = 0; index < levels; index += 1) node = { type: 'row', items: [node] };
    return node;
  };
  assert.equal(depthOf(validateSpec({ items: [chain(7)] }).items[0]), 8, '第 8 层应该留下');
  /* 8 层 row：文本落在第 9 层被丢掉；装不了东西的容器也跟着消失（与上游一致）。 */
  assert.deepEqual(validateSpec({ items: [chain(8)] }).items, [], '第 9 层往下整条链都不该留下');

  const many = validateSpec({
    items: Array.from({ length: 201 }, (_, index) => ({ type: 'text', content: 'n' + index })),
  });
  assert.equal(many.items.length, 200, '超过 200 个节点应截断尾巴');
  assert.equal(many.items[0].content, 'n0');
  assert.equal(many.items[199].content, 'n199');

  const long = validateSpec({ items: [{ type: 'text', content: 'x'.repeat(2500) }] });
  assert.equal(long.items[0].content.length, 2000, '字符串应截到 2000');
});

test('validateSpec 剔除非法类型与非法字段，兄弟节点照常在', () => {
  const { validateSpec } = mod.internals;
  const clean = validateSpec({
    gap: 999,
    items: [
      { type: 'text', content: '在' },
      { type: 'unknown-widget' },
      { type: 'text' },
      { type: 'progress', value: 999 },
      { type: 'image', src: 'javascript:alert(1)' },
      { type: 'grid', cols: 99, items: [{ type: 'text', content: '格' }] },
      { type: 'text', content: '还在' },
    ],
  });
  assert.deepEqual(clean.items.map((node) => node.type), ['text', 'progress', 'grid', 'text']);
  assert.equal(clean.items[1].value, 100, 'progress.value 夹回 0–100');
  assert.equal(clean.items[2].cols, 12, 'grid.cols 夹到 12');
  assert.equal(clean.gap, 40, 'spec.gap 夹到 0–40');
});

test('坏节点只丢自己：renderSpec 继续渲染兄弟节点', () => {
  const { renderSpec } = mod.internals;
  const tree = renderSpec({
    items: [
      { type: 'text', content: '前' },
      { type: 'nope' },
      { type: 'card', items: [{ type: 'text', content: '卡里' }] },
      { type: 'text', content: '后' },
    ],
  });
  assert.equal(tree.props.className, 'dl-g-root');
  const nodes = flattenTree(tree);
  const texts = nodes.filter((node) => typeof node.props?.className === 'string'
    && node.props.className.indexOf('dl-g-text') === 0).map(textOf);
  assert.deepEqual(texts, ['前', '卡里', '后']);
});

test('三个 tab 都从 spec 渲染：右栏只剩 .dl-g-*，没有手写卡片 DOM', async () => {
  reset();
  withMainSession();
  let nodes = render();
  await settle();
  nodes = render();
  const pages = [];
  for (const label of ['Today', '任务', '悄悄话']) {
    const tab = byClass(nodes, 'dl-tab').find((node) => textOf(node) === label);
    assert.ok(tab, `缺「${label}」标签`);
    click(tab);
    nodes = render();
    assert.ok(byClass(nodes, 'dl-g-root').length > 0, `${label} 页应由 spec 渲染`);
    assert.equal(byClass(nodes, 'dl-panel').length, 0, `${label} 页不该再有手写卡片`);
    assert.equal(byClass(nodes, 'dl-chip').length, 0, `${label} 页不该再有手写 chip`);
    pages.push(whole(nodes));
  }
  assert.equal(pages.length, 3);
});
