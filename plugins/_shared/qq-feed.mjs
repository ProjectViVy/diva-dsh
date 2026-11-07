import fs, { statSync } from 'node:fs'

/** Asynchronously scan a stable pair of feed files with bounded line buffers. */
export async function scanQqFeedSnapshot(feedFile, createCollector) {
  if (!feedFile) return null
  const sources = [`${feedFile}.1`, feedFile]
  const stat = file => {
    try { const s = statSync(file); return { size: s.size, signature: `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}` } }
    catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = sources.map(stat)
    if (before.every(value => value === null)) return null
    const collector = createCollector()
    let retry = false
    try {
      for (let i = 0; i < sources.length; i++) {
        if (!before[i] || before[i].size === 0) continue
        const handle = await fs.promises.open(sources[i], 'r')
        try {
          let parts = [], length = 0, oversized = false
          const append = part => { if (oversized || !part.length) return; length += part.length; if (length > 1024 * 1024) { oversized = true; parts = []; return } parts.push(part) }
          const finish = () => { collector.line(oversized ? null : Buffer.concat(parts, length).toString('utf8')); parts = []; length = 0; oversized = false }
          for await (const chunk of handle.createReadStream({ start: 0, end: before[i].size - 1, highWaterMark: 65536, autoClose: false })) {
            let start = 0, end
            while ((end = chunk.indexOf(10, start)) !== -1) { append(chunk.subarray(start, end)); finish(); start = end + 1 }
            append(chunk.subarray(start))
          }
          if (length || oversized) finish()
        } finally { await handle.close() }
      }
    } catch (error) { if (error.code === 'ENOENT') retry = true; else throw error }
    const after = sources.map(stat)
    if (!retry && before.every((value, i) => value?.signature === after[i]?.signature)) return collector.result()
  }
  throw new Error('QQ 公开群消息记录正在变化，请稍后重试；原摘要已保留')
}
