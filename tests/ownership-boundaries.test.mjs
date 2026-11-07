import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

function sourceFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      files.push(...sourceFiles(path))
    } else if (/\.(?:mjs|cjs|js|ts|tsx)$/.test(entry.name)) {
      files.push(path)
    }
  }
  return files
}

function importSpecifiers(source) {
  const found = []
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.push(match[1])
  }
  return found
}

function mutatingStatements(source) {
  return source.match(/[^;\n]*(?:writeFile|appendFile|copyFile|rename)(?:Sync)?\s*\([^;]*/g) ?? []
}

function offenders(dir, predicate, base = ROOT) {
  return sourceFiles(dir)
    .filter(file => predicate(readFileSync(file, 'utf8'), file))
    .map(file => relative(base, file))
}

const MEMPALACE_STATE = /dsh-mempalace|mempalace[\\/](?:memories\.db|config\.json|identity\.txt|runtime\.json)/

test('memory, voice and shared code never touch MemPalace state', () => {
  const found = offenders(join(ROOT, 'plugins/memory/src'), source => MEMPALACE_STATE.test(source))
    .concat(offenders(join(ROOT, 'plugins/voice/src'), source => MEMPALACE_STATE.test(source)))
    .concat(offenders(join(ROOT, 'plugins/_shared'), source => MEMPALACE_STATE.test(source)))
  assert.deepEqual(found, [], `记忆、语音和共享层不得读写 MemPalace 状态：\n${found.join('\n')}`)
})

test('memory relative imports never reach into MemPalace', () => {
  const found = offenders(join(ROOT, 'plugins/memory/src'), source =>
    importSpecifiers(source).some(specifier => specifier.startsWith('.') && /mempalace/i.test(specifier)))
  assert.deepEqual(found, [], `记忆只能经组件 IPC 访问归档端，不得直接 import 其源码：\n${found.join('\n')}`)
})

test('memory names MemPalace only in the single component call', () => {
  const found = []
  let indexLines = 0
  for (const file of sourceFiles(join(ROOT, 'plugins/memory/src'))) {
    const relativePath = relative(ROOT, file)
    const lines = readFileSync(file, 'utf8').split('\n').filter(line => /mempalace/i.test(line))
    if (!lines.length) continue
    const allowed = relativePath === 'plugins/memory/src/index.mjs' && lines.every(line => {
      const hits = line.match(/mempalace/gi) ?? []
      return hits.length === 1 && /\bname:\s*'mempalace'/.test(line)
    })
    if (!allowed) found.push(relativePath)
    else indexLines += lines.length
  }
  assert.deepEqual(found, [], `记忆域只能在 index.mjs 以 name: 'mempalace' 引用归档组件：\n${found.join('\n')}`)
  assert.ok(indexLines > 0, '记忆域缺少对归档组件的唯一调用点')
})

test('MemPalace public HTTP exposes no archive routes', () => {
  const source = readFileSync(join(ROOT, 'plugins/dsh-mempalace/src/http.mjs'), 'utf8')
  const routes = [...source.matchAll(/route\s*===\s*['"]([^'"]+)['"]/g)].map(match => match[1])
  assert.ok(routes.length > 0, '路由解析失败：未读到任何 route 比较')
  assert.deepEqual(routes.filter(route => /^\/archive(?:\/|$)/.test(route)), [],
    '归档入口只允许内部组件调用，公开 HTTP 不得暴露')
})

test('MemPalace retires identity.txt only in the one-time migration', () => {
  const found = offenders(join(ROOT, 'plugins/dsh-mempalace/src'), source =>
    mutatingStatements(source).some(statement => /identity/i.test(statement)))
  assert.deepEqual(found, ['plugins/dsh-mempalace/src/retire.mjs'],
    '只有一次性迁移可以移动 identity.txt；其他代码不得写入人格文件')
})

test('MemPalace no longer reads identity.txt', () => {
  const found = offenders(join(ROOT, 'plugins/dsh-mempalace/src'), source =>
    /identity\.txt|identityPath|## Identity/.test(source))
  assert.deepEqual(found, ['plugins/dsh-mempalace/src/retire.mjs'],
    '除迁移外，MemPalace 不得读取独立人格文件')
})

test('dsh-evolution never writes harness state files directly', () => {
  const found = offenders(join(ROOT, 'plugins/dsh-evolution/src'), source =>
    mutatingStatements(source).some(statement => /harness_state|refinements\.jsonl/.test(statement)))
  assert.deepEqual(found, [], `进化面板不得直接改写 harness 状态：\n${found.join('\n')}`)
})

test('the record layer is the only place that opens a database', () => {
  const sqliteFiles = sourceFiles(join(ROOT, 'plugins/dsh-evolution/src'))
    .filter(file => /node:sqlite/.test(readFileSync(file, 'utf8')))
    .map(file => relative(ROOT, file))
  assert.deepEqual(sqliteFiles, ['plugins/dsh-evolution/src/records.mjs'],
    'node:sqlite 只能出现在进化记录层，其他视图保持无数据库依赖')
  const otherDomains = ['plugins/memory/src', 'plugins/voice/src', 'plugins/dsh-laputa/src',
    'plugins/dsh-mempalace/src', 'plugins/dsh-continual-harness/src', 'plugins/_shared']
  const found = otherDomains.flatMap(dir =>
    offenders(join(ROOT, dir), source => /evolution\.db|DSH_EVOLUTION_STATE_DIR|dsh-evolution\/src\/records/.test(source)))
  assert.deepEqual(found, [], `进化记录库只属于 Evolution：\n${found.join('\n')}`)
})

test('dsh-evolution reaches no other domain source or state', () => {
  const escapes = file => {
    const source = readFileSync(file, 'utf8')
    return importSpecifiers(source).some(specifier =>
      specifier.startsWith('../') && !specifier.startsWith('../../_shared/'))
      || mutatingStatements(source).some(statement =>
        /(?:memory|voice|dsh-laputa|dsh-mempalace|dsh-continual-harness|surfcore)[\\/]/.test(statement))
  }
  const found = sourceFiles(join(ROOT, 'plugins/dsh-evolution/src'))
    .filter(file => escapes(file))
    .map(file => relative(ROOT, file))
  assert.deepEqual(found, [], `进化只能依赖共享契约，不得伸进别的领域：\n${found.join('\n')}`)
})

test('the harness reaches Evolution only over component IPC', () => {
  const found = offenders(join(ROOT, 'plugins/dsh-continual-harness/src'), source =>
    importSpecifiers(source).some(specifier => specifier.startsWith('.') && /dsh-evolution|\bevolution\b/.test(specifier)))
  assert.deepEqual(found, [], `Harness 只能经组件 IPC 触达进化记录，不得 import 其源码：\n${found.join('\n')}`)
})

test('Laputa never imports memory, MemPalace or Evolution modules', () => {
  const forbidden = /(?:^|\/)(?:memory|mempalace|evolution)(?:\/|$)/
  const found = offenders(join(ROOT, 'plugins/dsh-laputa/src'), source =>
    importSpecifiers(source).some(specifier => specifier.startsWith('.') && forbidden.test(specifier)))
  assert.deepEqual(found, [], `人格插件不得依赖其他领域插件：\n${found.join('\n')}`)
})

test('Superagent never imports plugin source trees', () => {
  const forbidden = /(?:^|\/)plugins\/|dsh-(?:mempalace|laputa|evolution|continual-harness)/
  const found = offenders(join(ROOT, 'superagent/src'), source =>
    importSpecifiers(source).some(specifier => forbidden.test(specifier)))
  assert.deepEqual(found, [], `控制核心不得依赖插件实现：\n${found.join('\n')}`)
})

test('the mutation scanner detects a synthetic violation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ownership-'))
  try {
    mkdirSync(join(dir, 'nested'))
    writeFileSync(join(dir, 'nested', 'bad.mjs'), "import { writeFileSync } from 'node:fs'\nwriteFileSync('identity.txt', 'x')\n")
    const found = offenders(dir, source =>
      mutatingStatements(source).some(statement => /identity/i.test(statement)), dir)
    assert.deepEqual(found, ['nested/bad.mjs'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
