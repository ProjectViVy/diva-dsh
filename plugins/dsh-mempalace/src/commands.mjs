import * as fs from 'node:fs'
import * as path from 'node:path'

const USAGE = [
  '用法：',
  '  /mempalace status               查看记忆宫殿状态',
  '  /mempalace search <关键词>       语义或关键字搜索',
  '  /mempalace stats                统计信息',
  '  /mempalace project [名称]        查看或设置当前项目标签',
  '  /mempalace export               导出全部数据到状态目录',
].join('\n')

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function failure(error) {
  const hint = typeof error?.hint === 'string' && error.hint.length > 0 ? `\n提示：${error.hint}` : ''
  return { kind: 'error', text: `记忆宫殿：${errorMessage(error)}${hint}` }
}

function statusText(snapshot) {
  const lines = ['记忆宫殿状态']
  if (snapshot.state !== 'ready') {
    lines.push(`- 后端：${snapshot.state}`)
    if (snapshot.error) lines.push(`- 错误：${snapshot.error}`)
    if (snapshot.hint) lines.push(`- 提示：${snapshot.hint}`)
    return lines.join('\n')
  }
  const stats = snapshot.stats
  lines.push(
    `- 记忆总数：${stats.total}`,
    `- 存储占用：${stats.storageSizeKb} KB`,
    `- 会话数：${stats.sessions}`,
    `- 向量模型：${snapshot.models.embedding}`,
    `- 关键字索引：${snapshot.fts.enabled ? '启用' : '未启用'}`,
    `- 状态目录：${snapshot.paths.stateDir}`,
  )
  const projects = Object.entries(stats.projects).sort((a, b) => b[1] - a[1]).slice(0, 8)
  if (projects.length > 0) lines.push('', `项目：${projects.map(([name, count]) => `${name} (${count})`).join('、')}`)
  return lines.join('\n')
}

function searchText(search) {
  if (search.results.length === 0) return `没有找到与「${search.query}」相关的记忆。`
  const mode = search.mode === 'keyword' ? '关键字回退' : search.mode === 'mixed' ? '语义 + 关键字' : '语义'
  const hits = search.results.map(item => {
    const score = item.similarity > 0 ? `（${(item.similarity * 100).toFixed(1)}%）` : ''
    return `[${item.project}/${item.topic}]${score}\n${item.text}`
  })
  return `找到 ${search.results.length} 条记忆（${mode}）：\n\n${hits.join('\n\n---\n\n')}`
}

function statsText(stats) {
  const lines = [
    `记忆总数：${stats.total}（命中 ${stats.sessions} 个会话）`,
    `存储占用：${stats.storageSizeKb} KB`,
    `平均长度：${stats.avgContentLength} 字符`,
  ]
  if (stats.oldest) lines.push(`时间范围：${stats.oldest} → ${stats.newest}`)
  for (const [label, counts] of [['项目', stats.projects], ['话题', stats.topics], ['来源', stats.sources]]) {
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8)
    if (entries.length > 0) lines.push(`${label}：${entries.map(([name, count]) => `${name} (${count})`).join('、')}`)
  }
  return lines.join('\n')
}

/**
 * Register the `/mempalace` command.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {import('./service.mjs').MempalaceService} service
 */
export function applyCommands(ctx, service) {
  ctx.commands.register({
    name: 'mempalace',
    description: '管理记忆宫殿：状态、搜索、项目标签与导出',
    input: { hint: '[status|search <q>|stats|project [name]|export]' },
    async handler(invocation) {
      const session = invocation.agent.session
      const input = String(invocation.rawInput ?? '').trim()
      const [verb = '', ...rest] = input.split(/\s+/)
      const argument = rest.join(' ').trim()
      try {
        switch (verb.toLowerCase()) {
          case '':
          case 'status':
            return { kind: 'success', text: statusText(await service.statusSnapshot()) }
          case 'search': {
            if (!argument) return { kind: 'error', text: `请提供搜索关键词。\n${USAGE}` }
            const searched = await service.search(argument, {
              project: service.getSessionProject(session) || null,
              n_results: 5,
            })
            return { kind: 'success', text: searchText(searched) }
          }
          case 'stats':
            return { kind: 'success', text: statsText(await service.stats()) }
          case 'project': {
            if (!argument) {
              return {
                kind: 'success',
                text: `当前项目标签：${service.getSessionProject(session) || '(未设置)'}`,
              }
            }
            const project = service.setSessionProject(session, argument)
            return { kind: 'success', text: `当前会话的项目标签已设为 ${project}。` }
          }
          case 'export': {
            const payload = await service.exportAll()
            const directory = path.join(service.stateDir, 'exports')
            fs.mkdirSync(directory, { recursive: true })
            const stamp = new Date().toISOString().replace(/[:.]/g, '-')
            const target = path.join(directory, `mempalace-${stamp}.json`)
            fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
            return {
              kind: 'success',
              text: `已导出 ${payload.memories.length} 条记忆、${payload.entities.length} 个实体、${payload.triples.length} 条事实到：\n${target}`,
            }
          }
          default:
            return { kind: 'error', text: `未知子命令：${verb}\n${USAGE}` }
        }
      } catch (error) {
        return failure(error)
      }
    },
  })
}
