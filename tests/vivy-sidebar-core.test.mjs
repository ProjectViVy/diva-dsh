import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const plugin = join(root, 'plugins/dsh-vivy-studio')

/* The document the plugin would serve, built by running index.js itself — the
   same way verify-skin.mjs builds it, so both measure the file on disk. */
let transform
const { apply } = await import(pathToFileURL(join(plugin, 'index.js')).href)
apply({ effect: (fn) => fn(), webServer: { tapIndex: (fn) => { transform = fn; return () => {} } } })
const served = transform('<!doctype html><html lang="zh-CN"><head><title>DeepSeek Harness</title></head><body><div id="root"></div></body></html>')

const script = /<script data-plugin="dsh-vivy-studio">([\s\S]*?)<\/script>/.exec(served)[1]

test('the served script carries both the identity and the group enhancement', () => {
  assert.ok(script.includes('window.__VIVY_PRODUCT__'), 'brand.js is not in the served script')
  assert.ok(script.includes('dsh.vivy.sidebar.core.v1'), 'sidebar-core.js is not in the served script')
  // One tag each: verify-skin.mjs reads back the first match of this pattern.
  assert.equal((served.match(/<script data-plugin="dsh-vivy-studio">/g) ?? []).length, 1)
  assert.ok(!script.includes('</script'), 'the script would close its own tag')
})

/* Two parenthesised IIFEs with nothing but a newline between them are one
   expression: the second is parsed as the first's argument list, never invoked,
   and the script dies on "is not a function". */
test('each enhancement is its own statement in the served script', () => {
  assert.doesNotMatch(script, /\)\s*\n\s*\(\(\) =>/, 'IIFEs joined without a terminator do not both run')
  assert.match(script, /;\n\(\(\) =>/, 'expected a statement terminator before the next IIFE')
})

test('the group ships inside the package', () => {
  const manifest = JSON.parse(readFileSync(join(plugin, 'package.json'), 'utf8'))
  assert.ok(manifest.files.includes('sidebar-core.js'), 'package.json would not publish sidebar-core.js')
})

test('the group names its members off the label, not off a position', () => {
  const source = readFileSync(join(plugin, 'sidebar-core.js'), 'utf8')
  assert.ok(source.includes('VIVY心核'), 'the group caption is not the product name')
  // Member count moves with what is installed and pinned, so nothing may pin a
  // number, and the resident rows are told apart by their accessible name.
  assert.match(source, /aria-label/)
  assert.match(source, /插件/)
  assert.match(source, /自动化任务/)
  assert.match(source, /更多/)
  assert.doesNotMatch(source, /panelRow\)?\s*\.\s*(slice|at)\(\s*[1-9]/, 'members must not be a fixed slice of the list')
  // Rail is measured on the nav: a member of a shut group measures 0px.
  assert.match(source, /getBoundingClientRect\(\)\.width/)
})

/* The header goes before the first member, so the position test has to read the
   next sibling. Comparing previousSibling is never true, and re-inserting a node
   that is already in place still emits remove+insert records — the nav observer
   then re-enters on its own edit forever, freezing the page. */
test('the header settles instead of re-inserting itself', () => {
  const source = readFileSync(join(plugin, 'sidebar-core.js'), 'utf8')
  assert.match(source, /nextSibling\s*!==\s*members\[0\]/, 'the position test must read the next sibling')
  assert.doesNotMatch(source, /\.previousSibling/, 'a previousSibling comparison re-inserts on every pass')
})

/* Inside the header the row reads the way a panel row does: glyph, caption, then
   the disclosure at the far edge. That order is what makes it a peer of 插件 and
   自动化任务 instead of a title sitting above them. */
test('the header is drawn glyph, caption, disclosure', () => {
  const source = readFileSync(join(plugin, 'sidebar-core.js'), 'utf8')
  assert.match(source, /head\.append\(heart\(\), label, chevron\(\)\)/, 'the header children are out of reading order')
  assert.match(source, /"diva-core-heart"/, 'the group lost its heart')
  assert.match(source, /"diva-core-chevron"/, 'the group lost its disclosure')
})

/* Panel rows are sorted by a per-plugin `order`, and SurfCore, Superagent and
   自动化任务 all register at 10 — so the later registration renders below the
   first two, and a header placed before the first member would file 自动化任务
   behind the group instead of beside 插件. */
test('a resident row the shell filed behind the group comes back in front of it', () => {
  const source = readFileSync(join(plugin, 'sidebar-core.js'), 'utf8')
  assert.match(source, /compareDocumentPosition\(node\)/, 'the stray test must compare document position')
  assert.match(source, /if \(!follows\(row, built\)\) continue/, 'the stray test must run per resident row')
  assert.match(source, /nav\.insertBefore\(row, built\)/, 'a stray resident row is never moved back')
  // The More launcher closes the list; pulling it in front of the group would
  // put the launcher above the group it is meant to follow.
  assert.match(source, /TAIL/, 'the More launcher must be exempt from the move')
})
