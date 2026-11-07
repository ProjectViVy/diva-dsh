/* Verify the skin manager against a running vivy-dsh shell.
 *
 * The manager straddles shell internals that DSH does not promise: the theme
 * registry's register/setTheme contract, the `settings.section` seat, the
 * inline-variable order the theme presenter writes, and the vivy stylesheet's
 * `data-dsh-skin` scoping. This script exercises the whole path — preference
 * route, panel, registry, document attribute, canvas colour, reload — against
 * the live panel, so a DSH upgrade that moves one shows up here instead of as a
 * skin that silently stops applying.
 *
 *   PANEL_URL="http://127.0.0.1:3082/?token=…" node verify-skin-manager.mjs
 *
 * Chrome must be installed; Playwright must be resolvable from this checkout.
 * Screenshots and assertions.json land in $TMPDIR/skin-manager-verify. The
 * stored preference is captured first and restored last, so the run leaves the
 * machine on the skin it found.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { request } from 'node:http'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

function resolvePlaywright() {
  const require = createRequire(import.meta.url)
  for (const name of ['playwright', 'playwright-core']) {
    try { return require(name) } catch {}
  }
  const store = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'deepseek-harness', 'node_modules', '.pnpm')
  let candidates = []
  try { candidates = readdirSync(store).filter((name) => name.startsWith('playwright@')).sort().reverse() } catch {}
  for (const candidate of candidates) {
    const entry = join(store, candidate, 'node_modules', 'playwright', 'index.mjs')
    try { return { chromium: require(entry).chromium } } catch {}
  }
  throw new Error('Playwright is not installed; run `pnpm install` in the DSH checkout first')
}

const { chromium } = resolvePlaywright()
const PLUGIN = process.env.PLUGIN ?? join(dirname(fileURLToPath(import.meta.url)))
const VIVY = process.env.VIVY_PLUGIN ?? join(PLUGIN, '..', 'dsh-vivy-studio')
const OUT = process.env.OUT ?? join(tmpdir(), 'skin-manager-verify')
const PANEL = process.env.PANEL_URL ?? process.argv[2]
if (PANEL === undefined) throw new Error('PANEL_URL is required')
mkdirSync(OUT, { recursive: true })

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail: String(detail) })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail === '' ? '' : `  — ${detail}`}`)
}

const API = '/dsh-skin-manager/api/preferences'
const ORIGIN = new URL(PANEL).origin
const API_ABSOLUTE = `${ORIGIN}${API}`

/** The registered palettes as the browser half declares them. The ported ones
    use double quotes, and so does `diva`, which is why this scans the whole
    half rather than one array: the two own-skin entries are single-quoted. */
function palettesFrom(source) {
  const entry = /id: "([^"]+)",\s*\n\s*scheme: "([^"]+)",\s*\n\s*name: "([^"]+)"/g
  const matches = [...source.matchAll(entry)]
  return matches.map((match, index) => {
    const body = source.slice(match.index, matches[index + 1]?.index ?? match.index + 6000)
    return {
      id: match[1],
      scheme: match[2],
      name: match[3],
      base: /"--dsw-alias-bg-base": "([^"]+)"/.exec(body)?.[1] ?? null,
      accent: /accent: "([^"]+)"/.exec(body)?.[1] ?? null,
    }
  })
}

/** One palette's token map, for the legibility assertions. */
function tokensFrom(source, marker) {
  const block = source.slice(source.indexOf(marker), source.indexOf('const OH_DSH_SKINS = ['))
  return Object.fromEntries([...block.matchAll(/"(--dsw-[^"]+)": "([^"]+)"/g)].map((match) => [match[1], match[2]]))
}

/** WCAG contrast between two #rrggbb colours. */
function contrast(a, b) {
  const luminance = (hex) => {
    const value = Number.parseInt(hex.trim().replace('#', ''), 16)
    const channel = (c) => {
      const x = c / 255
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel((value >> 16) & 255) + 0.7152 * channel((value >> 8) & 255) + 0.0722 * channel(value & 255)
  }
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

/** This deployment's own skins, as the browser half declares them (scheme null, no tokens). */
function ownSkinsFrom(source) {
  const block = source.slice(source.indexOf('const CATALOG = ['), source.indexOf('...OH_DSH_SKINS,'))
  const entry = /id: '([^']+)',\s*\n\s*scheme: null,\s*\n\s*name: '([^']+)'[\s\S]*?accent: '([^']+)'/g
  return [...block.matchAll(entry)].map((match) => ({ id: match[1], scheme: null, name: match[2], base: null, accent: match[3] }))
}

/** The shipped default in each half, which must agree. */
function defaultFrom(source) {
  return /const DEFAULT_SKIN_ID = '([^']+)'/.exec(source)?.[1] ?? null
}
function hostDefaultFrom(source) {
  return /DEFAULT_PREFERENCES = Object\.freeze\(\{ activeId: '([^']+)'/.exec(source)?.[1] ?? null
}

/** The host half's id list, which is deliberately duplicated there for validation. */
function hostIdsFrom(source) {
  const block = source.slice(source.indexOf('const SKIN_IDS = ['), source.indexOf('const FALLBACK_THEMES'))
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1])
}

/** The vivy palette, read from the other plugin's stylesheet. */
function vivyPalette(css) {
  const vocabulary = (block) => {
    const paper = /--vivy-paper: ([^;]+);/.exec(block)
    return paper?.[1]?.trim() ?? null
  }
  const root = css.slice(css.indexOf(':root {'), css.indexOf('html,\nbody,'))
  const darkStart = css.indexOf('body[data-ds-dark-theme] {')
  const dark = css.slice(darkStart, css.indexOf('}', darkStart))
  return { light: vocabulary(root), dark: vocabulary(dark) }
}

function toRgb(hex) {
  const value = hex.trim().replace('#', '')
  const full = value.length === 3 ? value.split('').map((digit) => digit + digit).join('') : value
  return `rgb(${Number.parseInt(full.slice(0, 2), 16)}, ${Number.parseInt(full.slice(2, 4), 16)}, ${Number.parseInt(full.slice(4, 6), 16)})`
}

const clientSource = readFileSync(join(PLUGIN, 'src', 'client.js'), 'utf8')
const hostSource = readFileSync(join(PLUGIN, 'src', 'index.mjs'), 'utf8')
/* The own skins' ids are part of the contract (the host half validates them
   too), so the run asserts the source produces them rather than reading them
   back. */
const OWN_SKINS = ownSkinsFrom(clientSource)
/* Panel order: the white palette first (it is the default), then the one
   attribute-scoped skin, then the four ported palettes. */
const REGISTERED = palettesFrom(clientSource)
const CATALOG = [REGISTERED[0], ...OWN_SKINS, ...REGISTERED.slice(1)]
const DIVA = REGISTERED[0]
const DIVA_TOKENS = tokensFrom(clientSource, 'const DIVA_SKIN = {')
/* The paper the palette actually paints. The contrast checks below are run
   against this, not against a literal, so a palette that moves its own base
   moves the measurement with it instead of quietly passing. */
const PAPER = DIVA_TOKENS['--dsw-alias-bg-base']
const VIVY_PALETTE = vivyPalette(readFileSync(join(VIVY, 'theme.css'), 'utf8'))

console.log(`catalog: ${CATALOG.map((skin) => skin.name).join(', ')}`)
console.log(`diva palette: ${Object.keys(DIVA_TOKENS).length} tokens, base ${DIVA.base}, scheme ${DIVA.scheme}`)
console.log(`vivy palette: light ${VIVY_PALETTE.light}, dark ${VIVY_PALETTE.dark}\n`)

check('catalog: diva, the own skin, then four ported palettes', CATALOG.length === 6 && CATALOG.map((skin) => skin.id).join(' ') === 'diva vivy oh-dsh-skin-deep-current oh-dsh-skin-jade-circuit oh-dsh-skin-porcelain oh-dsh-skin-ember-dusk', CATALOG.map((skin) => skin.id).join(' '))
check('catalog: host and browser halves agree on the ids', hostIdsFrom(hostSource).join(' ') === CATALOG.map((skin) => skin.id).join(' '), `${hostIdsFrom(hostSource).join(' ')} vs ${CATALOG.map((skin) => skin.id).join(' ')}`)
check('catalog: five registered palettes each carry a hex bg-base', REGISTERED.length === 5 && REGISTERED.every((skin) => /^#[0-9a-f]{6}$/i.test(skin.base ?? '')), REGISTERED.map((skin) => `${skin.id}=${skin.base}`).join(' '))
check('catalog: diva is warm paper and light by construction', DIVA.base === PAPER && DIVA.base === '#fffdfa' && DIVA.scheme === 'light', `${DIVA.base} / ${DIVA.scheme}`)
check('catalog: diva carries the coral accent', DIVA.accent === '#ff6f61', String(DIVA.accent))
check('catalog: only vivy stays attribute-scoped', OWN_SKINS.length === 1 && OWN_SKINS[0].id === 'vivy' && OWN_SKINS[0].base === null && OWN_SKINS[0].scheme === null, `${OWN_SKINS.length} own skin(s): ${OWN_SKINS.map((skin) => skin.id).join(' ')}`)
check('palette: diva paints a full token map', Object.keys(DIVA_TOKENS).length >= 100, `${Object.keys(DIVA_TOKENS).length} tokens`)
const divaLinkOnPaper = contrast(DIVA_TOKENS['--dsw-alias-link'], PAPER)
check('palette: diva link text is legible on its paper', divaLinkOnPaper >= 4.5, `${divaLinkOnPaper.toFixed(2)}:1 for ${DIVA_TOKENS['--dsw-alias-link']} on ${PAPER}`)
const divaSecondaryOnPaper = contrast(DIVA_TOKENS['--dsw-alias-label-secondary'], PAPER)
check('palette: diva secondary text is legible on its paper', divaSecondaryOnPaper >= 4.5, `${divaSecondaryOnPaper.toFixed(2)}:1 for ${DIVA_TOKENS['--dsw-alias-label-secondary']} on ${PAPER}`)
const divaInkOnPaper = contrast(DIVA_TOKENS['--dsw-alias-label-primary'], PAPER)
check('palette: diva primary ink is legible on its paper', divaInkOnPaper >= 12, `${divaInkOnPaper.toFixed(2)}:1 for ${DIVA_TOKENS['--dsw-alias-label-primary']} on ${PAPER}`)
const divaLabelOnFill = contrast('#ffffff', DIVA_TOKENS['--dsw-alias-button-primary-fill'])
check('palette: white reads on the diva primary fill', divaLabelOnFill >= 3.4, `${divaLabelOnFill.toFixed(2)}:1 on ${DIVA_TOKENS['--dsw-alias-button-primary-fill']}`)
check('default: diva is what both halves ship', defaultFrom(clientSource) === 'diva' && hostDefaultFrom(hostSource) === 'diva', `client ${defaultFrom(clientSource)} / host ${hostDefaultFrom(hostSource)}`)
check('vivy palette is readable from theme.css', VIVY_PALETTE.light === '#f4efe6' && VIVY_PALETTE.dark === '#161310', `${VIVY_PALETTE.light} / ${VIVY_PALETTE.dark}`)

/* ---------- the preference route ---------- */
async function api(method, body, headers = {}) {
  const response = await fetch(API_ABSOLUTE, {
    method,
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  })
  const text = await response.text()
  let payload = null
  try { payload = text === '' ? null : JSON.parse(text) } catch { payload = text }
  return { status: response.status, payload }
}

/** A request with a header fetch refuses to set, e.g. a forged Host. */
function rawApi(method, headers) {
  return new Promise((resolve, reject) => {
    const call = request({ host: '127.0.0.1', port: new URL(PANEL).port, path: API, method, headers }, (response) => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { text += chunk })
      response.on('end', () => resolve({ status: response.statusCode, payload: text }))
    })
    call.on('error', reject)
    call.end()
  })
}

const original = await api('GET')
check('route: GET answers a preference object', original.status === 200 && typeof original.payload?.fallbackTheme === 'string', JSON.stringify(original.payload))

const accepted = await api('PUT', { activeId: 'oh-dsh-skin-jade-circuit', fallbackTheme: 'dark' })
check('route: same-origin write is accepted', accepted.status === 200 && accepted.payload.activeId === 'oh-dsh-skin-jade-circuit', JSON.stringify(accepted.payload))
const roundTrip = await api('GET')
check('route: the write round-trips', roundTrip.payload.activeId === 'oh-dsh-skin-jade-circuit' && roundTrip.payload.fallbackTheme === 'dark', JSON.stringify(roundTrip.payload))

const crossOrigin = await api('PUT', { activeId: 'vivy', fallbackTheme: 'system' }, { origin: 'http://evil.example' })
check('route: cross-origin write is rejected', crossOrigin.status === 403, `${crossOrigin.status}`)
const noOrigin = await fetch(API_ABSOLUTE, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ activeId: 'vivy', fallbackTheme: 'system' }) })
check('route: write without Origin is rejected', noOrigin.status === 403, `${noOrigin.status}`)
const foreignHost = await rawApi('GET', { host: 'evil.example' })
check('route: foreign Host is rejected (rebinding)', foreignHost.status === 403, `${foreignHost.status}`)
const badId = await api('PUT', { activeId: 'oh-dsh-skin-nope', fallbackTheme: 'system' })
check('route: unknown skin id is rejected', badId.status === 400, `${badId.status}`)
const badFallback = await api('PUT', { activeId: 'vivy', fallbackTheme: 'chartreuse' })
check('route: unknown fallback theme is rejected', badFallback.status === 400, `${badFallback.status}`)
const wrongMethod = await api('DELETE')
check('route: only GET and PUT are served', wrongMethod.status === 405, `${wrongMethod.status}`)
const afterRejects = await api('GET')
check('route: rejected writes change nothing', afterRejects.payload.activeId === 'oh-dsh-skin-jade-circuit', JSON.stringify(afterRejects.payload))

/* ---------- the panel ---------- */
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
/* Uncaught JS and console noise are different failures, and console noise has to
   be attributed before it is blamed: another plugin in this profile answers 404
   on its own endpoint (dsh-asr's catalog), which Chrome logs as a resource error
   whose text names no URL. Record where each message came from and fail only on
   what belongs to this panel — while still reporting the rest, so nothing is
   quietly swallowed. */
const pageErrors = []
const consoleErrors = []
page.on('pageerror', (error) => pageErrors.push(String(error)))
page.on('console', (message) => {
  if (message.type() !== 'error') return
  const url = message.location()?.url ?? ''
  consoleErrors.push({ text: message.text(), url })
})
const ownConsoleErrors = () => consoleErrors.filter((entry) => entry.url === '' || entry.url.includes('dsh-skin-manager'))
const foreignConsoleErrors = () => consoleErrors.filter((entry) => !ownConsoleErrors().includes(entry))

const servedHtml = await (async () => {
  await page.goto(PANEL, { waitUntil: 'domcontentloaded' })
  return page.evaluate(() => fetch('/', { headers: { accept: 'text/html' } }).then((response) => response.text()))
})()
check('boot: the stored skin is stamped into the served document', servedHtml.includes("setAttribute('data-dsh-skin', \"oh-dsh-skin-jade-circuit\")"), servedHtml.match(/data-plugin="dsh-skin-manager">[^<]{0,90}/)?.[0] ?? 'no boot snippet')

await page.waitForTimeout(6500)
check('page: no uncaught exceptions while the manager loads', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
check('page: no console errors from this panel while it loads', ownConsoleErrors().length === 0, `${ownConsoleErrors().length} own / ${foreignConsoleErrors().length} logged by another plugin: ${foreignConsoleErrors().map((entry) => entry.url || entry.text).slice(0, 2).join(' ')}`)

async function openSkinsSection() {
  const reachable = await page.evaluate(() => {
    // The dialog's own trigger, or whatever plugin claimed the launcher seat.
    const seat = document.querySelector('[data-slot="settings.launcher"], [data-slot="sidebar.settings"]')
    const trigger = document.querySelector('button[aria-haspopup="dialog"]') ?? seat?.querySelector('button')
    if (trigger == null) return 'no settings trigger'
    trigger.click()
    return 'clicked'
  })
  if (reachable !== 'clicked') return reachable
  // A claiming launcher renders a menu that carries the settings entry.
  const viaMenu = await page.evaluate(() => {
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((candidate) => /^(设置|Settings)/.test((candidate.textContent ?? '').trim()))
    if (item === undefined) return 'no settings entry in the menu'
    item.click()
    return 'clicked'
  })
  if (viaMenu !== 'clicked') return viaMenu
  try {
    await page.waitForFunction(() => document.querySelector('[role="dialog"][aria-modal="true"]') !== null, undefined, { timeout: 8000 })
  } catch {
    return 'the settings dialog did not open'
  }
  const section = await page.evaluate(() => {
    const panel = document.querySelector('[role="dialog"][aria-modal="true"]')
    const entry = [...panel.querySelectorAll('nav button')].find((button) => (button.textContent ?? '').trim() === '皮肤')
    if (entry === undefined) return 'no 皮肤 entry'
    entry.click()
    return 'clicked'
  })
  if (section !== 'clicked') return section
  try {
    await page.waitForFunction(() => document.querySelector('.dsm-tile') !== null, undefined, { timeout: 8000 })
  } catch {
    return 'the skins section rendered no tiles'
  }
  return 'ok'
}

const reached = await openSkinsSection()
check('panel: the settings dialog opens on the skins section', reached === 'ok', reached)
const layout = await page.evaluate(() => ({
  nav: [...document.querySelectorAll('[role="dialog"] nav button')].map((button) => (button.textContent ?? '').trim()),
  tiles: [...document.querySelectorAll('.dsm-tile')].map((tile) => ({
    name: tile.getAttribute('aria-label'),
    selected: tile.dataset.selected === 'true',
    summary: (tile.querySelector('.dsm-summary')?.textContent ?? '').trim(),
  })),
  intro: (document.querySelector('.dsm-intro')?.textContent ?? '').trim(),
}))
check('panel: the skins section is a first-class settings entry', layout.nav.includes('皮肤'), layout.nav.join(' / '))
check('panel: all six skins render as tiles', layout.tiles.length === 6, layout.tiles.map((tile) => tile.name).join(', '))
check('panel: each tile describes itself', layout.tiles.every((tile) => tile.summary.length > 0), layout.tiles[0]?.summary)
check('panel: the stored skin is the selected tile', layout.tiles.filter((tile) => tile.selected).length === 1 && layout.tiles.find((tile) => tile.selected)?.name === 'Jade Circuit', layout.tiles.find((tile) => tile.selected)?.name)
await page.screenshot({ path: `${OUT}/panel.png` })

/** Read back everything one skin should have changed. */
function observe() {
  return page.evaluate(() => ({
    attribute: document.documentElement.getAttribute('data-dsh-skin'),
    darkAttribute: document.body.hasAttribute('data-ds-dark-theme'),
    inlineBase: document.body.style.getPropertyValue('--dsw-alias-bg-base').trim(),
    computedBase: getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base').trim(),
    canvas: getComputedStyle(document.body).backgroundColor,
    labelPrimary: getComputedStyle(document.body).getPropertyValue('--dsw-alias-label-primary').trim(),
    fontFamily: getComputedStyle(document.body).getPropertyValue('--dsw-font-family').trim().slice(0, 18),
    selected: [...document.querySelectorAll('.dsm-tile')].filter((tile) => tile.dataset.selected === 'true').map((tile) => tile.getAttribute('aria-label')),
    disabled: document.querySelectorAll('.dsm-tile[disabled]').length,
  }))
}

async function selectSkin(name) {
  await page.evaluate((wanted) => {
    const tile = [...document.querySelectorAll('.dsm-tile')].find((candidate) => candidate.getAttribute('aria-label') === wanted)
    tile.click()
  }, name)
  await page.waitForFunction(() => document.querySelectorAll('.dsm-tile[disabled]').length === 0, undefined, { timeout: 8000 })
  await page.waitForTimeout(220)
  return observe()
}

const observations = {}
for (const skin of CATALOG) {
  const state = await selectSkin(skin.name)
  observations[skin.name] = state
  /* Both DIVA skins share the paper, so the own skins read the same palette. */
  const expectedBase = skin.base ?? (state.darkAttribute ? VIVY_PALETTE.dark : VIVY_PALETTE.light)
  check(`switch: ${skin.name} marks the document`, state.attribute === skin.id, String(state.attribute))
  check(`switch: ${skin.name} repaints the canvas`, state.canvas === toRgb(expectedBase), `${state.canvas} vs ${toRgb(expectedBase)} from ${expectedBase}`)
  check(`switch: ${skin.name} wins over the unset tokens`, state.computedBase === expectedBase, `${state.computedBase} vs ${expectedBase}`)
  check(`switch: ${skin.name} is the only selected tile`, state.selected.length === 1 && state.selected[0] === skin.name, state.selected.join(', '))
  if (skin.base !== null) {
    check(`switch: ${skin.name} applies its tokens inline`, state.inlineBase === skin.base, `${state.inlineBase} vs ${skin.base}`)
    check(`switch: ${skin.name} forces its own scheme`, state.darkAttribute === (skin.scheme === 'dark'), `${skin.scheme} / dark=${state.darkAttribute}`)
  } else {
    check(`switch: ${skin.name} leaves the tokens to its stylesheet`, state.inlineBase === '', `inline "${state.inlineBase}"`)
    check(`switch: ${skin.name} keeps the panel font stack`, state.fontFamily.length > 0, state.fontFamily)
    const swatch = await page.evaluate((wanted) => {
      const tile = [...document.querySelectorAll('.dsm-tile')].find((candidate) => candidate.getAttribute('aria-label') === wanted)
      return getComputedStyle(tile.querySelector('.dsm-swatch')).backgroundImage
    }, skin.name)
    check(`switch: ${skin.name} swatch carries its accent`, swatch.includes(toRgb(skin.accent)) || swatch.includes(skin.accent), swatch.slice(0, 80))
  }
  const persisted = await api('GET')
  check(`persist: ${skin.name} reached the preference file`, persisted.payload.activeId === skin.id, JSON.stringify(persisted.payload))
  await page.screenshot({ path: `${OUT}/skin-${skin.id.replace(/^oh-dsh-skin-/, '')}.png` })
}

/* The load path is the strongest check: the shell must land on the stored skin
   without the panel ever being opened. */
const before = await page.evaluate(() => localStorage.getItem('dsh-skin-manager-probe'))
check('reload: probe storage is untouched', before === null, String(before))
await page.goto(PANEL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6500)
const afterReload = await observe()
const target = CATALOG[CATALOG.length - 1]
check(`reload: the stored skin (${target.name}) is still applied`, afterReload.attribute === target.id && afterReload.computedBase === target.base, `${afterReload.attribute} / ${afterReload.computedBase}`)
check('reload: the scheme attribute follows the skin', afterReload.darkAttribute === (target.scheme === 'dark'), `${target.scheme} / dark=${afterReload.darkAttribute}`)
await page.screenshot({ path: `${OUT}/after-reload.png` })

/* A preference with no skin stored: the panel must land on what it ships. */
await api('PUT', { activeId: null, fallbackTheme: 'system' })
await page.goto(PANEL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6500)
const defaultedBeforePanel = await observe()
await openSkinsSection()
const defaulted = await observe()
check('default: the document lands on diva before any panel is opened', defaultedBeforePanel.attribute === 'diva' && defaultedBeforePanel.computedBase === DIVA.base, `${defaultedBeforePanel.attribute} / ${defaultedBeforePanel.computedBase}`)
check('default: an unset preference lands on diva', defaulted.attribute === 'diva' && defaulted.computedBase === DIVA.base, `${defaulted.attribute} / ${defaulted.computedBase}`)
check('default: diva is the selected tile', defaulted.selected.join(', ') === 'diva', defaulted.selected.join(', '))
await page.screenshot({ path: `${OUT}/default.png` })

/* The white skin has to stay white: the shell preference here is "system", so
   an OS dark preference would repaint a dual-scheme skin. diva owns its scheme,
   so the shell must keep it light. */
await page.emulateMedia({ colorScheme: 'dark' })
await page.waitForTimeout(1500)
const underDarkOs = await observe()
await page.emulateMedia({ colorScheme: 'light' })
await page.waitForTimeout(600)
check('default: diva pins light even when the OS is dark', underDarkOs.attribute === 'diva' && underDarkOs.darkAttribute === false && underDarkOs.computedBase === DIVA.base, `dark=${underDarkOs.darkAttribute} / ${underDarkOs.computedBase}`)

check('page: still no uncaught exceptions after a full run', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
check('page: still no console errors from this panel', ownConsoleErrors().length === 0, `${ownConsoleErrors().length} own / ${foreignConsoleErrors().length} logged by another plugin`)

/* Leave the machine on the skin the run found. */
const restored = await api('PUT', { activeId: original.payload.activeId ?? 'vivy', fallbackTheme: original.payload.fallbackTheme })
check('cleanup: the original preference is restored', restored.status === 200, JSON.stringify(restored.payload))

await browser.close()
writeFileSync(`${OUT}/assertions.json`, `${JSON.stringify({ results, ownSkins: OWN_SKINS, defaulted, catalog: CATALOG, vivyPalette: VIVY_PALETTE, observations, original: original.payload, pageErrors, consoleErrors }, null, 2)}\n`)

const failed = results.filter((entry) => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) process.exitCode = 1
