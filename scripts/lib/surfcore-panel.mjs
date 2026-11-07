// The pinned client already exports its complete console. Reuse it in the same
// DSH panel slots as Superagent instead of registering a Settings section.
const settingsEntry = `    function apply(ctx) {
      ctx.effect(
        () =>
          ctx.slots.inject("settings.section", () =>
            ctx.slots.register(
              { name: "settings.section", id: NS, order: 7, label: () => NAMES.nav },
              QQBIliWhaleSection,
            ),
            "surfcore: settings section",
          ),
        "surfcore: settings section",
      );
    }`

const panelEntry = `    function SurfCoreIcon({ size }) {
      return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none",
        stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
        h("path", { d: "M3 12c3-4 6-4 9 0s6 4 9 0" }),
        h("path", { d: "M3 17c3-4 6-4 9 0s6 4 9 0" }),
        h("path", { d: "M7 6c2-1 4-1 6 0" }));
    }

    function SurfCorePanel() {
      return h("div", { className: "surfcore-panel" },
        h(QQBIliWhaleSection),
        h("style", null, ".surfcore-panel{box-sizing:border-box;height:100%;overflow:auto;padding:28px clamp(16px,4vw,48px) 48px}.surfcore-panel .qbw-app{max-width:1200px;overflow:visible}.surfcore-panel .qbw-body{max-height:none;overflow:visible}.surfcore-panel .qbw-foot{background:var(--dsw-alias-bg-layer-1,#fff);z-index:2}"));
    }

    function apply(ctx) {
      ctx.slots.inject("main", () => ctx.slots.register(
        { name: "main", key: NS, inject: () => ({}) }, SurfCorePanel));
      ctx.slots.inject("sidebar.panellist", () => ctx.slots.register(
        { name: "sidebar.panellist", id: NS, order: 10, label: () => NAMES.nav }, SurfCoreIcon));
    }`

export const GENERATED_CLIENT_HEADER = '// Generated from the pinned SurfCore client by the project; edit scripts/lib/surfcore-panel.mjs instead.\n'

/** Create a browser bundle while leaving the upstream checkout unchanged. */
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`The pinned SurfCore client no longer matches the component adapter: ${before.slice(0, 80)}`)
  return source.replace(before, after)
}

function replaceRange(source, start, end, replacement = '') {
  if (source.split(start).length !== 2 || source.split(end).length !== 2) throw new Error(`The pinned SurfCore client no longer matches the component adapter: ${start.slice(0, 80)} (${source.split(start).length - 1}) → ${end.slice(0, 80)} (${source.split(end).length - 1})`)
  const first = source.indexOf(start); const last = source.indexOf(end)
  if (last <= first) throw new Error('The pinned SurfCore client has an unexpected component order')
  return source.slice(0, first) + replacement + source.slice(last)
}

export function renderSurfcorePanelClient(source, { splitComponents = false } = {}) {
  const normalized = source.replaceAll('\r\n', '\n')
  if (normalized.split(settingsEntry).length !== 2) {
    throw new Error('The pinned SurfCore client no longer matches the panel adapter.')
  }
  let client = normalized.replace(settingsEntry, panelEntry)
  client = replaceOnce(client, 'api("/owner-audit/open", { method: "POST", body: { action: "open" } })', 'api("/owner-audit", { method: "POST", body: { action: "open" } })')
  client = replaceOnce(client, '        try { setData(await api("/owner-audit?limit=50")); setErr(""); }\n        catch (e) { setErr(e.message); }', '        try { const result = await api("/owner-audit?limit=50"); if (result.ok === false || !Array.isArray(result.entries)) throw new Error(result.error || "管理操作记录格式无效"); setData(result); setErr(""); }\n        catch (e) { setData(null); setErr(e.message); }')
  client = replaceOnce(client, '            : h("p", { className: "qbw-hint" }, "还没有记录。"),', '            : (err ? null : h("p", { className: "qbw-hint" }, data ? "还没有记录。" : "正在读取…")),')
  for (const entry of ['      ["characters", "角色"],\n', '      ["pet", "桌宠"],\n']) {
    if (client.split(entry).length !== 2) throw new Error('The pinned SurfCore tabs no longer match the panel adapter.')
    client = client.replace(entry, '')
  }
  if (splitComponents) {
    client = replaceOnce(client, '    function SurfCorePanel() {', `    function MemoryCapacityAlert({ openMemory }) {
      const [alert, setAlert] = useState(null);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const snooze = useRef(0);
      const revision = useRef(0);
      async function memoryRequest(body) {
        const response = await fetch('/dsh-memory/api/card', body ? {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        } : {});
        const result = await response.json();
        if (!response.ok || result.ok === false) throw new Error(result.error || '记忆插件请求失败');
        return result;
      }
      useEffect(() => {
        let stopped = false;
        const check = async () => {
          const current = revision.current;
          try {
            const result = await memoryRequest();
            if (stopped || current !== revision.current) return;
            const status = result.status || {};
            const level = Math.max(Number(status.level) || 0, Number(status.alertLevel) || 0);
            setAlert(result.config?.enabled !== false && level > (Number(status.acknowledgedLevel) || 0) && Date.now() > snooze.current ? { ...status, level } : null);
          } catch { if (!stopped && current === revision.current) setAlert(null); }
        };
        void check();
        const timer = setInterval(check, 60000);
        return () => { stopped = true; clearInterval(timer); };
      }, []);
      async function act(body) {
        setBusy(true); setError(''); revision.current++;
        try { await memoryRequest(body); setAlert(null); }
        catch (e) { setError(e.message || '操作失败'); }
        finally { setBusy(false); }
      }
      function later() { revision.current++; snooze.current = Date.now() + 2 * 60 * 60 * 1000; setAlert(null); setError(''); }
      if (!alert) return null;
      return h('div', { className: 'qbw-modal-backdrop', onClick: e => { if (e.target === e.currentTarget && !busy) later(); } },
        h('div', { className: 'qbw-modal', role: 'dialog', 'aria-modal': true, 'aria-label': '记忆容量提醒' },
          h('h3', null, '🧠 记忆卡快满了'),
          h('p', null, (alert.unlimited ? '记忆卡已达到警告值的 ' : '记忆卡已使用 ') + (alert.percent ?? 0) + '%（' + (alert.chars ?? 0) + '/' + (alert.unlimited ? (alert.warnChars ?? 0) : (alert.maxChars ?? 0)) + ' 字）。'),
          h('p', null, '可以立即压缩，或在侧栏打开记忆插件查看详情。'),
          error ? h('p', { className: 'qbw-err', role: 'alert' }, error) : null,
          h('div', { className: 'qbw-actions' },
            h('button', { className: 'qbw-btn', disabled: busy, onClick: () => act({ action: 'compact', targetRatio: 0.8 }) }, '立即压缩到 80%'),
            h('button', { className: 'qbw-btn qbw-btn2', disabled: busy, onClick: () => { try { openMemory(); } catch (e) { setError(e.message || '无法打开记忆页面'); } } }, '去记忆页看看'),
            h('button', { className: 'qbw-btn2', disabled: busy, onClick: later }, '2 小时后再提醒'),
            h('button', { className: 'qbw-btn2', disabled: busy, onClick: () => act({ action: 'ack', level: alert.level }) }, '本次不再提醒'))));
    }

    function SurfCorePanel({ openMemory } = {}) {`)
    client = replaceOnce(client, '        h(QQBIliWhaleSection),\n        h("style",', '        h(QQBIliWhaleSection),\n        h(MemoryCapacityAlert, { openMemory }),\n        h("style",')
    client = replaceOnce(client, '{ name: "main", key: NS, inject: () => ({}) }, SurfCorePanel)', '{ name: "main", key: NS, inject: () => ({ openMemory: () => ctx.layout.selectPanel("memory") }) }, SurfCorePanel)')
    client = replaceOnce(client, '    const inject = ["slots"];', '    const inject = ["slots", "layout"];')
    for (const entry of ['      ["voice", "语音"],\n', '      ["memory", "记忆"],\n']) client = replaceOnce(client, entry, '')
    client = replaceRange(client, '    function PersonaEditor(', '    function AlignTab(', '')
    client = replaceRange(client, '    function CharactersTab(', '    // ── 每日 token 额度', '')
    client = replaceRange(client, '    function PetTab(', '    // ── 主组件', '')
    client = replaceRange(client, '    // ── 目的机制 · 载体选择（桌宠 / QQ）', '    // ── 对话收尾判断', `    function PurposeTab({ qq, setQq, busy, setBusy, toast }) {
      return h(PurposeCard, { cfg: qq, set: setQq, busy, setBusy, toast, carrier: 'qq' });
    }

`)
    client = replaceRange(client, '        status?.availability ? h("div", { className: "qbw-hint"', '        status ? h("div", { className: "qbw-hint"', '')
    client = replaceOnce(client, '              "载体在顶部卡片里选：桌宠 = 气泡/语音，QQ = 私聊；两边共用这一套逻辑与状态。"', '              "主动搭话通过 QQ 私聊发送。"')
    client = replaceOnce(client, '不是关键词触发器：从 QQ + B站 + 人格卡 + 记忆卡里形成', '不是关键词触发器：从 QQ + B站 + 记忆卡里形成')
    client = replaceOnce(client, '["素材", st.materialCount ?? "—", "QQ/B站/记忆/人格"]', '["素材", st.materialCount ?? "—", "QQ/B站/记忆"]')
    client = replaceOnce(client, '有 pending / 人格卡 / 记忆卡时不受此限', '有待处理目的或记忆卡时不受此限')
    client = replaceOnce(client, '重启/换角色后第一枪的起跑延迟', '重启后的首次主动搭话延迟')
    client = replaceOnce(client, '这一层高于记忆同步开关：即使两边记忆同步都关掉，只要对齐开着，人格卡仍然认得出同一个人。', '身份对齐独立于记忆同步开关，用于识别不同平台上的同一账号。')
    client = replaceOnce(client, '优先于群名片 / B站昵称 / 人格卡称呼表', '优先于群名片 / B站昵称')
    client = replaceOnce(client, 'status.carrier === "pet" ? "载体：桌宠" : "载体：QQ"', '"载体：QQ"')
    client = replaceOnce(client, '{ title: "人格与提示", members: ["人格与注入", "一代仿真（reserved）", "二代仿真（reserved2）"] }', '{ title: "仿真与提示", members: ["一代仿真（reserved）", "二代仿真（reserved2）"] }')
    client = replaceOnce(client, '          "载体 = 桌宠时：所有节奏参数保存即生效（插件每次读配置）；不需要重启桥接。",\n          "载体 = QQ 时：节奏参数要重启桥接才生效（桥接只在启动时读 config.json），但切换载体本身 30 秒内生效。",\n          "目的状态跟着当前角色走：换人格卡/记忆卡后按新角色重新生成动机，不会继承上一个角色。",', '          "节奏参数保存后需要重启 QQ 桥接才生效。",')
    client = replaceRange(client,
      '          h("div", { className: "qbw-card" },\n            h("h4", null, "B站 ", h(StatusDot, { ok: Boolean(bili.available)',
      '          h("div", { className: "qbw-card" },\n            h("h4", null, "启动"),',
      '          h("div", { className: "qbw-card" }, h("h4", null, "B站"), h("p", null, scheduler.running ? "运行中" : "未运行"), h("p", null, `身份对齐 ${align.links ?? 0} 条`)),\n')
    client = replaceRange(client,
      '              h("label", { className: "qbw-row", style: { alignItems: "center", gap: "6px", marginRight: "10px" } },\n                h("input", { type: "checkbox", checked: launchSel.pet',
      '              h("label", { className: "qbw-row", style: { alignItems: "center", gap: "6px" } },\n                h("input", { type: "checkbox", checked: launchSel.voice', '')
    client = replaceOnce(client, 'const [launchSel, setLaunchSel] = useState({ qq: true, bili: true, pet: false, voice: false });', 'const [launchSel, setLaunchSel] = useState({ qq: true, bili: true, voice: false });')
    client = replaceOnce(client, 'toast(`✓ 扫描完成：QQ +${r.qq?.added ?? 0}，B站 +${r.bili?.added ?? 0}`);', 'toast(r.bili?.ok === false ? `QQ 扫描 +${r.qq?.added ?? 0}；B站扫描未完成：${r.bili?.error || "未知错误"}` : `QQ 扫描 +${r.qq?.added ?? 0}，B站 +${r.bili?.added ?? 0}${r.bili?.unresolved ? `，${r.bili.unresolved} 条未能确认正文` : ""}${r.bili?.failedSources?.length ? `；部分来源未完成：${r.bili.failedSources.map(x => x === "reply" ? "回复" : "提及").join("、")}` : ""}`);')
    client = replaceOnce(client, '? ["qq", "bili", "pet", "voice"]', '? ["qq", "bili", "voice"]')
    client = replaceOnce(client, '[["qq", "QQ"], ["bili", "B站"], ["pet", "桌宠"], ["voice", "语音"]]', '[["qq", "QQ"], ["bili", "B站"], ["voice", "语音"]]')
    client = replaceOnce(client, '一键停止只停 SurfCore 托管的 QQ 桥接、B站生物钟、桌宠和语音包，不会关闭 SnowLuma 本体。人格卡在「角色」页维护。', '一键停止会停止 QQ 桥接、B站生物钟及语音插件启动的语音包，不会关闭 SnowLuma 本体。')
    client = replaceOnce(client, '      const [memoryAlert, setMemoryAlert] = useState(null);\n      const memorySnoozeRef = useRef(0);\n', '')
    client = replaceRange(client, '      useEffect(() => {\n        let stop = false;\n        const check = async () => {\n          try {\n            const r = await api("/memory-card");', '      const setQqPath =', '')
    client = replaceRange(client, '      // 容量弹窗的三个出口：', '      if (!qq || !bili || !unified) {', '')
    client = replaceRange(client, '        memoryAlert ? h("div", { className: "qbw-modal-backdrop"', '      );\n    }\n\n    const inject =', '')
    for (const line of [
      '        if (tab === "characters") return h(CharactersTab, { overview, busy, setBusy, toast: notify, reload, goTab: setTab, unified, setUnified: setUnifiedPath });\n',
      '        if (tab === "voice") return h(VoiceTab, { toast: notify });\n',
      '        if (tab === "pet") return h(PetTab, { toast: notify, unified, setUnified: setUnifiedPath });\n',
      '        if (tab === "memory") return h(MemoryTab, { qq: normalizedQq, unified, setUnified: setUnifiedPath, overview, busy, setBusy, toast: notify, reload });\n',
    ]) client = replaceOnce(client, line, '')
    client = replaceOnce(client, 'SurfCore 一个窗口管两边：QQ 的桥接与参数、B站养鱼参数、记忆卡、双向脱敏记忆、身份对齐，以及后续扩展接口。', '管理 QQ 桥接、B站参数和身份对齐。')
    for (const [before, after] of [
      ['人格卡和提示词里都用这个称呼', 'QQ 和 B站提示词使用的称呼'],
      ['QQ 消息和 B站 回复都适用；关掉 = 只按人格卡。', '适用于 QQ 消息和 B站回复。'],
      ['多个同类角色同群时自动少说；只影响群聊自动参与，私聊/管理员不受影响；保存后重启 QQ 桥接生效', '多个同类机器人在群里时减少自动发言；私聊和管理员不受影响；保存后重启 QQ 桥接生效'],
      ['现在就让角色往白名单群分享一条 B站 视频？这会真的发到群里，并占用今天的一个分享名额。', '现在向白名单群分享一条 B站视频？这会真的发到群里，并占用今天的一个分享名额。'],
      ['人设卡已合体到「角色」页，这里不再重复一套。', '记忆同步在独立的记忆插件中管理。'],
      ['合体插件不复制配置，只把参数、记忆、身份对齐和扩展接口装到一起。', '这里管理平台参数、身份对齐和扩展；记忆与语音在各自的侧栏中管理。'],
      ['已独立成「目的」栏目：可选载体（桌宠 / QQ）、主动搭话形式、节奏、素材、预览与试一次。', '在「目的」栏目设置 QQ 主动搭话的节奏、素材与预览。'],
      ['目的状态和 QQ / B站 / 记忆共用当前角色；载体切到桌宠后不会同时私聊你。', '目的机制使用 QQ、B站和独立记忆插件提供的素材。'],
      ['每天按时间点往白名单群发 B站 视频卡片 + 角色短评；时间点、目标群、卡片样式都在「B站」页顶部。', '按设定时间向白名单群分享 B站视频；时间点、目标群和形式在「B站」页设置。'],
      ['每天按时间点发「标题 + 链接」+ 角色短评；改完点底部「保存并重启 QQ 桥接」', '按设定时间分享标题、链接和短评；修改后保存并重启 QQ 桥接'],
      ['这里是她**真正看过**的视频历史（按当前角色隔离）：每次 ', '这里记录已观看的视频：每次 '],
      ['旧角色没有历史文件时，会从 B站 记忆里补出「看过」的视频。文件：', '历史记录可从独立记忆中的 B站数据补充。文件：'],
      ['开 = DSH 启动时自动拉起 QQ 桥接，并纳入「一键启动」；关 = 不自动启动、也不参与一键启动（保存后会停掉当前桥接）。', '开 = 允许手动启动 QQ 桥接并纳入「一键启动」；关 = 不参与启动（保存后会停掉当前桥接）。'],
      ['开 = DSH 启动时自动运行 B站 生物钟，并纳入「一键启动」；关 = 生物钟不自动跑、也不参与一键启动（保存后会停掉当前生物钟）。B站→QQ 的定时分享/记忆是桥接里的独立任务，由下面的「定时分享视频到群」和 QQ 侧「启用 B站 桥接」控制。', '开 = 允许手动启动 B站生物钟并纳入「一键启动」；关 = 不参与启动（保存后会停止生物钟）。定时分享由下面的开关和 QQ 侧桥接配置控制。'],
    ]) client = replaceOnce(client, before, after)
    for (const [before, after] of [['~/.dsh/surfcore/bili.config.json', '.artifacts/dsh-home/surfcore/bili.config.json'], ['~/.dsh/surfcore/bili/credentials.json', '.artifacts/dsh-home/surfcore/bili/credentials.json']]) {
      if (!client.includes(before)) throw new Error('The pinned SurfCore B站 paths no longer match the local adapter')
      client = client.replaceAll(before, after)
    }
    client = replaceOnce(client, 'bili.available ? `记忆已生成 · ${bili.briefChars ?? 0} 字` : "暂无记忆（先扫码登录）"', 'accounts?.fish?.configured ? "已配置，登录状态可手动核查" : (accounts ? "未登录" : "读取中…")')
    client = replaceOnce(client, 'h("div", { className: "qbw-kv" }, h("span", null, "隐私复检"), h("span", null, bili.blocked ? "命中拦截" : "通过")),', 'h("div", { className: "qbw-kv" }, h("span", null, "公开记忆"), h("span", null, "在记忆插件中管理")),')
    client = replaceOnce(client, 'h("div", { className: "qbw-kv" }, h("span", null, "记忆"), h("span", null, bili.available ? `${bili.briefChars} 字` : "暂无")),\n              h("div", { className: "qbw-kv" }, h("span", null, "生成时间"), h("span", null, fmtTime(bili.generatedAt))),', 'h("div", { className: "qbw-kv" }, h("span", null, "记忆"), h("span", null, "在独立记忆插件中查看与同步")),')
    client = replaceOnce(client, 'data?.character ? `当前角色：${data.character.name}（${data.character.id}）` : "当前角色：读取中…",', '"当前账号的鱼群状态",')
    client = replaceRange(client, '      { group: "人格与注入",', '      { group: "一代仿真（reserved）",', '')
    client = replaceRange(client, '      groups.push({ group: "语音", fields: [', '      const filtered = query.trim()\n        ? groups.map', '')
  }
  return GENERATED_CLIENT_HEADER + client
}
