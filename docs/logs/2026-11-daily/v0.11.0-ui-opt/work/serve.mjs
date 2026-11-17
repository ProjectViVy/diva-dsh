/* 给 UI 复核用的极小静态服务：只服务工作区根目录，读文件、带正确的 MIME。
 *   node docs/logs/2026-11-daily/v0.11.0-ui-opt/work/serve.mjs [port]
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const root = normalize(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..'))
const port = Number(process.argv[2] || 4123)
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json; charset=utf-8' }

createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname)
    const target = normalize(join(root, pathname))
    if (!target.startsWith(root + sep)) { res.writeHead(403); res.end('forbidden'); return }
    const info = await stat(target)
    if (!info.isFile()) { res.writeHead(404); res.end('not found'); return }
    const ext = target.slice(target.lastIndexOf('.'))
    res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream', 'cache-control': 'no-store' })
    res.end(await readFile(target))
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
}).listen(port, '127.0.0.1', () => console.log('serving ' + root + ' at http://127.0.0.1:' + port))
