#!/usr/bin/env node
// Project-local entry point for the upstream web development loop.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, PROFILE, processes } from './lib/vivy.mjs'
import { localEnvironment, prepareLocalDirectories, sourceRuntimeInvocation } from './lib/source.mjs'
import { resolveProxy, serviceEnvironment } from './lib/proxy.mjs'

const args = process.argv.slice(2)

if (args.includes('--help')) {
  console.log(`DSH 开发服务器使用教程

在项目根目录打开终端后执行：
  npm run setup           首次安装依赖和配置（已安装可跳过）
  npm run stop            已有后台服务时先停止
  just dev                构建、监听并启动开发服务器
  just dev --skip-build   已有构建产物时跳过首次构建

保持终端打开，面板地址以启动输出为准；按 Ctrl+C 停止。
使用项目内 DSH_HOME 和 ${PROFILE} profile，无需全局 pnpm。
本地插件需要各自构建；监听期间不要同时执行 setup 或另一轮构建。

更多用法：
  just                    显示本教程
  just dev --help         显示本教程
  just dev --poll=1000    调整源码轮询间隔（毫秒）
  node scripts/dev.mjs    直接启动，无需 just
其他参数转交 DSH。`)
} else {
  try {
    const harness = join(ROOT, 'deepseek-harness')
    const pnpm = join(ROOT, '.artifacts', 'tools', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
    if (!existsSync(pnpm) || !existsSync(join(harness, 'node_modules', 'tsx'))) {
      throw new Error('Development dependencies are missing; run npm run setup first.')
    }
    if (processes().length > 0) {
      throw new Error('The background service is running; run npm run stop before just dev.')
    }
    prepareLocalDirectories(ROOT)
    const env = localEnvironment(ROOT)
    const proxy = resolveProxy({ root: ROOT, env })
    const childEnv = serviceEnvironment(ROOT, env, proxy)
    if (process.platform === 'win32') {
      const preload = join(ROOT, 'scripts', 'lib', 'esbuild-pipe.cjs')
      childEnv.NODE_OPTIONS = [childEnv.NODE_OPTIONS, `--require ${JSON.stringify(preload)}`].filter(Boolean).join(' ')
    }
    if (!args.includes('--skip-build')) {
      const build = spawnSync(process.execPath, [pnpm, 'run', 'build:artifacts'], {
        cwd: harness, env: childEnv, stdio: 'inherit',
      })
      if (build.error) throw build.error
      if (build.status !== 0) process.exit(build.status ?? 1)
    }
    const runtime = sourceRuntimeInvocation(ROOT, ['--profile', PROFILE, ...args.filter(arg =>
      arg !== '--skip-build' && arg !== '--poll' && !arg.startsWith('--poll='))])
    const children = []
    let stopping = false
    const stop = (code) => {
      if (stopping) return
      stopping = true
      process.exitCode = code
      for (const child of children) {
        if (!child.pid) continue
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
        } else {
          try { process.kill(-child.pid, 'SIGTERM') } catch { /* already exited */ }
        }
      }
    }
    process.on('SIGINT', () => stop(130))
    process.on('SIGTERM', () => stop(0))
    const launch = (argv, cwd, environment) => {
      const child = spawn(process.execPath, argv, {
        cwd, env: environment, stdio: 'inherit', detached: process.platform !== 'win32',
      })
      children.push(child)
      child.on('error', error => { console.error(error.message); stop(1) })
      child.on('exit', code => stop(code ?? 1))
    }
    // Upstream's serving stage hardcodes the web profile; use only its watchers.
    launch([pnpm, 'run', 'dev:web', '--skip-build', '--no-serve', ...args.filter(arg =>
      arg === '--poll' || arg.startsWith('--poll='))], harness, childEnv)
    launch(runtime.args, runtime.cwd, { ...runtime.env, ...childEnv })
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
