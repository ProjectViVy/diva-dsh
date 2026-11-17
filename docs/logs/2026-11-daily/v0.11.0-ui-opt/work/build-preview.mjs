/* 生成 UI 复核预览页：把 fixture 与仓库里的真 client.js 拼成一张可截图的页面。
 *   node docs/logs/2026-11-daily/v0.11.0-ui-opt/work/build-preview.mjs
 * 产物只有 preview.html；React UMD 与 client.js 用相对路径直接引用工作区里的文件，
 * 不复制第三方代码，也不改动插件。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..', '..', '..', '..')
const rel = (target) => '../'.repeat(5) + target.replace(/\\/g, '/')

const react = rel('deepseek-harness/node_modules/.pnpm/react@18.3.1/node_modules/react/umd/react.development.js')
const reactDom = rel('deepseek-harness/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/umd/react-dom.development.js')
const client = rel('plugins/dsh-daily/client.js')

const today = JSON.parse(readFileSync(join(root, '.artifacts', 'dsh-home', 'today', '2026-11-16.json'), 'utf8'))
const history = JSON.parse(readFileSync(join(root, '.artifacts', 'dsh-home', 'today', '2026-11-15.json'), 'utf8'))

const template = readFileSync(join(here, 'preview.template.html'), 'utf8')
const html = template
  .replace('__REACT__', react)
  .replace('__REACT_DOM__', reactDom)
  .replace('__CLIENT__', client)
  .replace('__TODAY_CARDS__', JSON.stringify(today.cards.slice(0, 3)))
  .replace('__HISTORY_CARDS__', JSON.stringify(history.cards.slice(0, 2)))

writeFileSync(join(here, 'preview.html'), html, 'utf8')
console.log('preview.html written; today cards =', 3, 'history cards =', 2)
