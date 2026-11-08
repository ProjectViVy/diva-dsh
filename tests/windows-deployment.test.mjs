import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { withTemporaryPatch } from '../scripts/lib/source.mjs'

const root = resolve(import.meta.dirname, '..')
const upstream = join(root, 'superagent')
const loader = join(root, 'deepseek-harness', 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs')

function runPatched(t, program) {
  const temp = join(root, '.artifacts', 'test-tmp')
  mkdirSync(temp, { recursive: true })
  const fixture = mkdtempSync(join(temp, 'windows deployment '))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  cpSync(join(upstream, 'src'), join(fixture, 'src'), { recursive: true })
  symlinkSync(join(upstream, 'node_modules'), join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  execFileSync('git', ['init', '-q', fixture], { windowsHide: true })
  const deployment = pathToFileURL(join(fixture, 'src', 'deployment.ts')).href
  const script = `import assert from 'node:assert/strict';
    import { executable, workerProbe, resolveFeishuBot } from ${JSON.stringify(deployment)};
    ${program}`
  return withTemporaryPatch(fixture, join(root, 'patches', 'superagent-windows.patch'), () =>
    execFileSync(process.execPath, ['--import', pathToFileURL(loader).href, '--input-type=module', '-e', script], {
      cwd: fixture, encoding: 'utf8', windowsHide: true,
    }))
}

test('Windows executable lookup finds .exe files in PATH order and skips worker shims', { skip: process.platform !== 'win32' }, t => {
  runPatched(t, `
    import { mkdirSync, writeFileSync } from 'node:fs';
    import { delimiter, join } from 'node:path';
    const shim = join(process.cwd(), 'worker-bin');
    const first = join(process.cwd(), 'first bin');
    const second = join(process.cwd(), 'second bin');
    for (const dir of [shim, first, second]) mkdirSync(dir);
    for (const dir of [shim, first]) writeFileSync(join(dir, 'example.exe'), '');
    writeFileSync(join(second, 'example'), '');
    const path = [shim, first, second].join(delimiter);
    assert.equal(executable('example', path, shim), join(first, 'example.exe'));
    assert.equal(executable('example.exe', path, shim), join(first, 'example.exe'));
    assert.equal(executable(join(first, 'example.exe'), path), join(first, 'example.exe'));
    assert.throws(() => executable('missing', path), /not an executable file/);
  `)
})

test('worker startup probe runs directly with a cleaned PATH and explicit environment overrides', t => {
  runPatched(t, `
    import { spawnSync } from 'node:child_process';
    import { delimiter, join } from 'node:path';
    const state = join(process.cwd(), 'state');
    const shim = join(state, 'worker-bin');
    process.env.PATH = [shim, process.env.PATH].join(delimiter);
    process.env.DSH_PROBE_INHERITED = 'inherited';
    const runtime = { spawn(spec) {
      const child = spawnSync(spec.argv[0], spec.argv.slice(1), {
        cwd: spec.cwd, env: { ...process.env, ...spec.env }, encoding: 'utf8', windowsHide: true,
      });
      if (child.error) throw child.error;
      return { done: Promise.resolve({ exitCode: child.status }), collected: {
        stdout: { readFrom: () => ({ text: child.stdout }) }, stderr: { readFrom: () => ({ text: child.stderr }) },
      } };
    } };
    const probe = workerProbe(runtime, state, process.cwd(), new AbortController().signal);
    const child = 'console.log(JSON.stringify({path:process.env.PATH,inherited:process.env.DSH_PROBE_INHERITED,notifier:process.env.LARKSUITE_CLI_NO_UPDATE_NOTIFIER}))';
    const result = JSON.parse(await probe([process.execPath, '-e', child], { LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1' }));
    assert.ok(!result.path.split(delimiter).includes(shim));
    assert.equal(result.inherited, 'inherited');
    assert.equal(result.notifier, '1');
  `)
})

test('Feishu startup checks pass notifier flags in the environment without requiring POSIX env', t => {
  runPatched(t, `
    const probe = async (argv, env) => {
      assert.equal(argv[0], process.execPath);
      assert.equal(env.LARKSUITE_CLI_NO_UPDATE_NOTIFIER, '1');
      assert.equal(env.LARKSUITE_CLI_NO_SKILLS_NOTIFIER, '1');
      if (argv[1] === 'auth') return JSON.stringify({ appId:'cli_test', identities:{bot:{status:'ready'}} });
      if (argv[1] === 'config') return 'strict-mode: bot';
      return JSON.stringify({ bot:{open_id:'ou_test',app_name:'test'} });
    };
    const bot = await resolveFeishuBot({stateDir:process.cwd()}, {cli:process.execPath}, probe);
    assert.equal(bot.botId, 'ou_test');
  `)
})
