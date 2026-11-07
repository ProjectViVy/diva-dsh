#!/usr/bin/env node
// 把一个 Live2D 模型目录装进角色舞台的模型根。
//
//   node scripts/import-model.mjs <模型目录> [装进来的名字]
//
// 只做三件事：校验（有没有 .model3.json 和 .moc3）、复制、报告结果。
// 校验不过就不复制，避免留下半个模型让面板显示成「缺资产」。
import { cp, mkdir, readdir, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { localEnvironment } from './lib/source.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 在目录里找 model3.json；模型常年放在一层同名子目录里，所以往下找一层。 */
async function findModel3(dir, depth = 1) {
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return null }
  const direct = entries.filter(entry => entry.isFile() && entry.name.endsWith('.model3.json'))
  if (direct.length > 0) return { dir, file: direct[0].name }
  if (depth <= 0) return null
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const hit = await findModel3(join(dir, entry.name), depth - 1)
    if (hit !== null) return hit
  }
  return null
}

async function main() {
  const [source, ...rest] = process.argv.slice(2)
  if (!source) {
    console.error('用法：node scripts/import-model.mjs <模型目录> [名字]')
    process.exit(1)
  }

  const from = isAbsolute(source) ? source : resolve(process.cwd(), source)
  const info = await stat(from).catch(() => null)
  if (info === null || !info.isDirectory()) {
    console.error(`不是目录：${from}`)
    process.exit(1)
  }

  const hit = await findModel3(from)
  if (hit === null) {
    console.error(`在 ${from} 里没找到 *.model3.json —— 这不是一个正常的 Live2D 模型目录。`)
    process.exit(1)
  }

  // 有 model3.json 但旁边没有 moc3，模型是残缺的
  const files = await readdir(hit.dir)
  if (!files.some(name => name.endsWith('.moc3'))) {
    console.error(`${hit.dir} 里有 ${hit.file} 却没有 .moc3 —— 模型不完整。`)
    process.exit(1)
  }

  const home = process.env.DSH_HOME ?? localEnvironment(ROOT).DSH_HOME
  const modelsRoot = join(home, 'live2d', 'models')
  const name = rest.join(' ').trim() || basename(hit.dir === from ? from : hit.dir)
  const target = join(modelsRoot, name)

  await mkdir(modelsRoot, { recursive: true, mode: 0o700 })
  // 模型目录本身就是模型根时，直接整个复制；否则复制 model3.json 所在那一层
  const copyFrom = hit.dir === from ? from : hit.dir
  await cp(copyFrom, target, { recursive: true, force: true })

  const texts = await readdir(target)
  console.log(`已装入：${target}`)
  console.log(`  清单：${hit.file}`)
  console.log(`  文件：${texts.length} 项`)
  console.log('刷新面板即可看到；用户模型优先于示例模型。')
}

main().catch(error => {
  console.error(`失败：${error.message}`)
  process.exit(1)
})
