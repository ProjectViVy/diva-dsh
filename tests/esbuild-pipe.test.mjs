import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

test('Windows dev preload transforms large esbuild inputs and preserves normal file writes', {
  skip: process.platform !== 'win32',
}, () => {
  const result = spawnSync(process.execPath, [
    '--input-type=module', '-e', `
      import assert from 'node:assert/strict'
      import fs from 'node:fs'
      import os from 'node:os'
      import path from 'node:path'
      import { createRequire } from 'node:module'
      const require = createRequire(import.meta.url)
      const viteRequire = createRequire(require.resolve('vite', { paths: [path.resolve('deepseek-harness/apps/web')] }))
      const esbuild = viteRequire('esbuild')
      const input = 'x'.repeat(1500000)
      for (const transform of [esbuild.transform, esbuild.transformSync]) {
        const output = await transform('var text = ' + JSON.stringify(input), { minify: true })
        assert.ok(output.code.includes(input))
      }
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pipe-test-'))
      const file = path.join(dir, 'normal.txt')
      fs.writeFileSync(file, 'sync')
      assert.equal(fs.readFileSync(file, 'utf8'), 'sync')
      await new Promise((resolve, reject) => fs.writeFile(file, 'async', error => error ? reject(error) : resolve()))
      assert.equal(fs.readFileSync(file, 'utf8'), 'async')
      fs.unlinkSync(file)
      fs.rmdirSync(dir)
      esbuild.stop()
    `,
  ], {
    cwd: resolve('.'), encoding: 'utf8', timeout: 20000,
    // NODE_OPTIONS also reaches esbuild's worker with its explicit execArgv: [].
    env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS,
      '--require ' + JSON.stringify(resolve('scripts/lib/esbuild-pipe.cjs'))].filter(Boolean).join(' ') },
  })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
})
