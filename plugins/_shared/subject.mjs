import { isSubjectId } from './contracts.mjs'

/** No trustworthy subject identity is available; callers must fail closed instead of inventing one. */
export class SubjectUnavailableError extends Error {
  constructor(message = '无法确定本安装的 subject', hint = '确认 dsh-superagent 已启动并完成主体初始化，然后重试') {
    super(message)
    this.name = 'SubjectUnavailableError'
    this.code = 'SUBJECT_UNAVAILABLE'
    this.hint = hint
  }
}

/** The subject from DSH_SUBJECT_ID; a malformed value fails closed instead of silently falling back. */
export function subjectFromEnv(env = process.env) {
  const value = env.DSH_SUBJECT_ID
  if (value === undefined || value === '') return undefined
  if (!isSubjectId(value)) {
    throw new SubjectUnavailableError(
      `DSH_SUBJECT_ID 不是合法的 subject_<uuid>：${JSON.stringify(value)}`,
      '修正启动环境变量 DSH_SUBJECT_ID，或删除它以读取 Superagent 的主体 API',
    )
  }
  return value
}

/** Resolves the installation subject from the environment, then from Superagent's loopback API; never generates one. */
export async function resolveSubject({ env = process.env, webServer = null, fetchImpl = fetch, timeoutMs = 2000, attempts = 3, delayMs = 250 } = {}) {
  const fromEnv = subjectFromEnv(env)
  if (fromEnv) return fromEnv
  const port = Number(webServer?.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new SubjectUnavailableError('无法确定 Superagent 的管理端口，也没有 DSH_SUBJECT_ID')
  }
  let lastError
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    if (attempt) await new Promise(waited => setTimeout(waited, delayMs))
    try {
      const response = await fetchImpl(`http://127.0.0.1:${port}/orchestrator/api/subject`, {
        headers: { 'x-orchestrator-request': '1' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) throw new Error(`Superagent 主体 API 返回 HTTP ${response.status}`)
      const value = await response.json()
      if (!isSubjectId(value?.subjectId)) throw new Error('Superagent 主体 API 返回的 subjectId 无效')
      return value.subjectId
    } catch (error) { lastError = error }
  }
  throw new SubjectUnavailableError(`无法从 Superagent 读取主体：${String(lastError?.message ?? lastError)}`)
}
