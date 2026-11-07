import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const moduleFile = resolve('plugins/voice/src/install-download.mjs')
const digest = buffer => createHash('sha256').update(buffer).digest('hex')
async function setup(t, payload) {
  assert.ok(existsSync(moduleFile), 'the verified download implementation must exist')
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'voice-download-'))
  const requests = []
  const server = createServer((req, res) => {
    requests.push(req.headers.range || '')
    const start = Number(/^bytes=(\d+)-$/.exec(req.headers.range || '')?.[1] || 0)
    res.writeHead(start ? 206 : 200, start ? { 'content-range': `bytes ${start}-${payload.length - 1}/${payload.length}` } : {})
    res.end(payload.subarray(start))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }) })
  const url = `http://127.0.0.1:${server.address().port}/asset`
  return { ...await import(pathToFileURL(moduleFile).href), dir, requests, url }
}

test('verified asset download resumes an interrupted local file and checks its SHA-256', async t => {
  const payload = Buffer.from('known model asset content')
  const { downloadVerifiedAsset, dir, requests, url } = await setup(t, payload)
  const destination = join(dir, 'asset.bin')
  writeFileSync(`${destination}.part`, payload.subarray(0, 6))
  await downloadVerifiedAsset({ url, destination, sha256: digest(payload), size: payload.length })
  assert.deepEqual(readFileSync(destination), payload)
  assert.deepEqual(requests, ['bytes=6-'])
  assert.equal(existsSync(`${destination}.part`), false)
})

test('verified download refuses corrupted content without publishing it', async t => {
  const payload = Buffer.from('content with the wrong digest')
  const { downloadVerifiedAsset, dir, url } = await setup(t, payload)
  const destination = join(dir, 'asset.bin')
  await assert.rejects(downloadVerifiedAsset({ url, destination, sha256: digest(Buffer.from('expected')), size: payload.length }), /sha-?256/i)
  assert.equal(existsSync(destination), false)
})

test('split archives are assembled in order and published only after the combined digest matches', async t => {
  const first = Buffer.from('first-'), second = Buffer.from('second')
  const { downloadVerifiedParts, dir, url } = await setup(t, first)
  const server = createServer((_req, res) => res.end(second))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const destination = join(dir, 'combined.tar.gz')
  const parts = [{ url, size: first.length }, { url: `http://127.0.0.1:${server.address().port}/`, size: second.length }]
  await downloadVerifiedParts({ parts, destination, sha256: digest(Buffer.concat([first, second])), size: first.length + second.length })
  assert.deepEqual(readFileSync(destination), Buffer.concat([first, second]))
  await assert.rejects(downloadVerifiedParts({ parts, destination: join(dir, 'wrong.tar.gz'), sha256: digest(Buffer.from('wrong')), size: first.length + second.length }), /sha-?256/i)
  assert.equal(existsSync(join(dir, 'wrong.tar.gz')), false)
})
