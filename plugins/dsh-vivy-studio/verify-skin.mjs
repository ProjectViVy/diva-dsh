/* Verify the DIVA skin against a running vivy-dsh shell.
 *
 * The skin hangs off shell internals that DSH does not promise: module class
 * prefixes, the hero markup, the sidebar's local-build identity and the boot
 * title. This script checks every one of those hooks against the live panel, so
 * a DSH upgrade that moves one shows up here instead of as a half-styled shell.
 *
 *   PANEL_URL="http://127.0.0.1:3082/?token=…" node verify-skin.mjs
 *
 * The token is the one `dsh web` prints at boot (and the launcher logs). Chrome
 * must be installed; Playwright must be resolvable from this checkout.
 * Screenshots and assertions.json land in $TMPDIR/diva-skin-verify.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

function resolvePlaywright() {
  const require = createRequire(import.meta.url)
  for (const name of ['playwright', 'playwright-core']) {
    try { return require(name) } catch {}
  }
  // The harness keeps Playwright in its pnpm store rather than at its root.
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
const OUT = process.env.OUT ?? join(tmpdir(), 'diva-skin-verify')
const URL = process.env.PANEL_URL ?? process.argv[2]
if (URL === undefined) throw new Error('PANEL_URL is required')

/* Build the exact snippet index.js would inject, by running index.js itself. */
const { apply } = await import(`${PLUGIN}/index.js`)
let transform
apply({ effect: (fn) => fn(), webServer: { tapIndex: (fn) => { transform = fn; return () => {} } } })
const served = transform('<!doctype html><html lang="zh-CN"><head><title>DeepSeek Harness</title></head><body><div id="root"></div></body></html>')
const injectedCss = /<style data-plugin="dsh-vivy-studio">([\s\S]*?)<\/style>/.exec(served)[1]
const injectedJs = /<script data-plugin="dsh-vivy-studio">([\s\S]*?)<\/script>/.exec(served)[1]

/* The skin manager, when installed, owns the palette: it writes the stored
 * skin's tokens inline on body and patrols the document, which would overlay
 * every value measured below and undo the attributes the scoping checks set by
 * hand. Park it — so the served document starts on the own skin — and block its
 * client bundle for the run, leaving the skin itself under test. The two
 * plugins together are covered by the manager's own verification.
 */
const MANAGER_ORIGIN = new globalThis.URL(URL).origin
const MANAGER_API = `${MANAGER_ORIGIN}/dsh-skin-manager/api/preferences`
async function skinManager(method, body) {
  const response = await fetch(MANAGER_API, {
    method,
    headers: { 'content-type': 'application/json', origin: MANAGER_ORIGIN },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return response.ok ? response.json() : null
}
const managerBefore = await skinManager('GET').catch(() => null)
/* `system` (not the stored fallback) so the emulated colour scheme below governs the palette. */
const managerParked = managerBefore === null ? null : await skinManager('PUT', { activeId: 'vivy', fallbackTheme: 'system' })

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const pageErrors = []
page.on('pageerror', (error) => { pageErrors.push(String(error)) })
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
await page.waitForTimeout(4000)

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail === '' ? '' : `  — ${detail}`}`)
}

check('skin manager: parked', managerBefore === null || managerParked?.activeId === 'vivy', managerBefore === null ? 'not installed' : JSON.stringify(managerParked))
check('skin manager: parked with no inline palette', await page.evaluate(() => document.body.style.getPropertyValue('--dsw-alias-bg-base').trim() === '' && document.documentElement.getAttribute('data-dsh-skin') === 'vivy'))

const probe = () => page.evaluate(() => {
  const css = (selector, pseudo = null) => {
    const el = document.querySelector(selector)
    return el === null ? null : getComputedStyle(el, pseudo)
  }
  const brand = document.querySelector('[class*="brandIdentity"]')
  return {
    title: document.title,
    bgBase: getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base').trim(),
    brand: getComputedStyle(document.body).getPropertyValue('--dsw-alias-brand-primary').trim(),
    dark: document.body.hasAttribute('data-ds-dark-theme'),
    brandIdentityHeight: brand === null ? null : Math.round(brand.getBoundingClientRect().height),
    brandMarkHeight: document.querySelector('[class*="brandMark"]') === null ? null : Math.round(document.querySelector('[class*="brandMark"]').getBoundingClientRect().height),
    brandTitleHeight: document.querySelector('[class*="localBuildTitle"]') === null ? null : Math.round(document.querySelector('[class*="localBuildTitle"]').getBoundingClientRect().height),
    titleAfter: css('[class*="localBuildTitle"]', '::after')?.content ?? null,
    titleFontSize: css('[class*="localBuildTitle"]')?.fontSize ?? null,
    titleTextTransform: css('[class*="localBuildTitle"]', '::after')?.textTransform ?? null,
    versionText: document.querySelector('[class*="buildVersion"]')?.textContent ?? null,
    versionDisplay: css('[class*="localBuildBrand"] [class*="buildVersion"]')?.display ?? null,
    brandMarkGem: (css('[class*="brandMark"]', '::before')?.backgroundImage ?? '').slice(0, 40),
    railGem: css('[class*="railMark"]', '::before')?.backgroundImage ?? '',
    fishDisplay: css('svg[viewBox="0 0 23.16 17.04"]')?.display ?? null,
    heroFishDisplay: css('[data-slot="conversation.hero.brand.mark"] svg')?.display ?? null,
    sloganAfter: css('[class*="headline"] > [class*="titleGroup"] > span:not([class*="previewBadge"])', '::after')?.content ?? null,
    sloganFontSize: css('[class*="headline"] > [class*="titleGroup"] > span:not([class*="previewBadge"])')?.fontSize ?? null,
    badgeAfter: css('[class*="previewBadge"]', '::after')?.content ?? null,
    heroBg: css('[class*="headline"]')?.color ?? null,
  }
})

const native = await probe()
await page.screenshot({ path: `${OUT}/01-native.png`, fullPage: true })

/* The running service may already have hot-loaded an older revision of this
   plugin (DSH's plugin-manager reconciles a changed profile manifest), and
   theme.css is read once per apply. Report that, then measure the file on disk
   by dropping the stale sheet before injecting the final one. */
const staleCheck = await page.evaluate(() => document.querySelectorAll('style[data-plugin="dsh-vivy-studio"], script[data-plugin="dsh-vivy-studio"]').length)
const servedHtml = await (await page.request.get(URL)).text()
const servedCss = /<style data-plugin="dsh-vivy-studio">([\s\S]*?)<\/style>/.exec(servedHtml)?.[1] ?? null
const servedJs = /<script data-plugin="dsh-vivy-studio">([\s\S]*?)<\/script>/.exec(servedHtml)?.[1] ?? null
console.log(`note: live sheet(s) already on the page: ${staleCheck}`)
console.log(`note: served css ${servedCss === null ? 'absent' : servedCss === injectedCss ? 'matches the file' : 'differs from the file (older revision in the running process)'}`)
await page.evaluate(() => {
  for (const el of document.querySelectorAll('style[data-plugin="dsh-vivy-studio"], script[data-plugin="dsh-vivy-studio"]')) el.remove()
})

/* The shell itself, now that nothing of this plugin is on the page: the only
   honest baseline for "did the chip removal move anything". The served sheet
   cannot serve as one — once the running process has been restarted onto this
   revision it already hides the chip. */
const bare = await probe()

/* Inject exactly as the plugin does: style + script at the top of <body>. */
await page.evaluate(([css, js]) => {
  const style = document.createElement('style')
  style.setAttribute('data-plugin', 'dsh-vivy-studio')
  style.textContent = css
  document.body.appendChild(style)
  const script = document.createElement('script')
  script.setAttribute('data-plugin', 'dsh-vivy-studio')
  script.textContent = js
  document.body.appendChild(script)
}, [injectedCss, injectedJs])
await page.waitForTimeout(1200)

const light = await probe()

check('palette: paper background', light.bgBase === '#f4efe6', light.bgBase)
check('palette: fluorite brand', light.brand === '#2aa8a4', light.brand)
check('wordmark: sidebar name reads DIVA', light.titleAfter === '"DIVA"', String(light.titleAfter))
check('wordmark: native name text is hidden', light.titleFontSize === '0px', String(light.titleFontSize))
check('wordmark: wide-tracked caps', light.titleTextTransform === 'uppercase', String(light.titleTextTransform))
check('wordmark: the build version chip is not rendered', light.versionDisplay === 'none' && (light.versionText ?? '').length > 0, `${light.versionDisplay} / ${light.versionText}`)
check('mark: sidebar gem replaced the fish', light.brandMarkGem.includes('data:image/svg+xml'), light.brandMarkGem)
check('mark: fish glyph hidden', light.fishDisplay === 'none' && light.heroFishDisplay === 'none', `${light.fishDisplay}/${light.heroFishDisplay}`)
check('hero: slogan reads 寻找真心之旅', light.sloganAfter === '"寻找真心之旅"', String(light.sloganAfter))
check('hero: native slogan hidden', light.sloganFontSize === '0px', String(light.sloganFontSize))
check('hero: preview badge relettered', light.badgeAfter === '"STUDIO"', String(light.badgeAfter))
/* Dropping the chip costs no layout: the shell fixes the identity row (and the
   row below it) at 24px, so hiding the chip leaves the geometry alone and the
   wordmark grows into the slot the chip vacated — its line box becomes the
   row's own height and the glyphs centre inside it. Both halves are measured
   against the plugin-free shell, because "the row got shorter" is the obvious
   guess and it is wrong. */
check('layout: brand row keeps its height without the chip', light.brandIdentityHeight === bare.brandIdentityHeight, `${bare.brandIdentityHeight} -> ${light.brandIdentityHeight}`)
check('layout: the wordmark fills the row the chip vacated', light.brandTitleHeight === light.brandIdentityHeight, `title ${light.brandTitleHeight}px in a ${light.brandIdentityHeight}px row (shell title ${bare.brandTitleHeight}px, beside the chip)`)
/* The gem is a 19px square where the whale glyph filled 23.16x17.04; the fixed
   24px row centres whichever mark is in it, so the two boxes differ and the row
   height above is what proves nothing moved. */
check('layout: the gem replaces the whale box inside the row', bare.brandMarkHeight !== null && light.brandMarkHeight !== null && bare.brandMarkHeight !== light.brandMarkHeight && light.brandIdentityHeight === 24, `${bare.brandMarkHeight} -> ${light.brandMarkHeight} in a ${light.brandIdentityHeight}px row`)

/* Tab title: the shell rewrites it per session, in the interface language. */
const titleCases = []
for (const candidate of ['某个会话 — DSH 本地构建', 'DSH Local Build', 'DeepSeek Harness', '会话 — DIVA']) {
  await page.evaluate((value) => { document.title = value }, candidate)
  await page.waitForTimeout(300)
  titleCases.push([candidate, await page.title()])
}
for (const [from, to] of titleCases) {
  const expected = from.includes('DIVA') ? from : from.replace(/DSH 本地构建|DSH Local Build|DeepSeek Harness/, 'DIVA')
  check(`title: "${from}"`, to === expected, `-> "${to}"`)
}

await page.screenshot({ path: `${OUT}/02-diva-light.png`, fullPage: true })

/* The injected sheet must survive the browser's own parser. */
const sheet = await page.evaluate(() => {
  const style = document.querySelector('style[data-plugin="dsh-vivy-studio"]')
  const list = [...document.styleSheets].find((candidate) => candidate.ownerNode === style)
  const selectors = list === undefined ? [] : [...list.cssRules].map((rule) => rule.selectorText ?? rule.cssText.slice(0, 24))
  const wanted = [
    'svg[viewBox="0 0 182 24"]',
    '[class*="railMark"]::before',
    '[class*="brandMark"]::before',
    '[class*="localBuildTitle"]',
    '[class*="fishHitbox"]',
    '[class*="headline"] > [class*="titleGroup"]',
    'h2[class*="title"]',
    ':has([class*="copy"] p)',
    '[class*="copy"] p:first-of-type::after',
    '[data-chat-running]',
  ]
  const lower = selectors.map((value) => value.toLowerCase())
  return { count: selectors.length, missing: wanted.filter((needle) => !lower.some((value) => value.includes(needle.toLowerCase()))) }
})
check('stylesheet parsed by the browser', sheet.count > 0, `${sheet.count} rules`)
check('every live rule reached the sheet', sheet.missing.length === 0, sheet.missing.join(', '))

/* The VIVY心核 group. sidebar-core.js enhances the nav React owns, and which rows
   end up in it moves with what is installed and pinned, so every count below is
   read off the page. The run starts from a known state rather than from
   whatever a previous session left in storage. */
const CORE_KEY = 'dsh.vivy.sidebar.core.v1'
const coreProbe = () => page.evaluate((key) => {
  const nav = document.querySelector('nav[class*="panelList"]')
  const heads = [...document.querySelectorAll('.diva-core-head')]
  const head = heads[0] ?? null
  const KEEP = /^(插件|plugins|自动化任务|automation( tasks)?|相遇|更多|more)$/i
  const name = (el) => (el.getAttribute('aria-label') || '').trim()
  const rows = nav === null ? [] : [...nav.querySelectorAll(':scope > button')].filter((el) => el.className.includes('panelRow'))
  const members = nav === null ? [] : [...nav.querySelectorAll(':scope > .diva-core-row')]
  const resident = rows.filter((row) => KEEP.test(name(row)))
  const shown = (el) => el !== null && getComputedStyle(el).display !== 'none'
  const box = (el) => el === null ? null : el.getBoundingClientRect()
  const headBox = box(head)
  const rowBox = box(rows[0] ?? null)
  const heart = head === null ? null : head.querySelector('.diva-core-heart')
  const chevron = head === null ? null : head.querySelector('.diva-core-chevron')
  const label = head === null ? null : head.querySelector('.diva-core-label')
  const member = members[0] ?? null
  const memberStyle = member === null ? null : getComputedStyle(member)
  return {
    headCount: heads.length,
    label: head === null ? null : head.textContent.trim(),
    expanded: head?.getAttribute('aria-expanded') ?? null,
    headDisplay: head === null ? null : getComputedStyle(head).display,
    rail: nav?.dataset.divaRail ?? null,
    state: nav?.dataset.divaCore ?? null,
    rows: rows.length,
    members: members.length,
    resident: resident.length,
    residentLabels: resident.map(name),
    memberLabels: members.map(name),
    residentMarked: members.filter((row) => KEEP.test(name(row))).length,
    headAboveMembers: head !== null && members.length > 0 && head.nextElementSibling === members[0],
    /* The shell files 自动化任务 at the same `order` as two of the members, and
       renders it after them; the script moves it back in front. Every resident
       row therefore precedes the header. */
    residentsAboveHead: head !== null && resident.every((row) => (head.compareDocumentPosition(row) & 4) === 0),
    /* Peer, not caption: the same box the shell gives a panel row. */
    headHeight: headBox === null ? null : Math.round(headBox.height),
    rowHeight: rowBox === null ? null : Math.round(rowBox.height),
    headPad: head === null ? null : getComputedStyle(head).padding,
    rowPad: rows[0] === undefined ? null : getComputedStyle(rows[0]).padding,
    /* The caption reads glyph, caption, disclosure — and the disclosure is the
       last child, at the row's trailing edge. */
    headChildren: head === null ? null : [...head.children].map((el) => el.className?.baseVal ?? el.className),
    heartW: heart === null ? null : Math.round(heart.getBoundingClientRect().width),
    chevronW: chevron === null ? null : Math.round(chevron.getBoundingClientRect().width),
    chevronRightGap: (chevron === null || headBox === null) ? null : Math.round(headBox.right - chevron.getBoundingClientRect().right),
    heartLeftGap: (heart === null || headBox === null) ? null : Math.round(heart.getBoundingClientRect().left - headBox.left),
    labelBetween: (heart === null || chevron === null || label === null) ? null
      : heart.getBoundingClientRect().right <= label.getBoundingClientRect().left
      && label.getBoundingClientRect().right <= chevron.getBoundingClientRect().left,
    memberDisplay: member === null ? null : memberStyle.display,
    memberIndent: member === null ? null : memberStyle.paddingLeft,
    memberWidth: member === null ? null : Math.round(member.getBoundingClientRect().width),
    memberGlyph: member === null ? null : Math.round(member.querySelector('svg')?.getBoundingClientRect().width ?? 0),
    /* Nothing is drawn down the members' left edge any more: the indent alone
       says who they hang under. */
    memberShadow: member === null ? null : memberStyle.boxShadow,
    memberBorderLeft: member === null ? null : memberStyle.borderLeftWidth,
    residentShown: resident.every(shown),
    stored: localStorage.getItem(key),
  }
}, CORE_KEY)
const coreReset = async (value) => {
  await page.evaluate(([key, state]) => {
    localStorage.setItem(key, state)
    // The script syncs on a DOM mutation, and storage changes are not one.
    const poke = document.createElement('div')
    document.body.append(poke)
    poke.remove()
  }, [CORE_KEY, value])
  await page.waitForTimeout(400)
}
await coreReset('expanded')
const core = await coreProbe()
check('core: one header, reading VIVY心核', core.headCount === 1 && core.label === 'VIVY心核', `${core.headCount} header(s) labelled ${core.label}`)
check('core: the header sits directly above its members', core.headAboveMembers && core.expanded === 'true' && core.state === 'expanded', `above ${core.headAboveMembers} / aria-expanded ${core.expanded}`)
check('core: membership is the panel list minus the resident rows', core.members > 0 && core.members === core.rows - core.resident && core.residentMarked === 0, `${core.members} of ${core.rows} rows, ${core.residentMarked} resident marked`)
check('core: the resident rows are the ones expected', core.residentLabels.length >= 2 && core.residentLabels.every((label) => /插件|plugins|自动化|automation|相遇|更多|more/i.test(label)), core.residentLabels.join(', '))
/* 自动化任务 shares its registration order with two of the members and renders
   after them; the group must not be allowed to land between it and 插件. */
check('core: every resident row sits above the group', core.residentsAboveHead, `${core.residentLabels.join(', ')} above ${core.residentsAboveHead}`)
check('core: the header is a panel row, not a caption', core.headHeight === core.rowHeight && core.headPad === core.rowPad && core.headHeight >= 32, `${core.headHeight}px vs ${core.rowHeight}px row, pad ${core.headPad} vs ${core.rowPad}`)
check('core: the header reads heart, caption, disclosure — right —', core.headChildren?.length === 3 && /heart/.test(core.headChildren[0]) && /label/.test(core.headChildren[1]) && /chevron/.test(core.headChildren[2]) && core.labelBetween === true, (core.headChildren ?? []).join(' / '))
check('core: the two glyphs frame the caption at the row\'s edges', core.heartW === 16 && core.chevronW === 16 && core.heartLeftGap === 8 && core.chevronRightGap === 8, `heart ${core.heartW}px at +${core.heartLeftGap}, chevron ${core.chevronW}px at -${core.chevronRightGap}`)
check('core: wide members are indented under the row', core.memberIndent === '22px' && core.memberWidth > 100, `${core.memberIndent} in a ${core.memberWidth}px row`)
check('core: nothing is drawn down the members\' left edge', core.memberShadow === 'none' && core.memberBorderLeft === '0px', `${core.memberShadow} / border-left ${core.memberBorderLeft}`)
await page.screenshot({ path: `${OUT}/core-open.png`, fullPage: true })

await page.locator('.diva-core-head').click()
await page.waitForTimeout(300)
const shut = await coreProbe()
check('core: shutting the group hides its members and says so', shut.expanded === 'false' && shut.memberDisplay === 'none' && shut.stored === 'collapsed', `aria-expanded ${shut.expanded} / display ${shut.memberDisplay} / stored ${shut.stored}`)
check('core: the resident rows stay outside the group', shut.residentShown && shut.resident === core.resident, `${shut.residentLabels.join(', ')} visible ${shut.residentShown}`)
await page.screenshot({ path: `${OUT}/core-shut.png`, fullPage: true })

await page.locator('.diva-core-head').click()
await page.waitForTimeout(300)
const reopened = await coreProbe()
check('core: opening it again brings the members back', reopened.expanded === 'true' && reopened.memberDisplay !== 'none' && reopened.stored === 'expanded', `aria-expanded ${reopened.expanded} / display ${reopened.memberDisplay} / stored ${reopened.stored}`)

/* Collapsed rail: click the toggle and re-probe. */
await page.locator('button[class*="toggle"]').first().click({ force: true })
await page.waitForTimeout(1500)
const collapsed = await probe()
check('rail: gem replaces the fish when collapsed', collapsed.railGem.includes('data:image/svg+xml'), collapsed.railGem)
const coreRail = await coreProbe()
check('rail: the group header steps out, the members stay', coreRail.rail === 'true' && coreRail.headDisplay === 'none' && coreRail.memberDisplay !== 'none', `rail ${coreRail.rail} / header ${coreRail.headDisplay} / members ${coreRail.memberDisplay}`)
check('rail: members keep the rail geometry the shell gives them', coreRail.memberWidth === 36 && coreRail.memberIndent === '0px' && coreRail.memberGlyph > 0, `${coreRail.memberWidth}px row, ${coreRail.memberIndent} indent, ${coreRail.memberGlyph}px glyph`)
await page.screenshot({ path: `${OUT}/03-diva-rail.png`, fullPage: true })

/* Dark scheme. */
await page.emulateMedia({ colorScheme: 'dark' })
await page.waitForTimeout(1500)
const dark = await probe()
check('dark: night-ink background', dark.bgBase === '#161310', dark.bgBase)
check('dark: lighter fluorite accent', dark.brand === '#5fd4cf', dark.brand)
check('dark: gem pair swapped', dark.railGem.includes('5fd4cf'), dark.railGem)
await page.screenshot({ path: `${OUT}/04-diva-dark.png`, fullPage: true })

/* Welcome copy: the notice is already acknowledged in this profile, so the
   rule is exercised against the markup WelcomeNotice/OnboardingModal render. */
await page.emulateMedia({ colorScheme: 'light' })
const copy = await page.evaluate(() => {
  // welcome-notice shape: .dialog > .content > h2.title + .body > div.copy > p
  const notice = document.createElement('div')
  notice.className = '_dialog_probe'
  notice.innerHTML = '<div class="_content_probe"><h2 class="_title_probe">DSH 本地构建</h2>'
    + '<div class="_body_probe"><div class="_copy_probe"><p>本机构建</p><p>第二段</p></div></div></div>'
  // an ordinary modal: same dialog/title classes, no notice copy
  const other = document.createElement('div')
  other.className = '_dialog_probe'
  other.innerHTML = '<div class="_content_probe"><h2 class="_title_probe">用量统计</h2>'
    + '<div class="_body_probe"><span class="_turnErrorCopy_probe">本轮失败</span><p>普通说明</p></div></div>'
  document.body.append(notice, other)
  const heading = getComputedStyle(notice.querySelector('h2'), '::after')
  const paragraph = getComputedStyle(notice.querySelector('[class*="copy"] p'), '::after')
  const second = getComputedStyle(notice.querySelector('[class*="copy"] p + p'))
  const otherHeading = getComputedStyle(other.querySelector('h2'), '::after')
  const otherHeadingSize = getComputedStyle(other.querySelector('h2')).fontSize
  const otherParagraphSize = getComputedStyle(other.querySelector('p')).fontSize
  const out = {
    heading: heading.content,
    headingFont: heading.fontStyle,
    paragraph: paragraph.content,
    secondDisplay: second.display,
    otherHeading: otherHeading.content,
    otherHeadingSize,
    otherParagraphSize,
  }
  notice.remove()
  other.remove()
  return out
})
check('welcome: dialog title reads DIVA', copy.heading === '"DIVA"', String(copy.heading))
check('welcome: copy describes this workbench', (copy.paragraph ?? '').includes('DIVA 是这个工作台的名字'), String(copy.paragraph).slice(0, 64))
check('welcome: extra paragraph still hidden', copy.secondDisplay === 'none', copy.secondDisplay)
check('scope: another modal keeps its title', copy.otherHeading === 'none' && copy.otherHeadingSize !== '0px', `${copy.otherHeading}/${copy.otherHeadingSize}`)
check('scope: another modal keeps its text', copy.otherParagraphSize !== '0px', copy.otherParagraphSize)

/* Palette scoping: the 112 tokens apply only while this skin is selected (or
   while no skin manager is present), because the manager layers another skin's
   tokens on top as inline variables. The --vivy-* vocabulary is not scoped, so
   the brand lockup and gem keep working under any skin — including in dark. */
const stateAt = async (skin, dark) => {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
  await page.waitForTimeout(200)
  return page.evaluate((value) => {
    const root = document.documentElement
    if (value === null) delete root.dataset.dshSkin
    else root.dataset.dshSkin = value
    const body = getComputedStyle(document.body)
    return {
      base: body.getPropertyValue('--dsw-alias-bg-base').trim(),
      paper: body.getPropertyValue('--vivy-paper').trim(),
      fluorite: body.getPropertyValue('--vivy-fluorite').trim(),
      hot: body.getPropertyValue('--vivy-fluorite-hot').trim(),
      haze: body.getPropertyValue('--vivy-haze').trim(),
      mark: body.getPropertyValue('--vivy-mark').trim(),
      sans: body.getPropertyValue('--dsw-font-family').trim().slice(0, 20),
    }
  }, skin)
}
const unselected = await stateAt(null, false)
const selected = await stateAt('vivy', false)
const divaSheet = await stateAt('diva', false)
const foreignLight = await stateAt('oh-dsh-skin-porcelain', false)
const foreignDark = await stateAt('oh-dsh-skin-porcelain', true)
const standaloneDark = await stateAt(null, true)

check('scoping: skin applies with no manager', unselected.base === '#f4efe6', unselected.base)
check('scoping: skin applies when selected', selected.base === '#f4efe6', selected.base)
check('scoping: another skin suppresses the palette', foreignLight.base !== '#f4efe6' && foreignLight.base !== '', foreignLight.base)
check('scoping: vocabulary survives another skin', foreignLight.fluorite === '#2aa8a4', foreignLight.fluorite)
check('scoping: vocabulary follows dark under another skin', foreignDark.fluorite === '#5fd4cf', foreignDark.fluorite)
check('scoping: dark palette returns standalone', standaloneDark.base === '#161310', standaloneDark.base)
check('scoping: font stack is skin-owned in every state', [unselected, selected, divaSheet, foreignLight].every((state) => state.sans.length > 0), unselected.sans)

/* diva — the white, hand-written skin.

   Its palette is registered by dsh-skin-manager and arrives as inline body
   variables, so this sheet no longer paints a single surface for it: what is
   left here is the gradient layer, the hand-written display face and the main
   title, and that is what these checks measure. They read the stylesheet on
   disk (injected above), so they hold even before the running process has been
   restarted onto it.

   Two numbers the design makes explicit. The bright gradient runs 2.19-2.94:1
   against white, below AA even for large text, so it is only ever decoration —
   the mark, the wordmark, the badge, the ambience. Text that carries meaning
   does not use it: the main title is ink (17.6:1) and its five exclamation
   marks use the deepened ramp (3.02-5.11:1, checked below). */
const relativeLuminance = (hex) => {
  const digits = hex.replace('#', '')
  const channels = [0, 1, 2]
    .map((index) => Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}
const contrastOnWhite = (hex) => {
  const luminance = relativeLuminance(hex)
  return (1.05 / (luminance + 0.05))
}

const chromeAt = async (skin) => {
  await page.evaluate((value) => {
    const root = document.documentElement
    if (value === null) delete root.dataset.dshSkin
    else root.dataset.dshSkin = value
  }, skin)
  /* The marks are appended by brand.js, which reacts to the skin attribute on a
     300 ms throttle: wait past it before reading. */
  await page.waitForTimeout(700)
  return page.evaluate(async () => {
    /* The lettering face is inlined, but it still has to decode before it can
       be measured — wait for it rather than assume it. */
    await document.fonts.ready
    /* Chrome normalises `transparent` to rgba(0, 0, 0, 0) in computed styles. */
    const isTransparent = (value) => value === 'transparent' || /rgba\(0, 0, 0, 0\)/.test(value ?? '')
    const body = getComputedStyle(document.body)
    const pseudo = (name) => getComputedStyle(document.body, name)
    const mark = document.querySelector('[class*="railMark"], [class*="brandMark"], button:has(svg[viewBox="0 0 182 24"])')
    const wordmark = document.querySelector('[class*="localBuildTitle"], [class*="fallbackBrandName"], button:has(svg[viewBox="0 0 182 24"])')
    const hero = document.querySelector('[class*="headlineText"], [class*="headline"] > [class*="titleGroup"] > span:not([class*="previewBadge"])')
    const markStyle = mark === null ? null : getComputedStyle(mark, '::before')
    const wordStyle = wordmark === null ? null : getComputedStyle(wordmark, '::after')
    const heroStyle = hero === null ? null : getComputedStyle(hero, '::after')
    /* The title sentence moved to ::before so the appended marks land after it. */
    const titleStyle = hero === null ? null : getComputedStyle(hero, '::before')
    const marks = [...document.querySelectorAll('.diva-bang')]
    const hand = (value) => /Hannotate|Hanzipen|Xingkai|Kaiti/i.test(value ?? '')
    /* The shell's markdown headings take their family from a `font:` shorthand
       in a <head> stylesheet, so a skin rule could beat it on specificity alone.
       Reproduce the situation — a heading whose family is already set — and
       check the sheet leaves it alone. */
    const probeSheet = document.createElement('style')
    probeSheet.textContent = '._probe_md h1 { font: 700 21px/30px monospace; }'
    document.head.append(probeSheet)
    const probe = document.createElement('div')
    probe.className = '_probe_md'
    probe.innerHTML = '<h1>标题</h1>'
    probe.style.position = 'absolute'
    document.body.append(probe)
    const headingFamily = getComputedStyle(probe.querySelector('h1')).fontFamily
    probe.remove()
    probeSheet.remove()
    /* What the palette says the primary label colour is, resolved in this
       context, so the title can be compared against the token rather than
       against one hard-coded value. */
    const tokenProbe = document.createElement('span')
    tokenProbe.style.color = 'var(--dsw-alias-label-primary)'
    document.body.append(tokenProbe)
    const labelPrimary = getComputedStyle(tokenProbe).color
    tokenProbe.remove()

    /* What the palette says the brand colour is, for the focus ring below. */
    const brandProbe = document.createElement('span')
    brandProbe.style.color = 'var(--dsw-alias-brand-primary)'
    document.body.append(brandProbe)
    const brandText = getComputedStyle(brandProbe).color
    brandProbe.remove()

    /* The VIVY心核 caption sits in a list of panel names, so it has to be set in
       the same face as the row above it — the interface face, in every skin. The
       display hand belongs on the wordmark and the title, not on a row a reader
       picks from. */
    const coreLabel = document.querySelector('.diva-core-label')
    const panelRow = document.querySelector('nav[class*="panelList"] > button[class*="panelRow"]')
    const groupType = {
      label: coreLabel === null ? null : getComputedStyle(coreLabel).fontFamily,
      row: panelRow === null ? null : getComputedStyle(panelRow).fontFamily,
    }

    /* The lettering face. `document.fonts.check` says the face resolved; the two
       advance widths say it is *this* face and not a fallback — a subset that
       lost its glyphs still "loads", it just measures like the system font. */
    const pen = document.createElement('canvas').getContext('2d')
    const advance = (family, text) => {
      pen.font = `40px ${family}, monospace`
      return Math.round(pen.measureText(text).width * 100) / 100
    }
    const lettering = {
      declared: [...document.fonts].some((face) => face.family.replace(/["']/g, '') === 'Diva Lettering'),
      loaded: document.fonts.check('40px "Diva Lettering"'),
      width: advance('"Diva Lettering"', '寻找真心之旅'),
      fallbackWidth: advance('"__diva_no_such_font__"', '寻找真心之旅'),
    }

    /* The paper and the pencil. */
    const sidebar = document.querySelector('[class*="sidebarCol"]')
    const canvas = document.querySelector('[class*="nd_X0W_root"], [class*="centerCol"]')
    const card = document.querySelector('[class*="FTowUG_card"]')
    const session = document.querySelector('[class*="newSession"]')
    const badge = document.querySelector('[class*="previewBadge"]')
    const styleOf = (node, pseudo) => (node === null ? null : getComputedStyle(node, pseudo))
    const describe = (node, pseudo) => {
      const style = styleOf(node, pseudo)
      if (style === null) return null
      return {
        radius: style.borderRadius,
        border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
        shadow: style.boxShadow,
        background: style.backgroundImage,
        position: style.position,
        zIndex: style.zIndex,
        transform: style.transform,
        content: style.content,
      }
    }
    const cardBase = describe(card)
    const cardSketch = describe(card, '::after')
    const sessionBase = describe(session)
    const sessionSketch = describe(session, '::after')
    const badgeBase = describe(badge)
    const pencil = describe(hero, '::after')
    const heroBox = hero === null ? null : { position: getComputedStyle(hero).position, zIndex: getComputedStyle(hero).zIndex }

    /* The focus ring is the one thing a hand-drawn shadow must not eat, so the
       composer is actually focused and re-measured. */
    const input = document.querySelector('[class*="FTowUG_input"]')
    input?.focus()
    const cardFocused = card === null ? null : {
      borderColor: getComputedStyle(card).borderColor,
      shadow: getComputedStyle(card).boxShadow,
    }
    input?.blur()

    return {
      gradient: body.getPropertyValue('--diva-gradient').trim(),
      glow: pseudo('::before').backgroundImage,
      band: { content: pseudo('::after').content, height: pseudo('::after').height, background: pseudo('::after').backgroundImage },
      pens: [1, 2, 3, 4, 5].map((index) => body.getPropertyValue(`--diva-bang-${index}`).trim()),
      wordFound: wordmark !== null,
      heroFound: hero !== null,
      markGradient: (markStyle?.backgroundImage ?? '').includes('linear-gradient'),
      markMasked: /svg|data:image/.test(markStyle?.webkitMaskImage ?? markStyle?.maskImage ?? ''),
      wordGradientFill: isTransparent(wordStyle?.webkitTextFillColor) && (wordStyle?.backgroundImage ?? '').includes('linear-gradient'),
      wordPlain: !isTransparent(wordStyle?.webkitTextFillColor),
      wordHand: hand(wordStyle?.fontFamily),
      heroSans: /PingFang|Segoe|YaHei|sans-serif/i.test(heroStyle?.fontFamily ?? ''),
      heroSerif: /Songti|STSong|Serif|Georgia/i.test(heroStyle?.fontFamily ?? ''),
      heroTitle: titleStyle?.content,
      heroHand: hand(titleStyle?.fontFamily),
      heroSize: titleStyle?.fontSize,
      heroInk: titleStyle?.color,
      labelPrimary,
      heroGradientFill: isTransparent(titleStyle?.webkitTextFillColor),
      heroAfterGradientFill: isTransparent(heroStyle?.webkitTextFillColor),
      marks: marks.map((node) => {
        const style = getComputedStyle(node)
        return { bang: node.dataset.bang ?? '', color: style.color, family: style.fontFamily, size: style.fontSize, text: node.textContent, transform: style.transform }
      }),
      headingHand: hand(headingFamily),
      headingFamily,
      lettering,
      letterVar: body.getPropertyValue('--diva-letter').trim(),
      fiber: body.getPropertyValue('--diva-fiber').trim(),
      watercolor: body.getPropertyValue('--diva-watercolor').trim(),
      rule: body.getPropertyValue('--diva-rule').trim(),
      lede: body.getPropertyValue('--diva-lede').trim(),
      wobble: body.getPropertyValue('--diva-wobble-card').trim(),
      sidebarPaper: styleOf(sidebar)?.backgroundImage ?? null,
      canvasPaper: styleOf(canvas)?.backgroundImage ?? null,
      card: cardBase,
      cardSketch,
      cardFocused,
      brandText,
      groupType,
      session: sessionBase,
      sessionSketch,
      badge: badgeBase,
      badgeInk: styleOf(badge, '::after')?.fontFamily ?? null,
      pencil,
      heroBox,
      markSizes: marks.map((node) => getComputedStyle(node).fontSize),
      /* Which sheet actually won. A stale `dsh-vivy-studio` sheet left in the
         document is the failure this records: same specificity, later order, so
         its `content: none` beats the pencil stroke the file on disk defines. */
      diag: {
        skin: document.documentElement.getAttribute('data-dsh-skin'),
        heroHtml: hero === null ? null : hero.outerHTML.slice(0, 170),
        heroIsSlogan: hero === null
          ? null
          : hero.matches('html[data-dsh-skin="diva"] [class*="headline"] > [class*="titleGroup"] > span:not([class*="previewBadge"])'),
        heroTitleCount: document.querySelectorAll('[class*="headline"] > [class*="titleGroup"] > span:not([class*="previewBadge"])').length,
        pluginSheets: [...document.querySelectorAll('style[data-plugin="dsh-vivy-studio"]')].map((node) => node.textContent.length),
        titleAfterRules: [...document.styleSheets]
          .flatMap((sheet) => { try { return [...sheet.cssRules] } catch { return [] } })
          .filter((rule) => /titleGroup/.test(rule.selectorText ?? '') && /::after/.test(rule.selectorText ?? ''))
          .map((rule) => `${rule.style.getPropertyValue('content')} @ ${rule.parentStyleSheet.ownerNode.getAttribute('data-plugin') ?? 'shell'}`),
      },
    }
  })
}
/* The rail was collapsed earlier in this run, and a collapsed rail has no
   wordmark element to paint: open it again so these checks measure something. */
await page.locator('button[class*="toggle"]').first().click({ force: true })
await page.waitForTimeout(900)

const divaChrome = await chromeAt('diva')
const vivyChrome = await chromeAt('vivy')

check('diva: the brand row and the hero are on screen', divaChrome.wordFound && divaChrome.heroFound && vivyChrome.wordFound && vivyChrome.heroFound, `diva ${divaChrome.wordFound}/${divaChrome.heroFound}, vivy ${vivyChrome.wordFound}/${vivyChrome.heroFound}`)
check('diva: the sheet never re-colours the Fluorite palette', divaSheet.base !== '#f4efe6' && divaSheet.base !== '', divaSheet.base)
check('diva: the vocabulary still resolves for the brand', divaSheet.paper === '#f4efe6' && divaSheet.fluorite === '#2aa8a4', `${divaSheet.paper} / ${divaSheet.fluorite}`)
check('diva: the sheet defines the orange-to-pink gradient', /#ff9538/.test(divaChrome.gradient) && /#ff6f61/.test(divaChrome.gradient) && /#ff5c8a/.test(divaChrome.gradient), divaChrome.gradient)
check('diva: the ambience is two gradient glows', /rgba\(255, 149, 56/.test(divaChrome.glow) && /rgba\(255, 92, 138/.test(divaChrome.glow), divaChrome.glow.slice(0, 80))
check('diva: the ambience is not Fluorite haze', divaChrome.glow !== vivyChrome.glow && !/192/.test(divaChrome.glow), vivyChrome.glow.slice(0, 44))
check('diva: nothing is drawn across the top of the window', divaChrome.band.content === 'none' && vivyChrome.band.content === 'none', `${divaChrome.band.content} / ${divaChrome.band.height} / ${vivyChrome.band.content}`)
check('diva: the old rail is gone from the sheet, not merely transparent', !/linear-gradient/.test(divaChrome.band.background) && divaChrome.band.background === 'none', String(divaChrome.band.background).slice(0, 40))
check('diva: the mark is a gradient behind a gem mask', divaChrome.markGradient && divaChrome.markMasked, `gradient ${divaChrome.markGradient} / mask ${divaChrome.markMasked}`)
check('diva: the mark is a flat gem under vivy', !vivyChrome.markGradient && !vivyChrome.markMasked, `gradient ${vivyChrome.markGradient} / mask ${vivyChrome.markMasked}`)
check('diva: the wordmark is gradient-filled text', divaChrome.wordGradientFill, String(divaChrome.wordGradientFill))
check('diva: the wordmark is plain under the Fluorite skin', vivyChrome.wordPlain, String(vivyChrome.wordPlain))
check('diva: the wordmark is written in the hand', divaChrome.wordHand && !vivyChrome.wordHand, `diva ${divaChrome.wordHand} / vivy ${vivyChrome.wordHand}`)

/* The main title. */
check('diva: the main title is drawn by ::before, so marks can follow it', divaChrome.heroTitle === '"寻找真心之旅"', String(divaChrome.heroTitle))
check('diva: the main title is written in the hand', divaChrome.heroHand && !divaChrome.heroSans, `${divaChrome.heroHand} / sans ${divaChrome.heroSans}`)
check('diva: the main title is the label token, not the gradient', divaChrome.heroInk === divaChrome.labelPrimary && !divaChrome.heroGradientFill, `${divaChrome.heroInk} vs ${divaChrome.labelPrimary} / gradient ${divaChrome.heroGradientFill}`)
check('diva: the title is set large enough for the hand to read', divaChrome.heroSize === '40px', String(divaChrome.heroSize))
check('diva: five exclamation marks after the sentence', divaChrome.marks.length === 5 && divaChrome.marks.every((mark) => mark.text === '!'), divaChrome.marks.map((mark) => mark.text).join(''))
check('diva: each mark carries its own index for the sheet', divaChrome.marks.map((mark) => mark.bang).join(',') === '1,2,3,4,5', divaChrome.marks.map((mark) => mark.bang).join(','))
check('diva: no two marks share a colour', new Set(divaChrome.marks.map((mark) => mark.color)).size === 5, divaChrome.marks.map((mark) => mark.color).join(' '))
check('diva: the marks are written in the same hand', divaChrome.marks.every((mark) => /Hannotate|Hanzipen|Xingkai|Kaiti/i.test(mark.family)), divaChrome.marks[0]?.family ?? '')
check('diva: the brightest mark clears AA-large on white', divaChrome.pens.every((value) => /^#[0-9a-f]{6}$/i.test(value) && contrastOnWhite(value) >= 3), divaChrome.pens.map((value) => `${value} ${contrastOnWhite(value).toFixed(2)}:1`).join(' '))
check('diva: the bright gradient is not used for the marks', divaChrome.pens.every((value) => !['#ff9538', '#ff6f61', '#ff5c8a'].includes(value.toLowerCase())), divaChrome.pens.join(' '))
check('diva: headings keep the shell type, not a hand', !divaChrome.headingHand && !vivyChrome.headingHand, `diva ${divaChrome.headingFamily.slice(0, 24)} / vivy ${vivyChrome.headingFamily.slice(0, 24)}`)
/* The group caption is a panel name among panel names: same face as the row above
   it, in both skins, and never the display hand. */
check('diva: the sidebar group reads in the interface face', divaChrome.groupType.label !== null && divaChrome.groupType.label === divaChrome.groupType.row && !/Diva Lettering/.test(divaChrome.groupType.label), `caption ${divaChrome.groupType.label?.slice(0, 30)} / row ${divaChrome.groupType.row?.slice(0, 30)}`)
check('vivy: the sidebar group reads in the interface face', vivyChrome.groupType.label !== null && vivyChrome.groupType.label === vivyChrome.groupType.row && !/Diva Lettering/.test(vivyChrome.groupType.label), `caption ${vivyChrome.groupType.label?.slice(0, 30)} / row ${vivyChrome.groupType.row?.slice(0, 30)}`)
check('diva: the script removes the marks again under another skin', vivyChrome.marks.length === 0, `${vivyChrome.marks.length} left`)
check('diva: the hero keeps the serif under vivy', vivyChrome.heroSerif && !vivyChrome.heroAfterGradientFill, `serif ${vivyChrome.heroSerif} / gradient ${vivyChrome.heroAfterGradientFill}`)

/* --- the cozy pass: paper, pencil and the hand-drawn kit ------------------- */

/* Sheet level first. Two things have to be true of the *text* of the sheet: the
   lettering subset must be inlined, and nothing in the sheet may reach for a
   URL — a local build with no static route must not be able to load a font even
   by accident. */
check(
  'diva: the lettering subset travels inside the sheet',
  /@font-face\s*\{[^}]*data:font\/woff2;base64,[A-Za-z0-9+/=]{1000,}/.test(injectedCss),
  `${(injectedCss.match(/@font-face/g) ?? []).length} @font-face, data uri ${/data:font\/woff2;base64/.test(injectedCss)}`,
)
check(
  'diva: the sheet fetches nothing over the network',
  !/url\(\s*["']?(?:https?:)?\/\//.test(injectedCss) && !/@import/.test(injectedCss),
  (injectedCss.match(/url\([^)]{0,34}/g) ?? []).join(' ').slice(0, 120),
)
/* The first draft replaced the *first* occurrence of the token, and the comment
   above the block mentions it — so the `src` stayed literally
   `url("__DIVA_WENKAI__")` and the face silently never loaded. A placeholder
   that survives into the served sheet is now a failure in its own right. */
check(
  'diva: no build placeholder survives into the served sheet',
  !/__[A-Z][A-Z0-9_]+__/.test(injectedCss),
  (injectedCss.match(/__[A-Z][A-Z0-9_]+__/g) ?? []).join(' '),
)
check(
  'diva: the lettering face decodes and draws its own glyphs',
  divaChrome.lettering.declared && divaChrome.lettering.loaded && divaChrome.lettering.width !== divaChrome.lettering.fallbackWidth,
  `declared ${divaChrome.lettering.declared} / loaded ${divaChrome.lettering.loaded} / ${divaChrome.lettering.width}px vs fallback ${divaChrome.lettering.fallbackWidth}px`,
)
check(
  'diva: the lettering asks for the subset, everywhere it is used',
  /^"Diva Lettering"/.test(divaChrome.letterVar) &&
    divaChrome.marks.every((mark) => /Diva Lettering/.test(mark.family)),
  `${divaChrome.letterVar.slice(0, 30)} / marks ${divaChrome.marks[0]?.family.slice(0, 20) ?? 'none'}`,
)
check(
  'diva: the title sits on a coloured-pencil stroke',
  divaChrome.pencil?.content === '""' &&
    /linear-gradient/.test(divaChrome.pencil.background) &&
    divaChrome.pencil.zIndex === '-1' &&
    /matrix/.test(divaChrome.pencil.transform),
  `content ${divaChrome.pencil?.content} / z ${divaChrome.pencil?.zIndex} / ${divaChrome.pencil?.transform}`,
)
check(
  'diva: a stacking context puts that stroke under the glyphs',
  divaChrome.heroBox?.position === 'relative' && divaChrome.heroBox?.zIndex === '0',
  `${divaChrome.heroBox?.position}/${divaChrome.heroBox?.zIndex}`,
)
check(
  'diva: the marks are a size down from the title and set off the baseline',
  divaChrome.markSizes.length === 5 &&
    divaChrome.markSizes.every((size) => Number.parseFloat(size) < 40) &&
    new Set(divaChrome.marks.map((mark) => mark.transform)).size === 5,
  `${divaChrome.markSizes.join('/')} · ${new Set(divaChrome.marks.map((mark) => mark.transform)).size} distinct transforms`,
)
check(
  'diva: the canvas and the sidebar are painted as paper',
  /repeating-linear-gradient/.test(divaChrome.canvasPaper ?? '') && /repeating-linear-gradient/.test(divaChrome.sidebarPaper ?? ''),
  `canvas ${/repeating-linear-gradient/.test(divaChrome.canvasPaper ?? '')} / sidebar ${/repeating-linear-gradient/.test(divaChrome.sidebarPaper ?? '')}`,
)
/* The pencil rule is declared at 1.5px. Chrome snaps border widths to whole
   device pixels, so at devicePixelRatio 1 it reports 1px and on a Retina display
   it reports 1.5px; both are the same declaration and both are accepted here. */
check(
  'diva: the composer is drawn — uneven corners, pencil rule, ink shadow',
  divaChrome.card !== null &&
    new Set(divaChrome.card.radius.split(/\s+/)).size === 4 &&
    /^1(?:\.5)?px solid/.test(divaChrome.card.border) &&
    /3px 4px 0px -1px/.test(divaChrome.card.shadow),
  `${divaChrome.card?.radius} / ${divaChrome.card?.border} / ${divaChrome.card?.shadow}`,
)
check(
  'diva: the composer is drawn twice, the second outline askew',
  divaChrome.cardSketch?.content === '""' && /matrix/.test(divaChrome.cardSketch.transform) && /1px solid/.test(divaChrome.cardSketch.border),
  `${divaChrome.cardSketch?.content} / ${divaChrome.cardSketch?.transform} / ${divaChrome.cardSketch?.border}`,
)
check(
  'diva: the focus ring survives the hand-drawn shadow',
  divaChrome.cardFocused !== null &&
    divaChrome.cardFocused.borderColor === divaChrome.brandText &&
    /0px 0px 0px 3px/.test(divaChrome.cardFocused.shadow),
  `${divaChrome.cardFocused?.borderColor} vs brand ${divaChrome.brandText} / ${divaChrome.cardFocused?.shadow}`,
)
check(
  'diva: the sidebar action is a sheet of paper, not a plain button',
  divaChrome.session !== null &&
    new Set(divaChrome.session.radius.split(/\s+/)).size === 4 &&
    /^1(?:\.5)?px solid/.test(divaChrome.session.border) &&
    /linear-gradient/.test(divaChrome.session.background) &&
    divaChrome.sessionSketch?.content === '""',
  `${divaChrome.session?.radius} / ${divaChrome.session?.border} / sketch ${divaChrome.sessionSketch?.content}`,
)
check(
  'diva: the badge is a stamp — wobbly, inked and pressed off true',
  divaChrome.badge !== null &&
    divaChrome.badge.radius !== '999px' &&
    new Set(divaChrome.badge.radius.split(/\s+/)).size === 4 &&
    /matrix/.test(divaChrome.badge.transform) &&
    /inset/.test(divaChrome.badge.shadow) &&
    /Diva Lettering/.test(divaChrome.badgeInk ?? ''),
  `${divaChrome.badge?.radius} / ${divaChrome.badge?.transform} / ${divaChrome.badgeInk}`,
)
check(
  'diva: none of that hand-drawn kit leaks into the Fluorite skin',
  vivyChrome.badge?.radius === '2px' && !/matrix/.test(vivyChrome.badge?.transform ?? '') && vivyChrome.card?.radius === '28px',
  `vivy badge ${vivyChrome.badge?.radius}/${vivyChrome.badge?.transform} / card ${vivyChrome.card?.radius}`,
)

/* The weave is the only thing this pass puts between text and its background, so
   its cost is measured rather than assumed: composite the darkest overlap of the
   two gratings over the palette's paper base, then re-run the ratios. */
const managerSource = readFileSync(join(PLUGIN, '..', 'dsh-skin-manager', 'src', 'client.js'), 'utf8')
const divaBlock = managerSource.slice(managerSource.indexOf('const DIVA_SKIN = {'), managerSource.indexOf('const OH_DSH_SKINS = ['))
const divaToken = (token) => new RegExp(`"${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}": "([^"]+)"`).exec(divaBlock)?.[1]
const weave = (() => {
  const base = divaToken('--dsw-alias-bg-base') ?? '#ffffff'
  const channels = (hex) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16))
  const ink = channels('#78563e')
  const paper = channels(base)
  /* Both gratings landing on the same pixel: 0.03 + 0.022 of the fibre ink. */
  const alpha = 0.052
  const composite = paper.map((value, index) => value * (1 - alpha) + ink[index] * alpha)
  return {
    base,
    hex: `#${composite.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`,
  }
})()
const contrastOn = (foreground, background) => {
  const a = relativeLuminance(foreground)
  const b = relativeLuminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
const weaveInk = contrastOn(divaToken('--dsw-alias-label-primary'), weave.hex)
const weaveSecondary = contrastOn(divaToken('--dsw-alias-label-secondary'), weave.hex)
check(
  'diva: the paper weave costs no text contrast',
  weaveInk >= 15 && weaveSecondary >= 5.5,
  `${weave.base} -> ${weave.hex}: ink ${weaveInk.toFixed(2)}:1, secondary ${weaveSecondary.toFixed(2)}:1`,
)
check(
  'diva: the registered palette is warm paper, not screen white',
  divaToken('--dsw-alias-bg-base') === '#fffdfa' &&
    divaToken('--dsw-alias-label-secondary') === '#6f6055' &&
    divaToken('--dsw-alias-border-l1') === 'rgba(45, 32, 25, 0.08)',
  `${divaToken('--dsw-alias-bg-base')} / ${divaToken('--dsw-alias-label-secondary')} / ${divaToken('--dsw-alias-border-l1')}`,
)

/* Evidence: the hand-written panel and a crop of the title itself. */
await chromeAt('diva')
await page.screenshot({ path: `${OUT}/05-diva-panel.png`, fullPage: true })
const heroBox = await page.evaluate(() => {
  const hero = document.querySelector('[class*="headline"]')
  if (hero === null) return null
  const rect = hero.getBoundingClientRect()
  return {
    x: Math.max(0, Math.round(rect.x) - 40),
    y: Math.max(0, Math.round(rect.y) - 30),
    width: Math.min(Math.round(rect.width) + 80, window.innerWidth),
    height: Math.round(rect.height) + 60,
  }
})
if (heroBox !== null) await page.screenshot({ path: `${OUT}/06-diva-title.png`, clip: heroBox })
await chromeAt(null)

/* The choice is a preference, so it has to outlive the session that made it. A
   reload goes back to whatever the running process serves, so this can only be
   measured when that is already this revision of the script. */
await page.locator('.diva-core-head').click()
await page.waitForTimeout(300)
const beforeReload = await coreProbe()
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
const afterReload = await coreProbe()
const servedScriptFresh = servedJs === injectedJs
check(
  'core: the shut group comes back shut after a reload',
  servedScriptFresh
    ? beforeReload.stored === 'collapsed' && afterReload.headCount === 1 && afterReload.expanded === 'false' && afterReload.memberDisplay === 'none'
    : true,
  servedScriptFresh
    ? `${beforeReload.stored} -> ${afterReload.state}, ${afterReload.headCount} header, members ${afterReload.memberDisplay}`
    : 'skipped: the running process serves an older script — restart it and run again',
)
await coreReset('expanded')

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '))

if (managerBefore !== null) await skinManager('PUT', managerBefore)

writeFileSync(`${OUT}/assertions.json`, `${JSON.stringify({ results, managerBefore, divaSheet, divaChrome, vivyChrome, staleCheck, servedCssFresh: servedCss === injectedCss, servedScriptFresh, native, bare, light, core, shut, reopened, coreRail, afterReload, collapsed, dark, titleCases, sheet, pageErrors }, null, 2)}\n`)
await browser.close()

const failed = results.filter((entry) => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) process.exitCode = 1
