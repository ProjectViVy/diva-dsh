// Windows compatibility for the development build only. esbuild transfers >1MiB
// transform inputs via temp files; its native process cannot remove Node-created
// files on this host. A failed temp write selects esbuild's existing pipe fallback.
// Do not change dependency sources or the project's external temporary directory.
if (process.platform === 'win32') {
  const fs = require('node:fs')
  const path = require('node:path')
  const os = require('node:os')
  const temp = path.resolve(os.tmpdir()).toLowerCase()
  const isEsbuildTransfer = file => typeof file === 'string'
    && path.resolve(path.dirname(file)).toLowerCase() === temp
    && /^esbuild-[a-f0-9]{64}$/.test(path.basename(file))
  const pipeFallback = () => Object.assign(new Error('Use esbuild pipe transport on Windows'), { code: 'EACCES' })
  const writeFile = fs.writeFile
  const writeFileSync = fs.writeFileSync
  fs.writeFile = function (file, ...args) {
    if (isEsbuildTransfer(file)) {
      process.nextTick(args.at(-1), pipeFallback())
      return
    }
    return writeFile.call(this, file, ...args)
  }
  fs.writeFileSync = function (file, ...args) {
    if (isEsbuildTransfer(file)) throw pipeFallback()
    return writeFileSync.call(this, file, ...args)
  }
}
