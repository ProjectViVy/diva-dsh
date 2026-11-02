import * as path from 'node:path'

export function extractMessageText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
}

/** Only direct human prompts use source.kind 'user'; injected notices carry their own kind. */
export function isHumanUserMessage(message) {
  return message?.role === 'user' && message?.source?.kind === 'user'
}

export function projectFromCwd(cwd) {
  const base = path.basename(String(cwd ?? '').trim())
  return base && base !== '.' && base !== path.sep ? base : 'general'
}

export function resolveProject({ defaultProject, sessionProject, cwd }) {
  if (defaultProject) return defaultProject
  if (sessionProject) return sessionProject
  return projectFromCwd(cwd)
}

export function buildExchange(userText, assistantText, maxChars) {
  const body = `> ${String(userText).trim()}\n\n${String(assistantText).trim()}`
  if (!Number.isFinite(maxChars) || body.length <= maxChars) return body
  return `${body.slice(0, Math.max(0, maxChars - 12))}\n[truncated]`
}

export class SessionCapture {
  constructor({ userMinChars = 10, captureMinChars = 20, captureMaxChars = 2000 } = {}) {
    this.userMinChars = userMinChars
    this.captureMinChars = captureMinChars
    this.captureMaxChars = captureMaxChars
    this.pending = []
  }

  pushUser(text) {
    const value = String(text ?? '').trim()
    if (value.length < this.userMinChars) return false
    this.pending.push(value)
    return true
  }

  takeAssistant(text, { interrupted = false } = {}) {
    const answer = String(text ?? '').trim()
    if (this.pending.length === 0) return null
    const question = this.pending.join('\n\n')
    this.pending = []
    if (interrupted) return null
    if (answer.length < this.captureMinChars) return null
    return {
      userText: question,
      assistantText: answer,
      content: buildExchange(question, answer, this.captureMaxChars),
    }
  }

  clear() {
    this.pending = []
  }
}
