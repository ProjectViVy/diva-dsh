function once(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('The pinned QQ console no longer matches the component split')
  return source.replace(before, after)
}

/** Keep the upstream console's DOM bindings intact while removing obsolete entry points. */
export function renderSplitConsole(source) {
  let html = source.replaceAll('\r\n', '\n')
  html = once(html, '<button data-view="persona" class="nav-item"><span class="nav-icon" aria-hidden="true">◉</span>人格与角色</button>', '<button data-view="sim-prompt" class="nav-item"><span class="nav-icon" aria-hidden="true">◉</span>仿真提示词</button>')
  html = once(html, "  persona: ['人格与角色', '给你的伙伴，一点独特个性。', '选择已有角色，或用自己的语言写下新的性格与表达方式。'],\n", "  'sim-prompt': ['仿真提示词', '管理仿真模式的提示词。', '查看、编辑或恢复一代和二代仿真提示词。'],\n")
  html = once(html, '      <h3 class="layer-heading">仿真提示词（预设内置）', '    </section>\n<section id="section-sim-prompt" data-page="sim-prompt" class="card span-all">\n      <h3 class="layer-heading">仿真提示词（预设内置）')
  html = once(html, 'refresh(); refreshRoles(); refreshWhitelist();', 'refresh(); refreshWhitelist();')
  html = once(html, '  const page = section.dataset.page;\n  featureIndex.push', "  const page = section.dataset.page;\n  if (page === 'persona') return;\n  featureIndex.push")
  html = once(html, "document.getElementById('metricRole').textContent = '角色 · ' + (status.role || '默认人格');", "document.getElementById('metricRole').textContent = 'QQ 桥接';")
  html = once(html, '  if (document.getElementById(\'voicePacks\')) {\n    vpLoad();', '  if (false) {\n    vpLoad();')
  html = once(html, '（改 <code>socialV2.voice.dir</code> 可换）', '（项目内默认路径）')
  html = html.replaceAll('qq-bridge/audio/', '.artifacts/dsh-home/voice/audio/')
  html = once(html, '（见下方配置区）', '（在独立语音插件中设置）')
  html = once(html, '命令行等价工具：<code>node scripts/send-voice.mjs list-voice</code>（经桥接）或 <code>node voice-cli.mjs</code>（独立工具，在上级 <code>voice-tool/</code> 里直连 SnowLuma）。', '可在独立语音插件中管理语音设置。')
  return once(html, '</style>', '#section-persona, #section-voice { display: none !important; }\n</style>')
}
