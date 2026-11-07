function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`The pinned SurfCore source no longer matches the component migration: ${before.slice(0, 100)}`)
  return source.replace(before, after)
}

function replaceRange(source, start, end, replacement = '') {
  if (source.split(start).length !== 2 || source.split(end).length !== 2) throw new Error(`The pinned SurfCore source no longer matches the component migration: ${start.slice(0, 80)} → ${end.slice(0, 80)}`)
  const begin = source.indexOf(start)
  const finish = source.indexOf(end)
  if (finish <= begin) throw new Error('The pinned SurfCore source has an unexpected component order')
  return source.slice(0, begin) + replacement + source.slice(finish)
}

/** Fail-closed transformations for the pinned QQ bridge; upstream remains untouched. */
export function renderBridgeSource(source, hooksUrl, memoryEngineUrl) {
  let result = source.replaceAll('\r\n', '\n')
  result = replaceOnce(result, 'function acquireLock() {\n', `function acquireLock() {
  const maintenanceActive = () => {
    try {
      const value = fs.readFileSync(path.join(STATE_DIR, 'bridge-maintenance.lock'), 'utf8').trim();
      const pid = Number(value);
      if (!Number.isInteger(pid) || pid <= 0) return true;
      try { process.kill(pid, 0); return true; } catch (error) { return error?.code !== 'ESRCH'; }
    } catch (error) { return error?.code !== 'ENOENT'; }
  };
  const rejectMaintenance = () => { if (maintenanceActive()) { console.error('[bridge] 记忆维护进行中，请稍后启动 QQ 桥接'); process.exit(2); } };
  rejectMaintenance();
`)
  result = replaceOnce(result, "    console.error(`[bridge] 检测到过期锁文件（PID 不存在或为空），删除后重试…`);", "    rejectMaintenance();\n    console.error(`[bridge] 检测到过期锁文件（PID 不存在或为空），删除后重试…`);")
  result = replaceOnce(result, "import { createVoicePacks } from './voice-packs.js';\n", '')
  result = replaceOnce(result, "import { ImportError } from './voice-pack-import.js';\n", '')
  result = replaceOnce(result, "import { synthesizeToFile } from './voice-tts.js';",
    `import { synthesizeToFile, assertIndependentVoiceAvailable, isIndependentMemoryAvailable, appendMemoryInboxEvent, memoryContextCached, awaitMemoryContext, purposeMemoryRecords, readIndependentVoiceSettings, createRemoteBiliMemory as createBiliMemory, hydrateSession, editSession, commitSession, touchSessionTopics, sessionMemoryInitialized, renderSplitConsole, ingestSurfcoreEvent, submitSurfcoreProactive } from ${JSON.stringify(hooksUrl)};`)
  result = replaceOnce(result, "import {\n  analyzePersona, applyPurposeOutcome, buildPurposePrompt, collectMaterials, deriveDrives,\n  ensurePurposeDay, ensurePurposeSchedule, evaluatePurposeTick, formGoalHypotheses,\n  markPurposeDelivered, markPurposeSkip, minePurposeSeeds, normalizePurposeConfig,\n  normalizePurposeState, parsePurposeMemo, planNextFire, selectPurpose, summarizePurposeState,\n} from './purpose-engine.js';",
    "import {\n  analyzePersona, applyPurposeOutcome, buildPurposePrompt, collectMaterials, deriveDrives,\n  ensurePurposeDay, ensurePurposeSchedule, evaluatePurposeTick, formGoalHypotheses,\n  markPurposeDelivered, markPurposeSkip, minePurposeSeeds, normalizePurposeConfig,\n  normalizePurposeState, parsePurposeMemo, planNextFire, prunePurposeState, selectPurpose, summarizePurposeState,\n} from './purpose-engine.js';")
  // The forward sits after the bridge's own "don't deliver to the agent" branches (pending answer, silent mode), so
  // Superagent receives exactly the messages SurfCore would have answered, and nothing it deliberately swallows.
  result = replaceOnce(result, '      log(`静默模式，忽略群友消息 ${key}`);\n      return;\n    }',
    '      log(`静默模式，忽略群友消息 ${key}`);\n      return;\n    }\n    void ingestSurfcoreEvent({ kind, id, key, event, text: textContent, plain: plainContent, isOwner, quoteTargetIsSelf }).catch(() => {});')
  result = replaceOnce(result, '    const attempt = (r) => synthesizeToFile({\n      text: say,', '    const attempt = (r) => synthesizeToFile({\n      useRouteVoice: r !== primary ? r : undefined,\n      text: say,')
  result = replaceOnce(result, "import { createBiliMemory } from './bili-memory.js';\n", '')
  result = replaceOnce(result, "import {\n  appendMemoryInboxEvent, looksNoteworthyMessage, resolveMemoryCardPaths,\n} from './memory-card.js';",
    `import { looksNoteworthyMessage, resolveMemoryCardPaths } from ${JSON.stringify(memoryEngineUrl)};`)
  result = replaceOnce(result, 'const MEMORY_CARD_PATHS = resolveMemoryCardPaths(activeMemoryPaths().dir);',
    "const MEMORY_CARD_PATHS = resolveMemoryCardPaths(path.join(DSH_HOME, 'memory', 'data'));" )
  result = replaceOnce(result, 'const PLATFORM_STATE_DIR = activePlatformStateDir(STATE_DIR);', 'const PLATFORM_STATE_DIR = STATE_DIR;')
  result = replaceRange(result, '  function purposeCarrierNow() {', '  // 桌宠「专注模式」', "  function purposeCarrierNow() { return 'qq'; }\n\n")
  result = replaceRange(result, '  function petFocusEnabled() {', '  function logPetFocusSkip() {', '  function petFocusEnabled() { return false; }\n')
  result = replaceRange(result, '  function purposePersonaText() {', '  function purposeContextBlocks() {', "  function purposePersonaText() { return ''; }\n\n")
  result = replaceRange(result, '  function readPurposeBiliEntries() {', '  function readPurposeMemoryRecords() {', '  function readPurposeBiliEntries() { return biliMemory.purposeEntries(); }\n\n')
  result = replaceRange(result, '  function readPurposeMemoryRecords() {', '  function gatherPurposeMaterials(', '  function readPurposeMemoryRecords() { return purposeMemoryRecords(); }\n\n')
  result = replaceRange(result, 'function readRoleState() {', 'function writeRoleState(role, mode) {',
    "function readRoleState() {\n  const base = readJsonSafe(ROLE_STATE_FILE, { mode: 'active' });\n  return { role: null, mode: base.mode || 'active' };\n}\n")
  result = replaceRange(result, "        if (req.method === 'POST' && url.pathname === '/api/role') {",
    '        // ── 仿真提示词（一代 / 二代各自的预设内置提示词）', `        if (req.method === 'POST' && url.pathname === '/api/role-mode') {
          const body = await readBody();
          const mode = body.mode === 'silent' ? 'silent' : 'active';
          writeRoleState(null, mode);
          log(\`控制台：静默模式 \${mode === 'silent' ? '开启' : '关闭'}\`);
          sendJson({ ok: true, roleMode: mode });
          return;
        }
`)
  result = replaceRange(result, '    let vpCache = { key:', '    const server = http.createServer', '')
  result = replaceRange(result, "        if (url.pathname === '/api/voice/tts-check' && req.method === 'POST') {",
    "        if (req.method === 'POST' && (url.pathname === '/api/voice/send'", `        if (req.method === 'GET' && url.pathname === '/api/voice/readiness') {
          sendJson({ ok: true, toolEnabled: v2ToolEnabled('sendVoice'), connected: snowlumaHealth.connected === true });
          return;
        }

`)
  result = replaceRange(result, "      if (plainContent === '/role' || plainContent.startsWith('/role ')) {",
    "      if (plainContent === '/silent' || plainContent === '/quiet') {", '')
  result = replaceRange(result, '  function roleRawContent() {', '  // 管理员（QQ ⇄ B站 同一个人）', "  function roleRawContent() { return ''; }\n")
  result = replaceRange(result, '  function personaIdentityText() {', "  function roleHintForMode(mode, key = '', personaMode = 'full') {", '')
  result = replaceRange(result, "  function roleHintForMode(mode, key = '', personaMode = 'full') {", "  function currentRoleHint(key = '', personaMode = 'full') {",
    "  function roleHintForMode() { const biliBrief = cfg.biliBridge?.enabled && cfg.biliBridge?.memory?.enabled !== false ? biliMemory.briefBlock() : ''; return [adminPromptLine(false), biliBrief, memoryCardPromptBlock()].filter(Boolean).join('\\n\\n'); }\n")
  result = replaceRange(result, '  function memoryCardPromptBlock() {', '  // 按仿真模式取用：',
    "  function memoryCardPromptBlock() { return memoryContextCached('qq'); }\n\n")
  result = replaceOnce(result, '      promptText = buildWakePromptV2(key, opts.wakeReason);', "      await awaitMemoryContext('qq');\n      if (wakeBlocked()) return skipWake();\n      promptText = buildWakePromptV2(key, opts.wakeReason);")
  result = replaceOnce(result, '          const roleState = readRoleState();\n          const toolMap = {', "          await awaitMemoryContext('qq');\n          if (req.headers['x-agent-token'] && (!agentTokenOk(key, req.headers['x-agent-token']) || !v2SessionAllowed(key) || !v2ToolEnabled('getPrompt'))) { sendJson({ ok: false, error: '会话权限已变化，请重试' }, 403); return; }\n          const roleState = readRoleState();\n          const toolMap = {")
  result = replaceOnce(result, '    const prompt = buildPurposePrompt({', "    await awaitMemoryContext('qq');\n    if (includeMemory && !await isIndependentMemoryAvailable()) return { ok: false, reason: 'memory-unavailable', error: '记忆插件已停止，请稍后重试' };\n    if (currentMode !== 'reserved2' || !allowed('private', Number(owner), cfg)) return { ok: false, reason: 'mode-changed', error: '会话状态已变化，请重试' };\n    const prompt = buildPurposePrompt({")
  result = replaceOnce(result, '  function purposeConversations() {', '  function purposeConversations(includeMemory = true) {')
  const conversationsStart = result.indexOf('  function purposeConversations(includeMemory = true) {')
  const conversationsEnd = result.indexOf('  function readPurposeBiliEntries()', conversationsStart)
  if (conversationsStart < 0 || conversationsEnd < 0) throw new Error('The pinned purpose conversation mapping no longer matches')
  let conversations = result.slice(conversationsStart, conversationsEnd)
  conversations = replaceOnce(conversations, '        activeTopics: st.activeTopics,\n        pendingThoughts: st.pendingThoughts,', '        activeTopics: includeMemory ? st.activeTopics : [],\n        pendingThoughts: includeMemory ? st.pendingThoughts : [],')
  result = result.slice(0, conversationsStart) + conversations + result.slice(conversationsEnd)
  result = replaceOnce(result, '  function gatherPurposeMaterials(now = Date.now()) {', '  function gatherPurposeMaterials(now = Date.now(), includeMemory = true) {')
  result = replaceOnce(result, '      conversations: purposeConversations(),\n      biliEntries: readPurposeBiliEntries(),\n      memoryRecords: readPurposeMemoryRecords(),', '      conversations: purposeConversations(includeMemory),\n      biliEntries: includeMemory ? readPurposeBiliEntries() : [],\n      memoryRecords: includeMemory ? readPurposeMemoryRecords() : [],')
  result = replaceOnce(result, '  function purposeContextBlocks() {', '  function purposeContextBlocks(includeMemory = true) {')
  const contextStart = result.indexOf('  function purposeContextBlocks(includeMemory = true) {')
  const contextEnd = result.indexOf('  function purposeLogWait(', contextStart)
  if (contextStart < 0 || contextEnd < 0) throw new Error('The pinned purpose context mapping no longer matches')
  let context = result.slice(contextStart, contextEnd)
  context = replaceOnce(context, '    const biliBrief = cfg.biliBridge?.enabled !== false && cfg.biliBridge?.memory?.enabled !== false\n      ? biliMemory.briefBlock()', '    const biliBrief = includeMemory && cfg.biliBridge?.enabled !== false && cfg.biliBridge?.memory?.enabled !== false\n      ? biliMemory.briefBlock()')
  context = replaceOnce(context, '    const memoryCardText = memoryCardPromptBlock();', "    const memoryCardText = includeMemory ? memoryCardPromptBlock() : '';" )
  result = result.slice(0, contextStart) + context + result.slice(contextEnd)
  result = replaceOnce(result, '  function preparePurposeContext(now, st) {\n    const packet = gatherPurposeMaterials(now);', '  function preparePurposeContext(now, st, includeMemory = true) {\n    const packet = gatherPurposeMaterials(now, includeMemory);')
  result = replaceOnce(result, '\n    const ctx = preparePurposeContext(now, st);', "\n    const includeMemory = await isIndependentMemoryAvailable();\n    if (currentMode !== 'reserved2' || !allowed('private', Number(owner), cfg)) return { ok: false, reason: 'mode-changed', error: '会话状态已变化，请重试' };\n    const ctx = preparePurposeContext(now, st, includeMemory);\n    if (includeMemory && !await isIndependentMemoryAvailable()) return { ok: false, reason: 'memory-unavailable', error: '记忆插件已停止，请稍后重试' };")
  result = replaceOnce(result, '\n      const ctx = preparePurposeContext(now, st);', "\n      const includeMemory = await isIndependentMemoryAvailable();\n      if (currentMode !== 'reserved2') return;\n      const ctx = preparePurposeContext(now, st, includeMemory);\n      if (includeMemory && !await isIndependentMemoryAvailable()) return;")
  result = replaceOnce(result, '      contextBlocks: purposeContextBlocks(),', '      contextBlocks: purposeContextBlocks(includeMemory),')
  result = replaceOnce(result, "    // 角色扮演提示注入（仅注入给 agent，不影响群友之间的正常对话语义）\n    const roleHint = currentRoleHint(key);", "    // 角色扮演提示注入（仅注入给 agent，不影响群友之间的正常对话语义）\n    const promptModeBeforeMemory = currentMode;\n    await awaitMemoryContext('qq');\n    if (currentMode !== promptModeBeforeMemory || !isSessionAllowedInCurrentMode(key)) return;\n    const roleHint = currentRoleHint(key);")
  result = replaceOnce(result, '    const v = cfg.socialV2?.voice ?? {};', '    const v = readIndependentVoiceSettings();')
  result = replaceOnce(result, "      err.hint = '设置 → SurfCore → 全部参数 → socialV2.voice.tts.enabled 打开';", "      err.hint = '打开侧栏「语音」，在语音规则中开启「允许语音合成」。';")
  result = replaceOnce(result, "              hint: '设置 → SurfCore → 全部参数 → socialV2.voice.enabled 打开；或在控制台开启后再发',", "              hint: '打开侧栏「语音」，在语音规则中开启「允许机器人发送语音」。',")
  result = replaceOnce(result, "              hint: '设置 → SurfCore → 工具 → 「发语音」打开（或 socialV2.tools.sendVoice=true），保存后重启 DSH',", "              hint: '打开侧栏「SurfCore」，在工具设置中启用「发语音」并按提示重启 QQ 桥接。',")
  result = replaceOnce(result, '要求：用你自己的口吻（按人格卡），1~2 句，短、可爱；', '要求：用自然的口吻，1~2 句，短、可爱；')
  result = replaceOnce(result, "          sendJson({\n            ok: true,\n            key,\n            time: new Date().toISOString(),", "          let voiceLive = false;\n          if (voiceCfg().enabled) { try { await assertIndependentVoiceAvailable(); voiceLive = voiceCfg().enabled; } catch {} }\n          if (req.headers['x-agent-token'] && (!agentTokenOk(key, req.headers['x-agent-token']) || !v2SessionAllowed(key) || !v2ToolEnabled('getPrompt'))) { sendJson({ ok: false, error: '会话权限已变化，请重试' }, 403); return; }\n          sendJson({\n            ok: true,\n            key,\n            time: new Date().toISOString(),")
  result = replaceOnce(result, '            voices: cfg.socialV2?.voice?.enabled === false ? { enabled: false } : {', '            voices: !voiceLive ? { enabled: false } : {')
  result = replaceOnce(result, "          local: String(v.tts?.endpoints?.local || 'http://127.0.0.1:8765'),", "          local: String(v.tts?.endpoints?.local || v.tts?.baseUrl || 'http://127.0.0.1:8765'),")
  result = replaceOnce(result, '      ffmpegPath: process.env.FFMPEG_PATH || v.ffmpegPath || null,', `      ffmpegPath: v.ffmpegPath || process.env.FFMPEG_PATH || null,
      ffprobePath: v.ffprobePath || (() => {
        const ffmpeg = v.ffmpegPath || process.env.FFMPEG_PATH;
        if (!ffmpeg) return undefined;
        const candidate = path.join(path.dirname(path.resolve(ROOT, String(ffmpeg))), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
        return fs.existsSync(candidate) ? candidate : undefined;
      })(),`)
  result = replaceOnce(result, '{ maxBytes: vc.maxBytes, maxSeconds: vc.maxSeconds }', '{ maxBytes: vc.maxBytes, maxSeconds: vc.maxSeconds, ffprobePath: vc.ffprobePath }')
  const probeOptions = '{ maxBytes: voice.maxBytes, maxSeconds: voice.maxSeconds }'
  if (result.split(probeOptions).length !== 4) throw new Error('The pinned voice inspection routes no longer match')
  result = result.replaceAll(probeOptions, '{ maxBytes: voice.maxBytes, maxSeconds: voice.maxSeconds, ffprobePath: voice.ffprobePath }')
  const voiceListStart = result.indexOf("        if (req.method === 'GET' && (url.pathname === '/api/socialV2/voices' || url.pathname === '/api/voice/list')) {")
  const voiceListEnd = result.indexOf("        if (req.method === 'GET' && url.pathname === '/api/socialV2/sticker-list') {", voiceListStart)
  if (voiceListStart < 0 || voiceListEnd < 0) throw new Error('The pinned voice list route no longer matches')
  let voiceList = result.slice(voiceListStart, voiceListEnd)
  voiceList = replaceOnce(voiceList, "          const wantProbe = url.searchParams.get('probe') !== '0';", `          const voiceAccessAllowed = () => voiceCfg().enabled && agentTokenOk(key, req.headers['x-agent-token']) && v2SessionAllowed(key) && v2ToolEnabled('sendVoice');
          if (agentCall) { try { await assertIndependentVoiceAvailable(); } catch { sendJson({ ok: false, error: '独立语音插件不可用' }, 503); return; } if (!voiceAccessAllowed()) { sendJson({ ok: false, error: '语音访问权限已变化' }, 403); return; } }
          const wantProbe = url.searchParams.get('probe') !== '0';`)
  voiceList = replaceOnce(voiceList, '            sendJson({\n              ok: true,\n              key: key || null,', "            if (agentCall && !voiceAccessAllowed()) { sendJson({ ok: false, error: '语音访问权限已变化' }, 403); return; }\n            sendJson({\n              ok: true,\n              key: key || null,")
  voiceList = replaceOnce(voiceList, '            for (const f of files.slice(0, 100)) {', `            if (!agentCall) files.sort((a, b) => path.relative(voice.dir, a).split(path.sep).join('/').localeCompare(path.relative(voice.dir, b).split(path.sep).join('/'), 'zh-Hans-CN'));
            const rawOffset = agentCall ? '0' : (url.searchParams.get('offset') ?? '0');
            const offset = Number(rawOffset);
            if (!/^\\d+$/.test(rawOffset) || !Number.isSafeInteger(offset)) { sendJson({ ok: false, error: '语音库页码无效' }, 400); return; }
            for (const f of files.slice(offset, offset + 100)) {`)
  result = result.slice(0, voiceListStart) + voiceList + result.slice(voiceListEnd)
  result = replaceOnce(result, "    const who = cfgVoice.trigger.who;\n    if (who === 'anyone') return null;", "    const who = cfgVoice.trigger.who;\n    if (kind === 'group' && cfgVoice.trigger.groups.length && !cfgVoice.trigger.groups.includes(String(id))) return '该群不在语音触发名单里';\n    if (who === 'anyone') return null;")
  result = replaceOnce(result, 'voiceTriggerBlock(key, m[1], Number(m[2]))', 'voiceTriggerBlock(key, m[1], m[2])')
  result = replaceOnce(result, "  async function sendVoiceV2(key, filePath, { guard = false, audit = true, audio = null } = {}) {", "  async function sendVoiceV2(key, filePath, { guard = false, audit = true, audio = null, guardCheck = null, onSent = null } = {}) {")
  result = replaceOnce(result, '        if (assertSendAllowed) assertSendAllowed();\n        // 语音条比图片大', '        if (assertSendAllowed) assertSendAllowed();\n        if (guardCheck) await guardCheck();\n        // 语音条比图片大')
  result = replaceOnce(result, "  async function sendVoiceForV2(key, voiceRef, { label = '', verify = null, readback = false, audio = null, resolved = null } = {}) {", "  async function sendVoiceForV2(key, voiceRef, { label = '', verify = null, readback = false, audio = null, resolved = null, guardCheck = null } = {}) {")
  result = replaceOnce(result, 'await sendVoiceV2(key, target.path, { guard: true, audit: true, audio });\n    voiceBudgetCommit(key);', 'await sendVoiceV2(key, target.path, { guard: true, audit: true, audio, guardCheck, onSent: () => { voiceBudgetCommit(key); voiceLastSentAt.set(String(key), Date.now()); } });')
  const voiceSendStart = result.indexOf('  async function sendVoiceV2(')
  const voiceSendEnd = result.indexOf('  /** 把「我发了条语音」', voiceSendStart)
  if (voiceSendStart < 0 || voiceSendEnd < 0) throw new Error('The pinned low-level voice send no longer matches')
  let voiceSend = result.slice(voiceSendStart, voiceSendEnd)
  voiceSend = replaceOnce(voiceSend, '        resolveSend(body.data);', '        if (onSent) onSent();\n        resolveSend(body.data);')
  result = result.slice(0, voiceSendStart) + voiceSend + result.slice(voiceSendEnd)
  const operatorStart = result.indexOf("        if (req.method === 'POST' && (url.pathname === '/api/voice/send'")
  const operatorEnd = result.indexOf("        // ── 语音发送（AI 通道", operatorStart)
  if (operatorStart < 0 || operatorEnd < 0) throw new Error('The pinned operator voice send route no longer matches')
  let operatorRoute = result.slice(operatorStart, operatorEnd)
  operatorRoute = replaceOnce(operatorRoute, "          const now = Date.now();\n          try {\n            voiceBudgetCheck('operator:cli', voice);", "          try {\n            voiceBudgetCheck('operator:cli', voiceCfg());")
  operatorRoute = replaceOnce(operatorRoute, '              guard: false,\n              audit: true,', `              guard: false,
              guardCheck: () => {
                if (!modeAllowed(key, parsedTarget.kind, Number(parsedTarget.id), cfg, currentMode)) {
                  const error = new Error('发送已取消：目标已不在当前白名单内'); error.code = 'voice.permissions-changed'; throw error;
                }
                voiceBudgetCheck('operator:cli', voiceCfg());
              },
              onSent: () => voiceBudgetCommit('operator:cli'),
              audit: true,`)
  operatorRoute = replaceOnce(operatorRoute, "            voiceBudgetCommit('operator:cli', now);\n", '')
  operatorRoute = replaceOnce(operatorRoute, "            sendJson({ ok: false, error: error?.message ?? String(error) }, 500);", "            sendJson({ ok: false, code: error?.code || '', error: error?.message ?? String(error) }, error?.code === 'voice.permissions-changed' ? 403 : error?.code === 'voice.rate-limited' ? 429 : 500);")
  result = result.slice(0, operatorStart) + operatorRoute + result.slice(operatorEnd)
  const voiceRouteStart = result.indexOf("        if (req.method === 'POST' && url.pathname === '/api/socialV2/send-voice') {")
  const voiceRouteEnd = result.indexOf("        if (req.method === 'POST' && url.pathname === '/api/socialV2/send-sticker') {", voiceRouteStart)
  if (voiceRouteStart < 0 || voiceRouteEnd < 0) throw new Error('The pinned AI voice send route no longer matches')
  let voiceRoute = result.slice(voiceRouteStart, voiceRouteEnd)
  voiceRoute = replaceOnce(voiceRoute, '          let resolved = null;', `          const originalSessionGuard = captureSendGuard(key);
          const assertVoiceRules = () => {
            const changed = (message) => { const error = new Error(message); error.code = 'voice.permissions-changed'; throw error; };
            try { originalSessionGuard(); } catch { changed('发送已取消：会话或白名单已变化'); }
            const latest = voiceCfg();
            if (!latest.enabled || (sayText && !latest.tts.enabled)) changed('发送已取消：语音或语音合成已关闭');
            if (currentMode !== 'reserved2' || !agentTokenOk(key, token) || !v2ToolEnabled('sendVoice') || !v2SessionAllowed(key) || shouldBlockSilentReply(key)) changed('发送已取消：语音会话权限已变化');
            const triggerError = voiceTriggerBlock(key, kind, keyMatch[2]);
            if (triggerError) changed(triggerError);
            voiceBudgetCheck(key, latest);
          };
          const assertVoiceStillAllowed = async () => {
            assertVoiceRules();
            try { await assertIndependentVoiceAvailable(); } catch { const error = new Error('发送已取消：独立语音插件不可用'); error.code = 'voice.permissions-changed'; throw error; }
            assertVoiceRules();
          };
          let resolved = null;`)
  voiceRoute = replaceOnce(voiceRoute, '          try {\n            voiceBudgetCheck(key, voice);\n            if (body.dryRun === true)', '          try {\n            await assertVoiceStillAllowed();\n            if (body.dryRun === true)')
  voiceRoute = replaceOnce(voiceRoute, '              resolved,\n              // AI 也可以调音量', '              resolved,\n              guardCheck: assertVoiceStillAllowed,\n              // AI 也可以调音量')
  voiceRoute = replaceOnce(voiceRoute, '            voiceLastSentAt.set(String(key), Date.now());\n', '')
  voiceRoute = replaceOnce(voiceRoute, "            sendJson({ ok: false, error: error?.message ?? String(error) }, 500);", "            sendJson({ ok: false, code: error?.code || '', error: error?.message ?? String(error) }, error?.code === 'voice.permissions-changed' ? 403 : error?.code === 'voice.rate-limited' ? 429 : 500);")
  result = result.slice(0, voiceRouteStart) + voiceRoute + result.slice(voiceRouteEnd)
  result = replaceOnce(result, '      enabled: v.enabled !== false,\n      dir: path.resolve(ROOT, String(v.dir ?? \'audio\')),', '      enabled: v.enabled === true,\n      dir: path.resolve(ROOT, String(v.dir ?? \'audio\')),')
  result = replaceRange(result, '    // 群聊：只要主人在最近 10 分钟内开过口就放行。', '  function voiceCfg() {', `    const WINDOW = 10 * 60 * 1000;
    if (who === 'list') {
      const last = voiceLastSpeaker.get(String(key)) || {};
      if (last.isOwner !== true && !cfgVoice.trigger.members.includes(String(last.userId))) return '该成员不在语音触发名单里';
      const at = Number(last.at || 0);
      if (!at || Date.now() - at > WINDOW) return '最近没有允许的成员发言，不能触发语音';
      if ((voiceLastSentAt.get(String(key)) ?? 0) >= at) return '这条消息已经发过语音了，等下一条消息';
      return null;
    }
    const ownerAt = Number(voiceOwnerAt.get(String(key)) ?? 0);
    if (!ownerAt) return '仅主人可触发语音（这个群还没有主人发言记录）';
    if (Date.now() - ownerAt > WINDOW) return '最近 10 分钟主人都没说话，不能主动发语音';
    if ((voiceLastSentAt.get(String(key)) ?? 0) >= ownerAt) return '这条消息已经发过语音了，等主人再说一句';
    return null;
  }

`)
  result = replaceOnce(result, "      dir: path.resolve(ROOT, String(v.dir ?? 'audio')),", "      dir: path.join(DSH_HOME, 'voice', 'audio'),")
  result = replaceOnce(result, "res.end(fs.readFileSync(path.join(ROOT, 'public', 'console.html'), 'utf8'));", "res.end(renderSplitConsole(fs.readFileSync(path.join(ROOT, 'public', 'console.html'), 'utf8')));")
  const sessionStart = result.indexOf("        if (req.method === 'POST' && url.pathname === '/api/socialV2/memory-append') {")
  const sessionEnd = result.indexOf('        // ── 二代黑话学习', sessionStart)
  if (sessionStart < 0 || sessionEnd < 0) throw new Error('The pinned SurfCore session memory routes do not match')
  let routes = result.slice(sessionStart, sessionEnd)
  routes = routes.replaceAll('const st = getSocialV2State(key);', 'const st = editSession(key, getSocialV2State(key));')
  routes = replaceOnce(routes, '          appendMemoryV2(st, category, content, extra);', '          appendMemoryV2(st, category, content, extra);\n          await commitSession(key, st);')
  routes = routes.replaceAll('          saveSocialV2State();', '          await commitSession(key, st);')
  routes = routes.replaceAll('          await commitSession(key, st);', '          await commitSession(key, st);\n          getSocialV2State(key);')
  result = result.slice(0, sessionStart) + routes + result.slice(sessionEnd)
  const appendStart = result.indexOf('  function appendMemoryV2(st, category, content, extra = {}) {')
  const appendEnd = result.indexOf('  loadSocialV2State();', appendStart)
  if (appendStart < 0 || appendEnd < 0) throw new Error('The pinned SurfCore session memory implementation does not match')
  const append = replaceOnce(result.slice(appendStart, appendEnd), '    saveSocialV2State();\n', '')
  result = result.slice(0, appendStart) + append + result.slice(appendEnd)
  result = replaceOnce(result, '      setupSleepTimerV2(key);\n    }\n    return st;\n  }\n\n  function loadSocialV2State()', '      setupSleepTimerV2(key);\n    }\n    return hydrateSession(key, st);\n  }\n\n  function loadSocialV2State()')
  result = replaceRange(result, '            activeTopics: Array.isArray(val.activeTopics) ? val.activeTopics : [],', '            // 上次自然收尾：跨重启保留', '            activeTopics: [], pendingThoughts: [], memberImpressions: {},\n')
  result = replaceOnce(result, '          rememberAgentToken(key, st.agentToken);\n          socialV2.conversations.set(key, st);', '          rememberAgentToken(key, st.agentToken);\n          hydrateSession(key, st);\n          socialV2.conversations.set(key, st);')
  result = replaceOnce(result, '          activeTopics: Array.isArray(st.activeTopics) ? st.activeTopics.slice(-50) : [],\n          pendingThoughts: Array.isArray(st.pendingThoughts) ? st.pendingThoughts.slice(-50) : [],\n          memberImpressions: st.memberImpressions && typeof st.memberImpressions === \'object\' ? st.memberImpressions : {},', `          ...(sessionMemoryInitialized() ? {} : (() => {
            const legacy = readJsonSafe(SOCIAL_V2_FILE, null)?.conversations?.[key] || {};
            return { activeTopics: legacy.activeTopics, pendingThoughts: legacy.pendingThoughts, memberImpressions: legacy.memberImpressions };
          })()),`)
  result = replaceOnce(result, '    for (const t of st.activeTopics || []) {\n      if (!t || typeof t !== \'object\') continue;', '    const sessionTouched = [];\n    const mentionAt = Date.now();\n    for (const t of st.activeTopics || []) {\n      if (!t || typeof t !== \'object\') continue;')
  result = replaceOnce(result, '      if (topicHit || participantHit) t.lastMentionAt = Date.now();\n    }\n    saveSocialV2State();', "      if (topicHit || participantHit) { t.lastMentionAt = mentionAt; sessionTouched.push(String(t.text || '')); }\n    }\n    if (sessionTouched.length) void touchSessionTopics(key, sessionTouched, mentionAt).catch(error => log('会话记忆更新失败:', error?.message ?? error));\n    saveSocialV2State();")
  result = replaceOnce(result, "    if (cfg.biliBridge.memory.enabled) {\n      void biliMemory.refresh({ force: true });\n      const t = setInterval(() => { void biliMemory.refresh(); }, cfg.biliBridge.memory.refreshIntervalMs);\n      t.unref?.();\n    }\n", '')
  // Proactive behaviour belongs to the orchestrator: the bridge only forwards a candidate it selected, and the
  // Policy decides whether it becomes a Ticket. The bridge's own frequency and probability gates still decide when.
  result = replaceRange(result, '    const runId = `${now}-', '  // 串行化：一次只允许一个目的回合在跑', `    const slot = Math.floor(now / 60000);
    markPurposeDelivered(purposeState, { now, planned: selection.purpose });
    purposeState.nextFireAt = 0;
    savePurposeState();
    try {
      const forwarded = await submitSurfcoreProactive({
        kind: 'purpose', key, slot, text: selection.purpose.text,
        reason: String(selection.purpose.kind || ''),
      });
      if (!forwarded || forwarded.ok !== true || !['submitted', 'duplicate', 'remembered'].includes(String(forwarded.outcome))) {
        throw new Error(forwarded?.error || \`主动候选未进入编排器（\${forwarded?.outcome || 'unknown'}）\`);
      }
    } catch (error) {
      purposeState.countToday = Math.max(0, Number(purposeState.countToday || 0) - 1);
      applyPurposeOutcome(purposeState, { now: Date.now(), config: cfg.purpose, outcome: 'delivery-failed', text: '', planned: selection.purpose });
      savePurposeState();
      log(\`[目的] 转发失败：\${error?.message ?? error}（\${Math.round(cfg.purpose.retryMs / 60000)} 分钟后重试）\`);
      return { ok: false, reason: 'delivery-failed', error: String(error?.message ?? error) };
    }
    purposeState.lastOutcome = 'forwarded';
    purposeState.attempts = 0;
    purposeState.nextFireAt = planNextFire({ now, config: cfg.purpose, lastRunAt: now, countToday: purposeState.countToday });
    purposeState.history = (Array.isArray(purposeState.history) ? purposeState.history : [])
      .concat({ at: now, outcome: 'forwarded', kind: String(selection.purpose.kind || ''), purpose: String(selection.purpose.text || '').slice(0, 120) });
    prunePurposeState(purposeState, { config: cfg.purpose, now });
    savePurposeState();
    log(\`[目的] 已转交 Superagent（\${selection.purpose.kind}），Ticket 由编排器建立\`);
    return { ok: true, delivered: true, forwarded: true, key, selected: selection.purpose, state: summarizePurposeState(purposeState, { config: cfg.purpose, now }) };
  }

`)
  result = replaceOnce(result, "        await deliverPrompt(key, promptText);\n        log(`[搭话] 已投递 ${key}（由她自己决定要不要 @ 谁）`);", `        const forwarded = await submitSurfcoreProactive({
          kind: 'chat-idle', key, slot: Math.floor(Date.now() / 60000), text: promptText, reason: '主动搭话',
        });
        if (!forwarded || forwarded.ok !== true || !['submitted', 'duplicate', 'remembered'].includes(String(forwarded.outcome))) {
          throw new Error(forwarded?.error || \`主动候选未进入编排器（\${forwarded?.outcome || 'unknown'}）\`);
        }
        log(\`[搭话] 已转交 Superagent（\${key}）\`);`)
  result = replaceOnce(result, `                enterActive(key);
                const roleHint = currentRoleHint(key);
                const promptText = buildProactivePrompt(key, roleHint);
                scheduleSocialReply(
                  key, promptText,
                  Number(cfg.social?.activeReplyDelayMinMs ?? 2000),
                  Number(cfg.social?.activeReplyDelayMaxMs ?? 8000),
                  '主动开话题'
                );
                log(\`社交模式：\${key} 观望期主动开话题，进入活跃\`);`, `                enterActive(key);
                const slot = Math.floor(now / 60000);
                void submitSurfcoreProactive({ kind: 'social-idle', key, slot,
                  text: buildProactivePrompt(key, currentRoleHint(key)), reason: '主动开话题' }).catch(() => {});
                log(\`社交模式：\${key} 观望期主动机会已转交 Superagent\`);`)
  result = replaceOnce(result, "        void sendWakePromptV2(key, 'proactiveCheck').catch((error) => log(`[reserved2] proactive 唤醒异常 ${key}:`, error?.message ?? error));",
    "        void submitSurfcoreProactive({ kind: 'proactive-check', key, slot: Math.floor(Date.now() / 60000),\n          text: buildWakePromptV2(key, 'proactiveCheck'), reason: 'proactiveCheck' }).catch(() => {});")
  return result
}

export function renderCharacterSource(source) {
  return replaceRange(source.replaceAll('\r\n', '\n'), 'export function readCurrentCharacter() {', 'export function isCurrentEpoch(epoch) {',
    'export function readCurrentCharacter() { return null; }\n\n')
}

export function renderBiliStatePathsSource(source) {
  let result = source.replaceAll('\r\n', '\n')
  result = replaceRange(result, 'export function currentCharacter() {', '/** 当前角色的 B站 行为目录', 'export function currentCharacter() { return null }\n\n')
  return replaceOnce(result, '  return path.join(biliStateDir(), ...parts)', "  return parts.length === 1 && parts[0] === 'bili-memory.json' ? path.join(DSH_HOME, 'memory', 'data', parts[0]) : path.join(biliStateDir(), ...parts)")
}

export function renderBiliShareSource(source) {
  let result = replaceOnce(source.replaceAll('\r\n', '\n'), '        memory.recordShare(card.id, slotKey);', '        try { await memory.recordShare(card.id, slotKey); } catch (error) { markSlot(slotKey); throw error; }')
  result = replaceOnce(result, '      const slotIndex = Math.max(0, slotIndexOf(timeLabel));', `      let sent = 0;
      const verifyMemory = async () => {
        try {
          await memory.assertAvailable();
          if (!isEnabled()) throw new Error('B站分享已停用');
        } catch (error) {
          if (sent > 0) markSlot(slotKey);
          throw error;
        }
      };
      await verifyMemory();
      const slotIndex = Math.max(0, slotIndexOf(timeLabel));`)
  result = replaceOnce(result, '      let sent = 0;\n      for (const gid of groups) {', '      for (const gid of groups) {\n        await verifyMemory();')
  result = replaceOnce(result, '        const prompt = buildSharePrompt(card, timeLabel, { mode: getMode(), cardSent });', '        if (cardSent) sent += 1;\n        if (sendCard) await verifyMemory();\n        const prompt = buildSharePrompt(card, timeLabel, { mode: getMode(), cardSent });')
  result = replaceOnce(result, '        if (cardSent || promptOk) sent += 1;', '        if (!cardSent && promptOk) sent += 1;')
  result = replaceOnce(result, '          setTimeout(() => { void fire(t); }, 1500).unref?.();', "          setTimeout(() => { void fire(t).catch(error => log(`[B站分享] 补跑异常：${error?.message ?? error}`)); }, 1500).unref?.();")
  result = replaceOnce(result, '用你自己的口吻（按角色卡），像群里随口分享', '用自然的口吻，像群里随口分享')
  result = replaceOnce(result, '不用 Markdown，不 @ 人；句子里的拼音字遵守角色卡（一句最多一个）。', '不用 Markdown，不 @ 人。')
  return result
}

export function renderAlignmentSource(source) {
  let result = source.replaceAll('\r\n', '\n')
  result = replaceOnce(result, '这个称呼**优先于人格卡里的「怎么称呼群友」表**：同一个人两处叫法冲突时，以这里为准。', '这个称呼由管理员登记；同一个人有多种叫法时，以这里为准。')
  result = replaceOnce(result, '没标称呼的人照旧按人格卡/昵称叫；拿不准是不是同一个人时，用对方当前平台的名字，别硬套。', '没标称呼的人按当前平台的昵称称呼；拿不准是不是同一个人时，别硬套。')
  result = replaceOnce(result, '这个称呼**优先于人格卡里的「怎么称呼群友」表**；拿不准是不是同一个人时，用对方 B站 当前昵称，别硬套。', '这个称呼由管理员登记；拿不准是不是同一个人时，用对方 B站 当前昵称，别硬套。')
  return result
}

export function renderDmAwaitSource(source) {
  let result = source.replaceAll('\r\n', '\n')
  result = replaceOnce(result, 'const ANY = !!opt.any\n', 'const ANY = !!opt.any\nconst PEEK = !!opt.peek\n')
  result = replaceOnce(result, '  return { ok: true, list: j.data?.session_list ?? [] }', "  if (!Array.isArray(j.data?.session_list)) return { ok: false, why: 'get_sessions 响应格式无效' }\n  return { ok: true, list: j.data.session_list }")
  result = replaceOnce(result, "const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch { return {} } }", 'const loadState = () => readDmState(STATE)')
  result = replaceOnce(result, "const saveState = (o) => { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(o, null, 2) + '\\n') }", 'const saveState = (o) => writeDmState(STATE, o)')
  result = `import { readDmState, writeDmState } from ${JSON.stringify(new URL('./bili-dm-cursor.mjs', import.meta.url).href)};\n${result}`
  result = replaceOnce(result, '    saveState({ seen: seenMap, seenAt: now, at: new Date().toISOString() })', '    if (!PEEK) saveState({ ...st0, seen: seenMap, seenAt: now, at: new Date().toISOString() })')
  const baselineWrite = '    saveState({ seen: seenMap, at: new Date().toISOString() })'
  if (result.split(baselineWrite).length !== 3) throw new Error('The pinned Bilibili DM baseline writes no longer match')
  result = result.replaceAll(baselineWrite, '    saveState({ ...st0, seen: seenMap, at: new Date().toISOString() })')
  result = replaceOnce(result, '  saveState({ ...st, lastSeen: r.ts, at: new Date().toISOString() })\n  if (JSONOUT)', '  if (!PEEK) saveState({ ...st, lastSeen: r.ts, at: new Date().toISOString() })\n  if (JSONOUT)')
  result = replaceOnce(result, 'if (r.ts > lastSeen) saveState({ ...st, lastSeen: r.ts, at: new Date().toISOString() })', 'if (!PEEK && r.ts > lastSeen) saveState({ ...st, lastSeen: r.ts, at: new Date().toISOString() })')
  return result
}

export function renderMsgfeedSource(source) {
  let result = source.replaceAll('\r\n', '\n')
  result = replaceOnce(result, "export async function pullFeed(kind, { headers, pages = 1 }) {", "export async function pullFeed(kind, { headers, pages = 1, cursor: startCursor = '', signal }) {")
  result = replaceOnce(result, "  let cursor = ''\n  let lastView = 0", "  let cursor = String(startCursor ?? '')\n  let lastView = 0")
  result = replaceOnce(result, 'fetch(url, { headers })).json()', 'fetch(url, { headers, signal })).json()')
  result = replaceOnce(result, '    const items = j.data?.items ?? []\n    for (const it of items) {', "    if (!j.data || !Array.isArray(j.data.items)) throw new Error(`${kind} 收件箱格式无效`)\n    const items = j.data.items\n    for (const it of items) {")
  result = replaceOnce(result, "    cursor = j.data?.cursor ?? ''\n    if (!cursor || items.length === 0) break", "    cursor = String(j.data?.cursor ?? '')\n    if (!cursor || items.length === 0) { cursor = ''; break }")
  result = replaceOnce(result, '  return { items: uniq, lastView }', '  return { items: uniq, lastView, nextCursor: cursor }')
  return result
}

export function renderSchedulerSource(source, hooksUrl) {
  let result = source.replaceAll('\r\n', '\n')
  result = `import { commitDmSeen, dmBatchRequestId, readDmPending, saveDmPending, clearDmPending } from ${JSON.stringify(new URL('./bili-dm-cursor.mjs', import.meta.url).href)};\n${result}`
  result = `import { createCommentPending, readCommentPending, saveCommentPending, clearCommentPending, readCommentCursor, commitCommentCursor, loadCommentFeed, isCommentUnseen, commentItemKey } from ${JSON.stringify(new URL('./bili-comment-cursor.mjs', import.meta.url).href)};\n${result}`
  result = replaceOnce(result, "  const ACCOUNT_DIR = path.join(dshHome, 'surfcore', 'bili')", "  const schedulerStop = new AbortController()\n  const ACCOUNT_DIR = path.join(dshHome, 'surfcore', 'bili')")
  result = replaceOnce(result, "  async function promptBili(args, signal, where = '叫醒') {", "  async function promptBili(args, signal, where = '叫醒') {\n    schedulerStop.signal.throwIfAborted()")
  result = replaceOnce(result, '    return ctx.sessionController.prompt(args, signal)', '    schedulerStop.signal.throwIfAborted()\n    return ctx.sessionController.prompt(args, signal ? AbortSignal.any([signal, schedulerStop.signal]) : schedulerStop.signal)')
  result = replaceOnce(result, '{ timeout: 120_000, windowsHide: true, env: NODE_ENV }', '{ timeout: 120_000, windowsHide: true, env: NODE_ENV, signal: schedulerStop.signal }')
  result = replaceOnce(result, '    stop() { clearInterval(timer);', '    stop() { schedulerStop.abort(); clearInterval(timer);')
  result = replaceOnce(result, '    invalidate() {\n', '    invalidate() {\n      if (schedulerStop.signal.aborted) return\n')
  result = replaceOnce(result, '      writeL({})                  // 重置基线 → 下次按"现在"重新算，不会把旧的倒出来 ✓\n', '')
  for (const functionName of ['tick', 'dmTick', 'listenTick', 'liveTick', 'dynTick']) {
    result = replaceOnce(result, `async function ${functionName}() {\n`, `async function ${functionName}() {\n      if (schedulerStop.signal.aborted) return\n`)
  }
  for (const label of ['生物钟叫醒', '私信叫醒', '评论区倾听', '直播间叫醒', '动态提醒']) {
    result = replaceOnce(result, `if (await budgetBlockedNow('${label}')) return`, `if (await budgetBlockedNow('${label}') || schedulerStop.signal.aborted) return`)
  }
  const listenStart = result.indexOf('  async function listenTick() {')
  const listenEnd = result.indexOf('  // ── 直播间监听：起一个', listenStart)
  if (listenStart < 0 || listenEnd < 0) throw new Error('The pinned Bilibili comment listener no longer matches')
  let listen = result.slice(listenStart, listenEnd)
  listen = replaceOnce(listen, '      const L = limitsNow()', '      const limits = limitsNow()')
  for (const name of ['replyDaily', 'mineDaily', 'minePerPerson']) listen = replaceOnce(listen, `\${L.${name}}`, `\${limits.${name}}`)
  listen = replaceOnce(listen, "      items.push(...(await pullFeed('reply', { headers: H, pages: 1 })).items)", "      items.push(...(await pullFeed('reply', { headers: H, pages: 1 })).items)\n      schedulerStop.signal.throwIfAborted()")
  listen = replaceOnce(listen, "        try { items.push(...(await pullFeed('at', { headers: H, pages: 1 })).items) } catch {}\n      }", "        items.push(...(await pullFeed('at', { headers: H, pages: 1 })).items)\n      }\n      schedulerStop.signal.throwIfAborted()")
  listen = replaceRange(listen, "      const cred = JSON.parse(fs.readFileSync(CRED_REF, 'utf8'))", '      const limits = limitsNow()', `      const scope = String(L.scope ?? 'both') === 'reply' ? 'reply' : 'both'
      const onlyOwner = L.onlyOwner === true
      const ownerMid = String(cfg.owner?.mid ?? '')
      const pendingFile = path.join(PLATFORM_DIR, 'comment-pending.json')
      let pending = readCommentPending(pendingFile)
      if (pending && (pending.scope !== scope || pending.onlyOwner !== onlyOwner || pending.ownerMid !== ownerMid)) throw new Error('评论监听范围或管理员已变更，待处理批次已保留；请恢复原设置处理该批次')
      if (!pending) {
        const cred = JSON.parse(fs.readFileSync(CRED_REF, 'utf8'))
        const H = makeHeaders(cred)
        const cursor = readL() ?? { lastSeen: 0 }
        const since = Number(cursor.lastSeen ?? 0)
        const items = []
        items.push(...await loadCommentFeed({ pullFeed, kind: 'reply', headers: H, since, signal: schedulerStop.signal }))
        schedulerStop.signal.throwIfAborted()
        if (scope !== 'reply') items.push(...await loadCommentFeed({ pullFeed, kind: 'at', headers: H, since, signal: schedulerStop.signal }))
        schedulerStop.signal.throwIfAborted()
        if (!since) { commitCommentCursor(LSTATE, Math.floor(Date.now() / 1000)); return }
        const fresh = items.filter(x => isCommentUnseen(x, cursor) && (!onlyOwner || String(x.mid) === ownerMid))
        if (!fresh.length) return
        fresh.sort((a, b) => a.t - b.t)
        const who = fresh.map(x => \`\${x.who}（\${x.kind === 'at' ? '@' : '回复'}）\`).join('、').slice(0, 4000)
        const lastSeen = Math.max(...fresh.map(x => Number(x.t)))
        const boundaryKeys = fresh.filter(x => Number(x.t) === lastSeen).map(commentItemKey)
        pending = createCommentPending({ scope, onlyOwner, ownerMid, count: fresh.length, who, lastSeen, boundaryKeys })
        saveCommentPending(pendingFile, pending)
      }
      const who = pending.who
`)
  listen = replaceOnce(listen, 'requestId: `bili-whale-listen-${Date.now()}`,', 'requestId: pending.requestId,')
  listen = replaceOnce(listen, '\${fresh.length} 条新消息', '\${pending.count} 条新消息')
  listen = replaceOnce(listen, "      writeL({ lastSeen: Math.max(...fresh.map((x) => Number(x.t))) })\n      log(`[bili-whale] 监听命中 ${fresh.length} 条（${who}）→ 已叫醒`)", `      const deliveredSession = ctx.sessions.get(sessionId)
      if (!deliveredSession) throw new Error('评论会话不可用')
      const admitted = deliveredSession.snapshotEvents().some(event => event.type === 'user/message' && event.data?.source?.kind === 'user' && event.data.source.rpcId === pending.requestId)
      if (!await ctx.sessions.flush(deliveredSession)) throw new Error('评论会话无法持久化')
      if (!admitted) return
      commitCommentCursor(LSTATE, pending.lastSeen, pending.boundaryKeys)
      clearCommentPending(pendingFile, pending)
      if (typeof onSessionStatus === 'function') onSessionStatus(null)
      log(\`[bili-whale] 监听命中 \${pending.count} 条（\${who}）→ 已叫醒\`)`)
  listen = replaceOnce(listen, '    } catch (e) {\n      log(`[bili-whale] 监听失败：', "    } catch (e) {\n      if (typeof onSessionStatus === 'function') onSessionStatus(e)\n      log(`[bili-whale] 监听失败：")
  result = result.slice(0, listenStart) + listen + result.slice(listenEnd)
  result = replaceOnce(result, "  const readL = () => { try { return JSON.parse(fs.readFileSync(LSTATE, 'utf8')) } catch { return null } }", '  const readL = () => readCommentCursor(LSTATE)')
  result = replaceOnce(result, 'runBili(["dm-await", "--once", "--json", ...(any ? ["--any"] : [])])', 'runBili(["dm-await", "--once", "--json", "--peek", ...(any ? ["--any"] : [])])')
  result = replaceOnce(result, '        const block = items.slice(0, 5).map((it) => {', '        const batch = items.slice(0, 5)\n        const dmRequestId = dmBatchRequestId(batch)\n        const block = batch.map((it) => {')
  result = replaceRange(result, '        const any = String(L.dmScope ?? "owner") === "all"\n', '        const block = batch.map((it) => {', `        const any = String(L.dmScope ?? "owner") === "all"
        const ownerMid = String(cfg.owner?.mid ?? "")
        const pendingFile = path.join(PLATFORM_DIR, "dm-pending.json")
        let pending = readDmPending(pendingFile)
        if (pending && (pending.any !== any || pending.ownerMid !== ownerMid)) throw new Error('私信范围或管理员已变更，待处理批次已保留；请恢复原设置处理该批次')
        if (!pending) {
          const r = await runBili(["dm-await", "--once", "--json", "--peek", ...(any ? ["--any"] : [])])
          const line = String(r.out ?? "").trim().split("\\n").pop() ?? ""
          let j = null
          try { j = JSON.parse(line) } catch { j = null }
          if (!j || typeof j.hit !== 'boolean') throw new Error('私信监听读取失败：命令未返回有效结果')
          if (!j.hit) return
          const items = any ? (j.items ?? []) : [{ mid: j.mid, name: j.name, text: j.text, ts: j.ts }]
          if (!Array.isArray(items) || !items.length) throw new Error('私信监听读取失败：命中结果为空或格式无效')
          pending = { any, ownerMid, items: items.slice(0, 5).map(it => ({ mid: String(it.mid ?? ''), ts: Number(it.ts), name: String(it.name ?? '').slice(0, 500), text: String(it.text ?? '').slice(0, 300) })) }
          saveDmPending(pendingFile, pending)
        }
        const batch = pending.items
        const dmRequestId = dmBatchRequestId(batch)
        void ingestSurfcoreBiliEvents(batch).catch(() => {})
`)
  result = replaceOnce(result, 'requestId: `bili-whale-dm-${Date.now()}`,', 'requestId: dmRequestId,')
  result = replaceOnce(result, '`【有 ${items.length} 条新私信】`', '`【有 ${batch.length} 条新私信】`')
  result = replaceOnce(result, '`【主人私信】${j.name}（mid ${j.mid}）刚给你发私信：`', '`【主人私信】${batch[0].name}（mid ${batch[0].mid}）刚给你发私信：`')
  result = replaceOnce(result, '        }, new AbortController().signal)   // 2026-10-19 修：prompt 的第二个参数是 signal ✗ 漏传会 TypeError', `        }, new AbortController().signal)
        const deliveredSession = ctx.sessions.get(sessionId)
        if (!deliveredSession) throw new Error("私信会话不可用")
        const admitted = deliveredSession.snapshotEvents().some(event => event.type === 'user/message' && event.data?.source?.kind === 'user' && event.data.source.rpcId === dmRequestId)
        if (!await ctx.sessions.flush(deliveredSession)) throw new Error("私信会话无法持久化")
        if (!admitted) return
        commitDmSeen(path.join(PLATFORM_DIR, "dm-await-state.json"), any, batch)
        clearDmPending(pendingFile, pending)
        if (typeof onSessionStatus === 'function') onSessionStatus(null)`)
  result = replaceOnce(result, '      } catch (e) {\n        try { fs.appendFileSync(path.join(platformDir(), "dm-tick-err.log"),', '      } catch (e) {\n        if (typeof onSessionStatus === \'function\') onSessionStatus(e)\n        try { fs.appendFileSync(path.join(platformDir(), "dm-tick-err.log"),')
  result = replaceRange(result, '  let sessionReady = false\n', '  let waking = false\n', `  let sessionReady = false
  let sessionPending = null
  async function ensureSession() {
    schedulerStop.signal.throwIfAborted()
    if (sessionPending) return sessionPending
    const operation = (async () => {
    try {
    let resolved = await ctx.sessionController.resolveAgent(sessionId)
    schedulerStop.signal.throwIfAborted()
    if (resolved?.error?.code === 'session/not-found') {
      const created = await ctx.sessionController.create({ sessionId, cwd })
      schedulerStop.signal.throwIfAborted()
      if (created?.sessionId !== sessionId) throw new Error('B站会话创建结果与请求的会话不一致')
      resolved = await ctx.sessionController.resolveAgent(sessionId)
      schedulerStop.signal.throwIfAborted()
    }
    if (!resolved?.agent) throw resolved?.error ?? new Error('无法访问 B站会话')
    const agent = resolved.agent
    const directory = agent.ctx.get('workingDirectory')
    if (!directory || typeof directory.get !== 'function' || typeof directory.set !== 'function') throw new Error('B站会话缺少工作目录服务')
    if (path.resolve(directory.get(agent.session)) !== path.resolve(cwd)) await directory.set(agent, cwd)
    if (!await ctx.sessions.flush(agent.session)) throw new Error('B站会话无法持久化工作目录')
    sessionReady = true
    const first = ensurePermission('ensureSession')
    if (!first.ok && first.reason === 'session-not-active') {
      await new Promise((resolve) => setTimeout(resolve, 80))
      ensurePermission('ensureSession-retry')
    }
    if (typeof onSessionStatus === 'function') onSessionStatus(null)
    } catch (error) {
      if (typeof onSessionStatus === 'function') onSessionStatus(error)
      throw error
    }
    })()
    sessionPending = operation
    try { return await operation } finally { if (sessionPending === operation) sessionPending = null }
  }

`)
  result = replaceOnce(result, '    log = () => {},\n  } = opts', '    log = () => {},\n    onSessionStatus = () => {},\n  } = opts')
  result = replaceOnce(result, '"【还没跑启动测试】先提醒主人跑一次：`node ~/.dsh/plugins/surfcore/tools/bili.mjs selftest`",', '"【还没跑启动测试】先提醒主人跑一次：`" + (tools || "bili.mjs") + " selftest`",')
  result = replaceOnce(result, "'2) 读两本日记（`~/.dsh/surfcore/bili/whale-diary.md` + `whale-diary-private.md`）',", "'2) 读两本日记（`' + path.join(platformDir(), 'whale-diary.md') + '` + `' + path.join(platformDir(), 'whale-diary-private.md') + '`）',")
  result = replaceOnce(result, "'     ⚠️ 配图自动挑：`~/.dsh/surfcore/bili/memes/` 里的表情包（随机）→ 没有就用这条视频的封面 ✓',", "'     ⚠️ 配图自动挑：`' + path.join(platformDir(), 'memes') + '` 里的表情包（随机）→ 没有就用这条视频的封面 ✓',")
  result = replaceOnce(result, '用你（当前人格卡）的口吻说这条视频', '用自然的口吻介绍这条视频')
  for (const [before, after] of [
    ['按 AGENTS.md 的「看的那晚」流程走一遍', '按下面的观看流程执行'],
    ['按 AGENTS.md 的「不看的那晚」做', '按下面的轻醒流程执行'],
    ['按 AGENTS.md「私信」做', '按下面的私信流程执行'],
    ['按 AGENTS.md 的「倾听」做', '按下面的消息处理流程执行'],
    ['按 AGENTS.md「倾听 · 直播间」做', '按下面的直播间消息处理流程执行'],
    ['按 AGENTS.md 的「四类动态」做', '按下面的动态流程执行'],
  ]) result = replaceOnce(result, before, after)
  // The Bilibili prompts keep their read and diagnostic commands, but the tool line is the one place every prompt
  // states how the tool is used, so writing to the platform (comment, DM, danmaku, dynamic) moves out of reach here.
  result = replaceOnce(result,
    '    const toolLine = () => `［工具］所有命令都用这一条：\\`${TOOL_CMD} <子命令>\\`（提示里写 "bili.mjs" 的都指它）—— 别去别处找 ✗`',
    '    const toolLine = () => `［工具］读和诊断都用这一条：\\`${TOOL_CMD} <子命令>\\`（提示里写 "bili.mjs" 的都指它）—— 别去别处找 ✗\\n［出站］发评论、回私信、发弹幕、发动态这类写操作已停用：回信统一由 Superagent 发出，这一趟只做到诊断为止 ✓`')
  result = replaceOnce(result,
    "    ...(tools ? [`［工具］所有命令都用这一条：\\`${tools}\\`（下面写 \"bili.mjs\" 的都指它）—— 别去别处找 ✗`, ''] : []),",
    "    ...(tools ? [`［工具］读和诊断都用这一条：\\`${tools}\\`（下面写 \"bili.mjs\" 的都指它）—— 别去别处找 ✗\\n［出站］发评论、回私信、发弹幕、发动态这类写操作已停用：回信统一由 Superagent 发出，这一趟只做到诊断为止 ✓`, ''] : []),")
  result = replaceOnce(result, "import { memoryCardPromptBlock } from './memory-card.js'", `import { memoryContextCached, awaitMemoryContext, ingestSurfcoreBiliEvents } from ${JSON.stringify(hooksUrl)}`)
  result = replaceOnce(result, "import { resolvePersonaFile } from './persona.js'\n", '')
  result = replaceOnce(result, "import { activeMemoryPaths, activePlatformStateDir, readPersonaLayerText } from '../../../src/character-persona.js'",
    "import { activePlatformStateDir } from '../../../src/character-persona.js'")
  result = replaceRange(result, 'function personaCardBlock() {', '/** 身份对齐：高于记忆同步开关', "function personaCardBlock() { return '' }\n\n")
  result = replaceOnce(result, '    personaName: bili?.persona?.name,\n', '')
  result = replaceRange(result, 'function qqMemoryBlockForBili() {', '/** 记忆卡（B站侧）', "function qqMemoryBlockForBili() { return '' }\n\n")
  result = replaceRange(result, 'function memoryCardBlockForBili() {', '/** 每次唤醒都放在最前面的合体上下文', "function memoryCardBlockForBili() { return memoryContextCached('bili') }\n\n")
  if (result.split('await ensureSession()').length !== 9) throw new Error('The pinned Bilibili prompt entry points no longer match')
  result = result.replaceAll('await ensureSession()', "await ensureSession(); await awaitMemoryContext('bili')")
  return result
}

export function renderHostWorkdirSource(source) {
  return replaceOnce(source, 'cwd: os.homedir(),', "cwd: path.resolve(QQBOT_ROOT, '..', '..'),")
}

/** Remove component ownership from the pinned SurfCore host while retaining QQ/Bilibili controls. */
export function renderHostSource(source) {
  let result = source.replaceAll('\r\n', '\n')
  result = replaceOnce(result, "if (result.saved.unified && process.env.SURFCORE_SKIP_AUTOSTART !== '1') {", 'if (result.saved.unified) {')
  result = replaceOnce(result, "export const inject = ['webServer', 'connection', 'sessionController'];", "export const inject = ['webServer', 'connection', 'sessionController', 'sessions'];")
  result = replaceOnce(result, '      scheduler = startScheduler(ctx, {', '      let schedulerInstance;\n      scheduler = schedulerInstance = startScheduler(ctx, {')
  result = replaceOnce(result, '        tokenBudget,\n        log: (message) => pluginLog(message),', `        tokenBudget,
        onSessionStatus: (error) => {
          if (scheduler !== schedulerInstance) return;
          schedulerStatus.lastError = error ? String(error?.message ?? error) : null;
        },
        log: (message) => pluginLog(message),`)
  result = `import { createAlignmentScanner } from ${JSON.stringify(new URL('./alignment-scan.mjs', import.meta.url).href)};\n${result}`
  result = `import { createSurfcoreComponentClient, createExtensionMemoryApi, collectSplitComponentDiagnostics } from ${JSON.stringify(new URL('./surfcore-component-client.mjs', import.meta.url).href)};\n${result}`
  result = replaceOnce(result, '  addLink, approveCandidate, exportAlignments, importAlignments, listCandidates,', '  addCandidate, detectCandidatesFromText, addLink, approveCandidate, exportAlignments, importAlignments, listCandidates,')
  result = replaceOnce(result, '  async function handleAlign(req, res) {', `  const { scanQqFeedForCandidates, scanBiliFeedForCandidates } = createAlignmentScanner({
    qqFeedFile: path.join(QQ_STATE_DIR(), 'qq-public-feed.jsonl'), qqConfigFile: QQ_CONFIG, biliCredFile: BILI_CRED,
    biliToolsDir: BILI_TOOLS_DIR, detect: detectCandidatesFromText, add: addCandidate,
  });
  async function handleAlign(req, res) {`)
  const qqScan = 'const qq = scanQqFeedForCandidates({ maxMessages: 1200 });'
  if (result.split(qqScan).length !== 3) throw new Error('The pinned SurfCore QQ candidate scan routes do not match')
  result = result.replaceAll(qqScan, 'const qq = await scanQqFeedForCandidates({ maxMessages: 1200 });')
  for (const line of [
    "import { createPetService, detectElectronPath, installElectronRuntime, ELECTRON_VERSION, electronDownloadUrl } from './pet.js';\n",
    "import { createPetChatService } from './pet-chat.js';\n",
    "import { createPetPurposeService } from './pet-purpose.js';\n",
    "import { createPetApiService } from './pet-api.js';\n",
    "import { createPersonaClassifier } from './persona-classify.js';\n",
    '  let syncTimer = null;\n', '  let memoryCardTimer = null;\n', '  let characterTimer = null;\n',
    "  const petService = createPetService({ stateDir: STATE_DIR, pluginLog, getSubprocess: () => ctx.get('subprocess') });\n",
    '  const personaClassifier = createPersonaClassifier({ ctx, log: (message) => pluginLog(message), tokenBudget });\n',
  ]) result = replaceOnce(result, line, '')
  result = replaceRange(result, '  const petChat = createPetChatService(', '  // ── 组件更新（2026-10-26 用户要求）', '')
  result = replaceOnce(result, '  const updates = createUpdatesService({', `  function fixedSourceUpdateReason(component) {
    if (component?.id === 'surfcore') return 'SurfCore 是固定版本的子模块，请在项目中管理版本';
    if (!component?.dir) return '';
    const canonical = value => { const resolved = path.resolve(String(value)); try { return fs.realpathSync(resolved); } catch { return resolved; } };
    const project = path.resolve(QQBOT_ROOT, '..', '..');
    const roots = [QQBOT_ROOT, path.join(project, 'deepseek-harness'), path.join(project, 'superagent')].map(canonical);
    const target = canonical(component.dir);
    const contains = (parent, child) => { const rel = path.relative(parent, child); return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)); };
    return roots.some(root => contains(root, target) || contains(target, root)) ? '目标与固定版本源码子模块重叠，请在项目中管理版本' : '';
  }
  const updates = createUpdatesService({`)
  result = replaceRange(result, '    blockedReason: (component) => {', '    components: () => {', "    blockedReason: fixedSourceUpdateReason,\n")
  result = replaceOnce(result, "      json(res, 200, await updates.rollback(target));", `      const custom = readUnified().config?.updates?.components;
      const component = target === 'surfcore' ? { id: target, dir: QQBOT_ROOT } : (Array.isArray(custom) ? custom.find(item => item && typeof item === 'object' && item.id && item.dir && String(item.id).slice(0, 60) === target) : null);
      const blocked = fixedSourceUpdateReason(component);
      if (blocked) { json(res, 409, { ok: false, code: 'pinned-source', reason: blocked, error: blocked }); return; }
      json(res, 200, await updates.rollback(target));`)
  result = replaceRange(result, '      // 3) 桌宠：', '      // 4) 用户/未来扩展', '')
  result = replaceRange(result, '  // ── 角色人格：启动迁移', '  // 扩展：只加载显式启用的', '')
  result = replaceRange(result, '  async function handleCharacters(req, res, url) {', '  // ── 人设卡', '')
  result = replaceRange(result, '  async function handlePersonaClassify(req, res) {', '  async function handleLimitMute(req, res) {', '')
  result = replaceRange(result, '  async function handlePersona(req, res) {', '  // ── 身份对齐', '')
  result = replaceRange(result, '  async function handleVoice(req, res, url) {', '  // 原生「浏览目录 / 选择文件」', '')
  result = replaceRange(result, '  async function handlePet(req, res, url) {', '  // ── 目的机制', '')
  result = replaceOnce(result, "  function openLocalUrl(url) {\n    if (process.env.SURFCORE_SKIP_AUTOSTART === '1') return false;", "  function openLocalUrl(url) {\n    if (process.platform !== 'win32') return false;")
  result = replaceOnce(result, "      spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start', '\"\"', `\"${url}\"`], {\n        detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true,\n      }).unref();", "      const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start', '\"\"', `\"${url}\"`], {\n        detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true,\n      });\n      child.on('error', error => pluginLog('打开 SnowLuma 页面失败：', String(error?.message ?? error)));\n      child.unref();")
  result = replaceOnce(result, "    if (process.env.SURFCORE_SKIP_AUTOSTART === '1') {\n      return { ok: true, skipped: true, message: '测试环境：跳过打开 SnowLuma' };\n    }\n", '')
  result = replaceOnce(result, "      const lower = launcher.toLowerCase();\n      if (lower.endsWith('.bat')", "      const lower = launcher.toLowerCase();\n      let child;\n      if (lower.endsWith('.bat')")
  result = replaceOnce(result, "        spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start', '\"\"', `\"${launcher}\"`], {\n          cwd, detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: true,\n        }).unref();", "        child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start', '\"\"', `\"${launcher}\"`], {\n          cwd, detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: true,\n        });")
  result = replaceOnce(result, "        spawn(launcher, [], { cwd, detached: true, stdio: 'ignore', windowsHide: false }).unref();\n      }\n      // 等 WebUI", "        child = spawn(launcher, [], { cwd, detached: true, stdio: 'ignore', windowsHide: false });\n      }\n      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });\n      child.unref();\n      // 等 WebUI")
  result = replaceOnce(result, "    if (process.platform !== 'win32' || process.env.SURFCORE_SKIP_AUTOSTART === '1') return false;", "    if (process.platform !== 'win32') return false;")
  result = replaceOnce(result, 'const file = path.join(os.tmpdir(), `surfcore-startup-', 'const file = path.join(STATE_DIR, `surfcore-startup-')
  result = replaceOnce(result, '  let startupWatcher = null;\n  async function watchStartupCompletion', '  let startupWatcher = null;\n  let startupWatchVersion = 0;\n  function cancelStartupWatch() { startupWatchVersion++; startupWatcher = null; }\n  async function watchStartupCompletion')
  result = replaceOnce(result, '    startupWatcher = (async () => {\n      try {\n        const notify', "    const watchVersion = ++startupWatchVersion;\n    startupWatcher = (async () => {\n      await Promise.resolve();\n      try {\n        if (process.platform !== 'win32') return;\n        const notify")
  result = replaceOnce(result, '        while (Date.now() < until) {', '        while (Date.now() < until && watchVersion === startupWatchVersion) {')
  result = replaceOnce(result, '          last = { bridge, schedulerRunning };\n          if (allReady', '          if (watchVersion !== startupWatchVersion) return;\n          last = { bridge, schedulerRunning };\n          if (allReady')
  result = replaceOnce(result, '        // 最后一次补查：桥接可能刚好在超时边界上完成 DSH 握手。', '        if (watchVersion !== startupWatchVersion) return;\n        // 最后一次补查：桥接可能刚好在超时边界上完成 DSH 握手。')
  result = replaceOnce(result, '          if (bridge) last = { bridge, schedulerRunning };', '          if (watchVersion !== startupWatchVersion) return;\n          if (bridge) last = { bridge, schedulerRunning };')
  result = replaceOnce(result, "        pluginLog(`启动检查未通过：qq=", "        if (watchVersion !== startupWatchVersion) return;\n        pluginLog(`启动检查未通过：qq=")
  result = replaceOnce(result, '        startupWatcher = null;\n      }\n    })();', '        if (watchVersion === startupWatchVersion) startupWatcher = null;\n      }\n    })();')
  result = replaceOnce(result, '  ctx.effect(() => () => {\n    try { scheduler?.stop?.();', '  ctx.effect(() => () => {\n    cancelStartupWatch();\n    try { scheduler?.stop?.();')
  result = replaceRange(result, '  async function purposeAvailability() {', '  // ── 一键启动 / 停止', `  async function handlePurpose(req, res, url) {
    const suffix = url.pathname.slice(\`${'${API_PREFIX}'}/purpose\`.length) || '/status';
    const allowed = (suffix === '/status' && req.method === 'GET') || (['/preview', '/run'].includes(suffix) && req.method === 'POST');
    if (!allowed) { json(res, 404, { ok: false, error: '未知目的接口' }); return; }
    const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || '{}') : undefined;
    const remote = await callBridge(\`/api/purpose${'${suffix}'}\`, { method: req.method, body, timeoutMs: 30000 });
    if (!remote.ok) { json(res, remote.status || 503, { ok: false, error: remote.status ? (remote.data?.error || remote.error || 'QQ 桥接请求失败') : 'QQ 桥接未运行或无法连接', hint: '先启动 QQ 桥接' }); return; }
    json(res, remote.status || 200, { ...(remote.data || {}), source: 'qq', carrier: 'qq' });
  }

`)
  result = replaceRange(result, "  const LAUNCH_IDS = ['qq', 'bili', 'pet', 'voice'];", '  async function handleBridge(req, res) {', `  const LAUNCH_IDS = ['qq', 'bili', 'voice'];
  const LAUNCH_LABELS = { qq: 'QQ（含 SnowLuma）', bili: 'B站', voice: '语音' };
  async function launchStatus() {
    const bridge = await bridgeStatus().catch(error => ({ running: false, error: String(error?.message ?? error) }));
    let voice;
    try {
      const list = await createSurfcoreComponentClient({ home: DSH_HOME }).voicePacks();
      const packs = Array.isArray(list.packs) ? list.packs : [];
      voice = { ok: true, running: packs.some(p => p.running), installed: packs.filter(p => p.installed).map(p => p.id), packs };
    } catch (error) { voice = { ok: false, running: false, installed: [], packs: [], lastError: String(error?.message ?? error) }; }
    return { qq: { running: Boolean(bridge.running), ok: Boolean(bridge.running && bridge.ok !== false), port: bridge.port ?? null, pid: bridge.pid ?? bridge.lockPid ?? null, snowluma: bridge.snowluma ?? null, lastError: bridge.error ?? null },
      bili: { running: Boolean(scheduler && schedulerStatus.running), lastError: schedulerStatus.lastError ?? null, reason: schedulerStatus.reason ?? '' }, voice };
  }
  async function runLaunchAction(action, body) {
    const ids = [...new Set((Array.isArray(body.components) ? body.components : []).map(String).filter(id => LAUNCH_IDS.includes(id)))];
    if (!ids.length) return { ok: false, code: 'NO_COMPONENTS', error: '没有选择启动项', hint: '选择 QQ、B站或语音', items: [], status: await launchStatus() };
    cancelStartupWatch();
    const items = [];
    const ordered = action === 'stop' ? ['voice', 'qq', 'bili'].filter(id => ids.includes(id)) : ids;
    for (const id of ordered) {
      try {
        let detail, code = '', error = '', hint = '', message = '';
        if (id === 'voice') {
          const client = createSurfcoreComponentClient({ home: DSH_HOME });
          if (action === 'stop') {
            detail = await client.stopOwnedVoicePacks();
            message = '语音插件已停止其管理的语音进程';
          } else {
            const wanted = body.voicePack === 'voice-cloud' ? 'voice-cloud' : 'voice-local';
            const list = await client.voicePacks();
            const pack = (list.packs || []).find(p => p.id === wanted);
            if (!pack || !pack.installed) { detail = { ok: false }; code = 'VOICE_PACK_NOT_INSTALLED'; error = (pack?.name || wanted) + ' 还没安装'; hint = '先在「语音」页安装或导入语音包'; }
            else { detail = await client.activateVoicePack(wanted); message = detail.warning || '语音包已启动'; }
          }
        }
        else if (action === 'stop') {
          detail = id === 'qq' ? await stopBridge() : stopSchedulerNow();
          if (id === 'bili') message = detail.wasRunning ? 'B站生物钟已停止' : 'B站生物钟本来就没在跑';
          else if (detail?.ok === false) { code = 'QQ_STOP_FAILED'; error = detail.error || 'QQ 桥接停止失败'; hint = '看桥接日志/手动结束残留进程'; }
          else message = 'QQ 桥接已停止（SnowLuma 本体不会被本程序关闭）';
        }
        else if (!platformStartEnabled(id)) {
          detail = { ok: false }; code = 'PLATFORM_DISABLED'; error = (id === 'qq' ? 'QQ' : 'B站') + ' 启动开关已关闭'; hint = '去对应平台页面打开启动开关并保存';
        }
        else if (id === 'qq') {
          const status = await bridgeStatus();
          const stale = bridgeStaleReason(status);
          const bridge = stale ? await restartBridge({ dshWebUrl: currentDshUrl() }) : await startBridge({ dshWebUrl: currentDshUrl() });
          const snowluma = bridge?.ok === false ? { skipped: true } : await launchSnowLuma().catch(error => ({ ok: false, error: String(error?.message ?? error), hint: '检查 SnowLuma 安装目录/允许插件打开设置' }));
          const snowOk = snowluma?.ok !== false || snowluma?.skipped === true || snowluma?.already === true;
          const bridgeOk = bridge?.ok !== false;
          detail = { ok: bridgeOk && snowOk, bridge, snowluma };
          message = [bridge?.message, snowluma?.message || snowluma?.error].filter(Boolean).join('；');
          if (!detail.ok) {
            code = 'QQ_START_PARTIAL';
            error = bridgeOk ? 'QQ 桥接已启动，但 SnowLuma 未打开：' + (snowluma?.error || '未知原因') : (bridge?.error || bridge?.message || 'QQ 桥接启动失败');
            hint = bridgeOk ? (snowluma?.hint || '启动 SnowLuma（launcher.bat）并确认端口 3000/3001') : '检查桥接日志/端口；必要时重启 DSH';
          }
        } else {
          const state = startSchedulerNow(); detail = { ...state, ok: state.running === true };
          if (!state.running) { code = 'BILI_START_FAILED'; error = 'B站生物钟未启动：' + (state.reason || state.lastError || '未登录或配置缺失'); hint = '先在「B站」页完成扫码登录；仍失败看插件日志'; }
        }
        items.push({ id, label: LAUNCH_LABELS[id], ok: detail?.ok !== false, code, error: error || detail?.error || '', hint, message, detail });
      } catch (error) { items.push({ id, label: LAUNCH_LABELS[id], ok: false, error: String(error?.message ?? error), hint: '检查平台状态后重试' }); }
    }
    const ok = items.every(item => item.ok);
    if (action === 'start' && ok && (ids.includes('qq') || ids.includes('bili'))) void watchStartupCompletion({ qq: ids.includes('qq'), bili: ids.includes('bili') });
    return { ok, items, status: await launchStatus() };
  }

`)
  result = replaceRange(result, "    if (action === 'start-qq') {", "    if (action === 'start-bili') {", `    if (action === 'start-qq') {
      if (!platformStartEnabled('qq')) { json(res, 409, { ok: false, error: 'QQ 启动开关已关闭：去「QQ」页打开「启动 QQ」并保存' }); return; }
      const result = await runLaunchAction('start', { components: ['qq'] });
      const item = result.items[0] || {};
      json(res, 200, { ...result, bridge: item.detail?.bridge, snowluma: item.detail?.snowluma, message: item.message || item.error || '', error: item.error || '' });
      return;
    }
`)
  result = replaceRange(result, "    if (action === 'start-all') {", "    if (action === 'start-snowluma') {", `    if (action === 'start-all') {
      const starts = platformStartState();
      const components = ['qq', 'bili'].filter(id => starts[id]);
      const disabledBridge = { ok: true, skipped: true, message: 'QQ 启动开关关闭，已跳过桥接' };
      const disabledSnow = { ok: true, skipped: true, message: 'QQ 启动开关关闭，已跳过 SnowLuma' };
      const disabledBili = () => ({ ...idleSchedulerStatus('disabled'), message: 'B站 启动开关关闭，已跳过生物钟' });
      if (!components.length) { json(res, 200, { ok: true, pending: false, message: 'QQ 和 B站 的启动开关都关着，没有需要启动的平台', bridge: disabledBridge, snowluma: disabledSnow, scheduler: disabledBili(), platformStart: starts }); return; }
      const result = await runLaunchAction('start', { components });
      const qq = result.items.find(item => item.id === 'qq');
      json(res, 200, { ...result, pending: result.ok, message: result.items.map(item => item.message || item.error).filter(Boolean).join('；'),
        bridge: starts.qq ? qq?.detail?.bridge : disabledBridge, snowluma: starts.qq ? qq?.detail?.snowluma : disabledSnow,
        scheduler: starts.bili ? schedulerStatus : disabledBili(), platformStart: starts });
      return;
    }
`)
  for (const line of [
    "    if (pathname === `${API_PREFIX}/characters`) { await handleCharacters(req, res, url); return; }\n",
    "    if (pathname === `${API_PREFIX}/persona`) { await handlePersona(req, res); return; }\n",
    "    if (pathname === `${API_PREFIX}/persona/classify`) { await handlePersonaClassify(req, res); return; }\n",
    "    if (pathname === `${API_PREFIX}/memory`) { await handleMemory(req, res, url); return; }\n",
    "    if (pathname === `${API_PREFIX}/memory-card/full`) { await handleMemoryCardFull(req, res, url); return; }\n",
    "    if (pathname === `${API_PREFIX}/memory-card`) { await handleMemoryCard(req, res); return; }\n",
    "    if (pathname.startsWith(`${API_PREFIX}/voice`)) { await handleVoice(req, res, url); return; }\n",
    "    if (pathname.startsWith(`${API_PREFIX}/pet`)) { await handlePet(req, res, url); return; }\n",
  ]) result = replaceOnce(result, line, '')
  result = replaceRange(result, '  // 桌宠专用本地接口：', "  route('exact', '/dsh-surfcore/health'", '')
  result = replaceRange(result, '  // 桌宠发现文件（', '  // 启动后异步做的事', '')
  for (const line of [
    '\n  startSyncTimer();\n', '    try { petPurpose.stop?.(); } catch {}\n', '    if (petHostTimer) clearInterval(petHostTimer);\n',
    '    try { memoryCardTimer?.stop?.(); } catch {}\n', '    if (characterTimer) clearInterval(characterTimer);\n', '    if (syncTimer) clearInterval(syncTimer);\n',
  ]) result = replaceOnce(result, line, '')
  result = replaceRange(result, '    // 角色名校验：tts.character', "    if (body.unified && typeof body.unified === 'object') {", '')
  result = replaceRange(result, '      // 切了语音路由就要当场告诉用户', '      try { writeAlignmentBriefs();', '')
  result = replaceRange(result, '      startSyncTimer();', '    // 平台启动开关的副作用：', '    }\n')
  result = replaceRange(result, '    // 目的载体同理：切到桌宠后', '    const afterPlatformStart = platformStartState();', '')
  result = replaceOnce(result, "import { resolvePersonaFile } from './persona.js';\n", '')
  result = replaceOnce(result, "import { VOICE_PORTS, readPackCharacters, validateCharacter } from './voice-health.js';\n", '')
  result = replaceRange(result, 'import {\n  autoSnapshot, beforeSwitchSnapshot, characterDetail', "import { activeMemoryPaths, activePersonaLayers", '')
  result = replaceOnce(result, "import { activeMemoryPaths, activePersonaLayers, activePlatformStateDir, readCurrentCharacter, touchCharacter } from '../../../src/character-persona.js';",
    "import { activePlatformStateDir, readCurrentCharacter } from '../../../src/character-persona.js';")
  result = replaceRange(result, 'import {\n  auditTail, biliToQqStatus, memoryStatus', "import {\n  bridgeLogTail", '')
  result = replaceRange(result, 'import {\n  applyMemoryCardAction, compactMemoryCardNow', "import { readWatchHistory }", '')
  result = replaceOnce(result, "  platforms.setStatus('bili', () => biliToQqStatus());", `  platforms.setStatus('bili', async () => {
    const brief = await createSurfcoreComponentClient({ home: DSH_HOME }).biliBrief(2500);
    const bridge = readQqConfig().config?.biliBridge;
    return {
      enabled: brief.enabled === true && bridge?.enabled !== false && bridge?.memory?.enabled !== false,
      available: Number(brief.status?.briefChars) > 0,
      generatedAt: brief.status?.generatedAt || null,
      briefChars: Number(brief.status?.briefChars) || 0,
      docChars: brief.status?.docChars ?? null,
      blocked: brief.blocked === true,
      labels: Array.isArray(brief.labels) ? brief.labels : [],
      briefPreview: String(brief.text || '').slice(0, 4000),
      policyVersion: PRIVACY_POLICY_VERSION,
    };
  });`)
  result = replaceOnce(result, "    if (action === 'refresh-bili') { json(res, 200, await refreshBiliToQq({ callBridge })); return; }", `    if (action === 'refresh-bili') {
      try { json(res, 200, await createSurfcoreComponentClient({ home: DSH_HOME }).refreshBili()); }
      catch (error) { json(res, 503, { ok: false, error: String(error?.message ?? error), hint: '检查独立记忆插件后重试' }); }
      return;
    }`)
  result = replaceOnce(result, "        spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore', windowsHide: false }).unref();", "        const child = spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore', windowsHide: false });\n        await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });\n        child.unref();")
  result = replaceOnce(result, "      json(res, result.status || 200, result.data ?? { ok: false, error: result.error || '桥接不可用' });", "      if (!result.ok) { json(res, result.status >= 400 ? result.status : 503, { ok: false, error: 'QQ 桥接不可用：' + (result.data?.error || result.error || '无法连接') }); return; }\n      json(res, result.status || 200, result.data ?? { ok: false, error: '桥接返回空响应' });")
  result = replaceOnce(result, '    memory: { memoryStatus, previewQqForBili, syncQqToBili, refreshBiliToQq, biliToQqStatus, auditTail },\n', '    memory: createExtensionMemoryApi({ home: DSH_HOME }),\n')
  result = replaceRange(result, '    const [bridge, bili, memory] = await Promise.all([', '    // SnowLuma 只报',
    "    const bridge = await bridgeStatus().catch(error => ({ ok: false, error: String(error?.message ?? error) }));\n    const bili = schedulerStatus;\n")
  result = replaceOnce(result, '    const personaText = readTextFile(resolvePersonaFile());\n', '')
  result = replaceOnce(result, '      memory,\n      memoryCard: memoryCardStatusNow(),\n', '')
  result = replaceRange(result, '      persona: {\n        path: resolvePersonaFile(),', '      paths: { ...pathSummary(), ...memory.paths, backupDir: BACKUP_DIR },', '')
  result = replaceOnce(result, '      paths: { ...pathSummary(), ...memory.paths, backupDir: BACKUP_DIR },', '      paths: { ...pathSummary(), backupDir: BACKUP_DIR },')
  result = replaceOnce(result, '        qqForBili: fileInfo(activeMemoryPaths().qqForBili),\n', '')
  result = replaceRange(result, '      // 6) 可选：语音包 / 桌宠', '      // 7) 起桥接', '')
  result = replaceOnce(result, "      add('人设卡', fs.existsSync(resolvePersonaFile()), maskPath(resolvePersonaFile()));\n", '')
  result = replaceRange(result, '      const qqMemoryOn = readAll().unified.memory?', "      let ffmpeg = false;", "      checks.push(...await collectSplitComponentDiagnostics(createSurfcoreComponentClient({ home: DSH_HOME })));\n")
  result = replaceRange(result, '      // 语音链路：只报端口状态', '      // 同名检查只留一条', '')
  result = replaceOnce(result, '        voice: body.voice === true,\n        pet: body.pet === true,\n', '')
  result = replaceOnce(result, "        ['persona', resolvePersonaFile()], ['alignments', ALIGN_FILE],\n        ['qq-memory', activeMemoryPaths().qqForBili], ['qq-alignment', QQ_ALIGNMENT_BRIEF], ['bili-alignment', BILI_ALIGNMENT_FILE],",
    "        ['alignments', ALIGN_FILE], ['qq-alignment', QQ_ALIGNMENT_BRIEF], ['bili-alignment', BILI_ALIGNMENT_FILE],")
  result = replaceOnce(result, "        ['persona-', resolvePersonaFile()], ['alignments-', ALIGN_FILE],", "        ['alignments-', ALIGN_FILE],")
  result = replaceRange(result, '  // 语音链路自检：本地音色要 9880', '}\n\nexport default { name, inject, apply };', '')
  return result
}
