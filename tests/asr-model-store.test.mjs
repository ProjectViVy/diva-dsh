// 模型仓储测试：用本地替身 fetch 验证「下载 → 校验 → 落地」这条链。
// 不联网、不下载真实模型（那 239MB 留给真机用例）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ModelManifestError, ModelPrepareError, assetsFor, createModelStore, readManifest } from '../plugins/asr/src/model-store.mjs'

function tempDir(t, prefix = 'asr-models-') {
  const base = resolve('.artifacts/test-tmp')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, prefix))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

const modelBytes = Buffer.from('fake-sensevoice-model-bytes')
const tokensBytes = Buffer.from('a\nb\n')
const vadBytes = Buffer.from('fake-vad')

function sha256(buffer) { return createHash('sha256').update(buffer).digest('hex') }

/** 一份只含小文件的清单，形状与随包发布的一致。 */
function manifestFile(t, dir, { modelSha = sha256(modelBytes) } = {}) {
  const file = join(dir, 'models.json')
  writeFileSync(file, JSON.stringify({
    version: 1,
    origins: ['https://first.example', 'https://second.example'],
    engines: {
      sensevoice: {
        runtime: 'sherpa-onnx',
        languages: ['auto', 'zh'],
        shared: {
          tokens: { path: 'repo/tokens.txt', bytes: tokensBytes.length, sha256: sha256(tokensBytes) },
          vad: { path: 'repo/vad.onnx', bytes: vadBytes.length, sha256: sha256(vadBytes) },
        },
        precisions: {
          int8: { model: { path: 'repo/model.int8.onnx', bytes: modelBytes.length, sha256: modelSha } },
        },
      },
    },
  }))
  return file
}

/** 只认特定 URL 的替身 fetch；返回 404 代表这个源没有。 */
function fakeFetch({ served = {}, onRequest = null } = {}) {
  return async (url, options = {}) => {
    onRequest?.(url, options)
    const body = served[url]
    if (!body) return { ok: false, status: 404, body: null }
    return {
      ok: true,
      status: 200,
      body: (async function* () {
        for (let offset = 0; offset < body.length; offset += 7) yield body.subarray(offset, offset + 7)
      })(),
    }
  }
}

test('readManifest rejects missing or malformed manifests', t => {
  const dir = tempDir(t)
  assert.throws(() => readManifest(join(dir, 'nope.json')), ModelManifestError)
  const bad = join(dir, 'bad.json')
  writeFileSync(bad, '{"engines": 3}')
  assert.throws(() => readManifest(bad), /格式无效/)
})

test('assetsFor merges shared assets with the selected precision', t => {
  const dir = tempDir(t)
  const store = createModelStore(dir, { manifestFile: manifestFile(t, dir) })
  const entries = assetsFor(store.manifest, 'sensevoice', 'int8')
  assert.deepEqual(entries.map(entry => entry.name).sort(), ['model', 'tokens', 'vad'])
  assert.throws(() => assetsFor(store.manifest, 'whisper', 'int8'), /没有引擎/)
  assert.throws(() => assetsFor(store.manifest, 'sensevoice', 'fp32'), /没有精度/)
})

test('prepare downloads, verifies and records a ready marker', async t => {
  const dir = tempDir(t)
  const requests = []
  const store = createModelStore(dir, {
    manifestFile: manifestFile(t, dir),
    fetchImpl: fakeFetch({
      served: {
        'https://first.example/repo/model.int8.onnx': modelBytes,
        'https://first.example/repo/tokens.txt': tokensBytes,
        'https://first.example/repo/vad.onnx': vadBytes,
      },
      onRequest: url => requests.push(url),
    }),
  })
  assert.equal(store.inspect('sensevoice', 'int8').ready, false)
  const events = []
  const result = await store.prepare('sensevoice', 'int8', { onProgress: event => events.push(event) })
  assert.equal(result.ready, true)
  assert.equal(requests.every(url => url.startsWith('https://first.example/')), true)
  assert.ok(events.some(event => event.phase === 'download'))
  assert.equal(events.at(-1).phase, 'done')
  const ready = JSON.parse(readFileSync(join(result.dir, 'ready.json'), 'utf8'))
  assert.equal(ready.files.model.sha256, sha256(modelBytes))
  assert.equal(existsSync(join(result.dir, 'model.int8.onnx')), true)
  // 二次准备不再发起下载。
  requests.length = 0
  await store.prepare('sensevoice', 'int8')
  assert.deepEqual(requests, [])
})

test('a corrupt download is rejected and the next origin is tried', async t => {
  const dir = tempDir(t)
  const second = 'https://second.example'
  const store = createModelStore(dir, {
    manifestFile: manifestFile(t, dir),
    fetchImpl: fakeFetch({
      served: {
        'https://first.example/repo/model.int8.onnx': Buffer.from('tampered-bytes-of-same-size!'),
        [`${second}/repo/model.int8.onnx`]: modelBytes,
        [`${second}/repo/tokens.txt`]: tokensBytes,
        [`${second}/repo/vad.onnx`]: vadBytes,
      },
    }),
  })
  const result = await store.prepare('sensevoice', 'int8')
  assert.equal(result.ready, true)
  assert.equal(JSON.parse(readFileSync(join(result.dir, 'ready.json'), 'utf8')).files.model.sha256, sha256(modelBytes))
})

test('when every origin fails, prepare explains which hosts were tried', async t => {
  const dir = tempDir(t)
  const store = createModelStore(dir, { manifestFile: manifestFile(t, dir), fetchImpl: fakeFetch() })
  await assert.rejects(store.prepare('sensevoice', 'int8'), error => {
    assert.ok(error instanceof ModelPrepareError)
    assert.equal(error.code, 'ASR_MODEL_DOWNLOAD_FAILED')
    assert.match(error.message, /first\.example/)
    assert.match(error.message, /second\.example/)
    return true
  })
  assert.equal(existsSync(join(store.dirFor('sensevoice', 'int8'), 'model.int8.onnx')), false)
})

test('a manifest hash that does not match the served file is fatal, not silently accepted', async t => {
  const dir = tempDir(t)
  const store = createModelStore(dir, {
    manifestFile: manifestFile(t, dir, { modelSha: '0'.repeat(64) }),
    fetchImpl: fakeFetch({ served: {
      'https://first.example/repo/model.int8.onnx': modelBytes,
      'https://first.example/repo/tokens.txt': tokensBytes,
      'https://first.example/repo/vad.onnx': vadBytes,
      'https://second.example/repo/model.int8.onnx': modelBytes,
      'https://second.example/repo/tokens.txt': tokensBytes,
      'https://second.example/repo/vad.onnx': vadBytes,
    } }),
  })
  await assert.rejects(store.prepare('sensevoice', 'int8'), /下载 model 失败/)
  assert.equal(store.inspect('sensevoice', 'int8').ready, false)
})

test('a configured source list replaces the manifest origins', async t => {
  const dir = tempDir(t)
  const requests = []
  const store = createModelStore(dir, {
    manifestFile: manifestFile(t, dir),
    getOrigins: () => ['https://mirror.example/'],
    fetchImpl: fakeFetch({
      served: {
        'https://mirror.example/repo/model.int8.onnx': modelBytes,
        'https://mirror.example/repo/tokens.txt': tokensBytes,
        'https://mirror.example/repo/vad.onnx': vadBytes,
      },
      onRequest: url => requests.push(url),
    }),
  })
  await store.prepare('sensevoice', 'int8')
  assert.equal(requests.every(url => url.startsWith('https://mirror.example/')), true)
})

test('cancelling a prepare aborts cleanly and leaves no half file', async t => {
  const dir = tempDir(t)
  const controller = new AbortController()
  const store = createModelStore(dir, {
    manifestFile: manifestFile(t, dir),
    fetchImpl: async (url, options = {}) => {
      const body = modelBytes
      return { ok: true, status: 200, body: (async function* () {
        controller.abort()
        if (options.signal?.aborted) { const error = new Error('aborted'); error.name = 'AbortError'; throw error }
        yield body
      })() }
    },
  })
  await assert.rejects(store.prepare('sensevoice', 'int8', { signal: controller.signal }), error => {
    assert.equal(error.code, 'ASR_PREPARE_CANCELLED')
    return true
  })
  assert.equal(existsSync(join(store.dirFor('sensevoice', 'int8'), 'model.int8.onnx')), false)
  assert.equal(existsSync(`${join(store.dirFor('sensevoice', 'int8'), 'model.int8.onnx')}.part`), false)
})
