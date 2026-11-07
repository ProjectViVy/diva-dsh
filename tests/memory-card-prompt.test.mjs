import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'

import { createMemoryService } from '../plugins/memory/src/service.mjs'
import {
  CARD_SECTION_NAME, CARD_SECTION_OFFSET, cardInjectionAllowed, createCardPromptProvider,
  normalizeCardInjectionConfig, registerCardPrompt,
} from '../plugins/memory/src/card-prompt.mjs'

process.env.DSH_SUBJECT_ID ??= 'subject_00000000-0000-4000-8000-000000000001'

const agent = header => ({ session: { header } })
const enabled = extra => normalizeCardInjectionConfig({ enabled: true, ...extra })

test('card injection is off by default and excludes only the control plane', () => {
  const off = normalizeCardInjectionConfig()
  assert.equal(off.enabled, false)
  assert.equal(off.platform, 'qq')
  assert.deepEqual([...off.excludePresets], ['dsh-superagent-router'])
  assert.equal(off.excludeSubagents, true)

  const config = enabled()
  assert.equal(cardInjectionAllowed(agent({ agentPreset: 'standard' }), config), true)
  assert.equal(cardInjectionAllowed(agent({ agentPreset: 'dsh-superagent-worker' }), config), true)
  assert.equal(cardInjectionAllowed(agent({ agentPreset: 'dsh-superagent-router' }), config), false)
  assert.equal(cardInjectionAllowed(agent({ agentPreset: 'standard', origin: 'subagent' }), config), false)
  assert.equal(cardInjectionAllowed(agent({ agentPreset: 'standard', delegationDepth: 1 }), config), false)
  assert.equal(cardInjectionAllowed(undefined, config), false)
})

test('explicit exclusion lists are honoured and unknown platforms fall back to qq', () => {
  const config = normalizeCardInjectionConfig({
    enabled: true, platform: 'bili', excludePresets: ['custom', '', 'custom'],
  })
  assert.equal(config.platform, 'bili')
  assert.deepEqual([...config.excludePresets], ['custom'])
  assert.equal(cardInjectionAllowed(agent({ agentPreset: 'custom' }), config), false)
  assert.equal(cardInjectionAllowed(agent({ agentPreset: 'dsh-superagent-router' }), config), true)
  assert.equal(normalizeCardInjectionConfig({ enabled: true, platform: 'nope' }).platform, 'qq')
  assert.equal(normalizeCardInjectionConfig({ enabled: 'yes' }).enabled, false)
})

test('the provider stays silent while disabled, for excluded agents, and on empty cards', () => {
  let reads = 0
  const provider = createCardPromptProvider({
    read: () => { reads += 1; return '【记忆卡】内容' },
    config: () => normalizeCardInjectionConfig(),
  })
  assert.equal(provider.text(agent({ agentPreset: 'standard' })), '')
  assert.equal(reads, 0)

  const on = createCardPromptProvider({
    read: () => { reads += 1; return '' },
    config: () => enabled(),
  })
  assert.equal(on.text(agent({ agentPreset: 'standard' })), '')
  assert.equal(reads, 1)
  assert.equal(on.text(agent({ agentPreset: 'dsh-superagent-router' })), '')
  assert.equal(reads, 1, 'an excluded agent must not render the card')
})

test('the section text is re-rendered on content change, not on rewrite', () => {
  let reads = 0
  let text = '【记忆卡】第一版'
  let stamp = '1:1'
  const provider = createCardPromptProvider({
    read: () => { reads += 1; return text },
    fingerprint: () => stamp,
    config: () => enabled(),
  })
  const who = agent({ agentPreset: 'standard' })
  assert.equal(provider.text(who), '【记忆卡】第一版')
  assert.equal(reads, 1)

  // 同一次指纹 + 同一份内容：直接吃缓存，不再读卡。
  assert.equal(provider.text(who), '【记忆卡】第一版')
  assert.equal(reads, 1)

  // 写者无条件重写了文件（指纹变了）但内容没变：内容判据让它保持稳定。
  stamp = '2:2'
  assert.equal(provider.text(who), '【记忆卡】第一版')
  assert.equal(reads, 2)

  text = '【记忆卡】第二版'
  stamp = '3:3'
  assert.equal(provider.text(who), '【记忆卡】第二版')
})

test('switching the injected platform re-renders even when the source is untouched', () => {
  let reads = []
  let platform = 'qq'
  const config = () => normalizeCardInjectionConfig({ enabled: true, platform })
  const provider = createCardPromptProvider({
    read: value => { reads.push(value); return `【记忆卡·${value}】` },
    fingerprint: () => '1:1',
    config,
  })
  const who = agent({ agentPreset: 'standard' })
  assert.equal(provider.text(who), '【记忆卡·qq】')
  platform = 'bili'
  assert.equal(provider.text(who), '【记忆卡·bili】')
  assert.deepEqual(reads, ['qq', 'bili'])
})

test('a failing read degrades to no injection and recovers afterwards', () => {
  const warnings = []
  let failing = true
  const provider = createCardPromptProvider({
    read: () => { if (failing) throw new Error('卡损坏'); return '【记忆卡】恢复' },
    config: () => enabled(),
    warn: message => warnings.push(message),
  })
  const who = agent({ agentPreset: 'standard' })
  assert.equal(provider.text(who), '')
  assert.equal(warnings.length, 1)
  failing = false
  assert.equal(provider.text(who), '【记忆卡】恢复')
})

test('registerCardPrompt installs one non-interpolated section after the persona', () => {
  const installed = []
  const scope = {
    systemPrompt: {
      getSectionOrder: name => assert.equal(name, 'DEPLOYMENT_PERSONA_PREFIX') ?? 0,
      section: section => { installed.push(section); return () => {} },
    },
  }
  const ctx = { inject: (deps, run) => { assert.deepEqual(deps, ['systemPrompt']); run(scope); return { dispose: async () => {} } } }
  const service = {
    cardInjectionConfig: () => ({ enabled: true }),
    cardPromptText: () => '【记忆卡】来自服务',
    cardPromptFingerprint: () => '0:0',
  }
  registerCardPrompt(ctx, service)
  assert.equal(installed.length, 1)
  assert.equal(installed[0].name, CARD_SECTION_NAME)
  assert.equal(installed[0].order, CARD_SECTION_OFFSET)
  assert.equal(installed[0].interpolate, false)
  assert.equal(installed[0].text({ agent: agent({ agentPreset: 'standard' }) }), '【记忆卡】来自服务')
  assert.equal(installed[0].text({}), '', 'diagnostics without an agent get nothing')
})

test('a context without the systemPrompt capability degrades to a warning', () => {
  const warnings = []
  const result = registerCardPrompt(
    { effect: () => {} },
    { cardInjectionConfig: () => ({ enabled: true }), cardPromptText: () => 'x', cardPromptFingerprint: () => '1:1' },
    { warn: message => warnings.push(message) },
  )
  assert.equal(result, undefined)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /记忆卡注入不可用/)
})

test('the live service renders the owner-facing card for injection', async t => {
  const base = resolve('.artifacts/test-tmp')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'card-prompt-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(resolve(dir, 'config.json'), JSON.stringify({ cardInjection: { enabled: true } }))
  // neutralizeEntries 存在时从活卡渲染（生产路径），史 stub 即可。
  const service = createMemoryService({ stateDir: dir, biliMemory: { neutralizeEntries: records => records } })
  await service.action('add', { text: '主人今天在接 ActMem 注入', scope: 'qq' })
  const text = service.cardPromptText('qq')
  assert.match(text, /主人今天在接 ActMem 注入/)
  assert.match(text, /记忆卡/)
  assert.equal(typeof service.cardPromptFingerprint('qq'), 'string')

  const provider = createCardPromptProvider({
    read: platform => service.cardPromptText(platform),
    fingerprint: platform => service.cardPromptFingerprint(platform),
    config: () => normalizeCardInjectionConfig(service.cardInjectionConfig()),
  })
  assert.match(provider.text(agent({ agentPreset: 'standard' })), /主人今天在接 ActMem 注入/)
  assert.equal(provider.text(agent({ agentPreset: 'dsh-superagent-router' })), '')

  // 关掉开关后立刻不再注入，且不读卡。
  writeFileSync(resolve(dir, 'config.json'), JSON.stringify({ cardInjection: { enabled: false } }))
  assert.equal(provider.text(agent({ agentPreset: 'standard' })), '')
})
