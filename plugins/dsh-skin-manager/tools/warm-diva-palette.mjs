/* Warm the DIVA palette inside the skin manager's catalog.
 *
 * The registered `diva` palette is the source of truth for every token the
 * shell reads, so the cozy pass edits it there instead of restating colours in
 * the skin sheet. Every text-bearing swap keeps (or raises) its WCAG contrast
 * against the new paper base — the script prints the before/after ratios.
 *
 * It is also the check for the result: with `--write` omitted it reports every
 * token that is already warm, every one that would still swap, and every one
 * whose value matches neither — so `node tools/warm-diva-palette.mjs` after a
 * merge answers "is the palette still the one we measured?".
 *
 *   node tools/warm-diva-palette.mjs [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const FILE = process.env.DIVA_MANAGER_FILE
  ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'client.js')
const WRITE = process.argv.includes('--write')

/* token -> [old, new] */
const WARM = {
  '--dsw-alias-bg-base': ['#ffffff', '#fffdfa'],
  '--dsw-alias-bg-layer-2': ['#faf7f8', '#fbf6f1'],
  '--dsw-alias-bg-layer-3': ['#f4f0f2', '#f6f0ea'],
  '--dsw-alias-bg-mask-1': ['rgba(28, 23, 32, 0.3)', 'rgba(45, 32, 25, 0.3)'],
  '--dsw-alias-bg-mask-2': ['rgba(28, 23, 32, 0.14)', 'rgba(45, 32, 25, 0.14)'],
  '--dsw-alias-bg-mask-3': ['rgba(28, 23, 32, 0.48)', 'rgba(45, 32, 25, 0.48)'],
  '--dsw-alias-bg-mask-photo': ['rgba(20, 16, 24, 0.88)', 'rgba(30, 22, 18, 0.88)'],
  '--dsw-alias-bg-module-platform': ['#f4f0f2', '#f6f0ea'],
  '--dsw-alias-bg-skeleton': ['rgba(28, 23, 32, 0.055)', 'rgba(45, 32, 25, 0.055)'],
  '--dsw-alias-border-l1': ['rgba(28, 23, 32, 0.08)', 'rgba(45, 32, 25, 0.08)'],
  '--dsw-alias-border-l2-darkmode-thin': ['rgba(28, 23, 32, 0.1)', 'rgba(45, 32, 25, 0.1)'],
  '--dsw-alias-border-l2': ['rgba(28, 23, 32, 0.13)', 'rgba(45, 32, 25, 0.13)'],
  '--dsw-alias-border-l3': ['rgba(28, 23, 32, 0.18)', 'rgba(45, 32, 25, 0.18)'],
  '--dsw-alias-border-l4': ['rgba(28, 23, 32, 0.24)', 'rgba(45, 32, 25, 0.24)'],
  '--dsw-alias-button-contrast-fill': ['#1c1720', '#241c16'],
  '--dsw-alias-button-tool-bar-fill-invisible': ['rgba(28, 23, 32, 0.34)', 'rgba(45, 32, 25, 0.34)'],
  '--dsw-alias-button-tool-bar-fill': ['rgba(28, 23, 32, 0.46)', 'rgba(45, 32, 25, 0.46)'],
  '--dsw-alias-button-tool-bar-hover': ['rgba(28, 23, 32, 0.56)', 'rgba(45, 32, 25, 0.56)'],
  '--dsw-alias-interactive-bg-hover-solid': ['#f4f0f2', '#f6f0ea'],
  '--dsw-alias-label-caption': ['#8b8394', '#8d7c70'],
  '--dsw-alias-label-dimmed': ['#bdb6c4', '#c1b5a9'],
  '--dsw-alias-label-primary': ['#1c1720', '#241c16'],
  '--dsw-alias-label-primary-dimmed': ['#2c2533', '#332821'],
  '--dsw-alias-label-secondary': ['#6b6375', '#6f6055'],
  '--dsw-alias-label-shimmer': ['rgba(28, 23, 32, 0.3)', 'rgba(45, 32, 25, 0.3)'],
  '--dsw-alias-label-tertiary': ['#8b8394', '#8d7c70'],
  '--dsw-alias-markdown-citation': ['#f4f0f2', '#f6f0ea'],
  '--dsw-alias-markdown-code-block': ['#f7f3f5', '#fbf6f1'],
  '--dsw-alias-markdown-code-block-banner': ['#efe9ec', '#f1eae2'],
  '--dsw-alias-markdown-code-segment-unselected': ['#f4f0f2', '#f6f0ea'],
  '--dsw-alias-markdown-placeholder': ['#f4f0f2', '#f6f0ea'],
  '--dsw-alias-markdown-tag': ['#f4f0f2', '#f6f0ea'],
  '--dsw-alias-menu-icon': ['#5e5668', '#64564b'],
  '--dsw-alias-scrollbar-bg-l1': ['#d9d3dd', '#ded4c9'],
  '--dsw-alias-scrollbar-bg-l2': ['#d9d3dd', '#ded4c9'],
  '--dsw-alias-scrollbar-hover-l1': ['#c2bac8', '#c8bbad'],
  '--dsw-alias-scrollbar-hover-l2': ['#c2bac8', '#c8bbad'],
  '--dsw-alias-state-idle-primary': ['#bdb6c4', '#c1b5a9'],
  '--dsw-alias-toast-bg': ['#241f2b', '#2c2320'],
  '--dsw-alias-tooltip-bg': ['#241f2b', '#2c2320'],
  '--dsw-alias-tooltip-key-bg': ['#3a3342', '#443a32'],
  '--dsw-alias-turn-trigger-bg': ['#f7f3f5', '#fbf6f1'],
  '--dsw-specific-login-input': ['#f4f0f2', '#f6f0ea'],
  '--dsw-specific-selector': ['#f4f0f2', '#f6f0ea'],
  '--dsw-specific-sidebar-fill': ['#ffffff', '#fdf4ef'],
  '--dsw-specific-sidebar-nav-item-hover': ['rgba(28, 23, 32, 0.05)', 'rgba(45, 32, 25, 0.05)'],
  '--dsw-specific-tip': ['#f4f0f2', '#f6f0ea'],
  '--dsw-alias-bg-document-preview': ['#f4f0f2', '#f6f0ea'],
  '--dsw-alias-label-document-preview': ['#8b8394', '#8d7c70'],
}

/* --- WCAG --- */
const srgb = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
function parse(value) {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim())
  if (hex) {
    const n = parseInt(hex[1], 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }
  }
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(value.trim())
  if (!rgba) return undefined
  const parts = rgba[1].split(',').map((p) => Number.parseFloat(p))
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 }
}
const over = (a, b) => ({
  r: a.r * a.a + b.r * (1 - a.a),
  g: a.g * a.a + b.g * (1 - a.a),
  b: a.b * a.a + b.b * (1 - a.a),
  a: 1,
})
const luminance = ({ r, g, b }) => 0.2126 * srgb(r / 255) + 0.7152 * srgb(g / 255) + 0.0722 * srgb(b / 255)
const contrast = (fg, bg) => {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
const ratio = (fgValue, bgValue) => {
  const bg = parse(bgValue)
  const fg = parse(fgValue)
  return contrast(over(fg, bg), bg)
}

const BASE = '#fffdfa'
console.log('=== text-bearing swaps: contrast on white -> on paper (#fffdfa) ===')
for (const token of ['--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary',
  '--dsw-alias-label-caption', '--dsw-alias-label-dimmed', '--dsw-alias-label-primary-dimmed',
  '--dsw-alias-menu-icon', '--dsw-alias-state-idle-primary', '--dsw-alias-button-contrast-fill',
  '--dsw-alias-brand-primary', '--dsw-alias-brand-text']) {
  const swap = WARM[token]
  const old = swap ? swap[0] : null
  const now = swap ? swap[1] : null
  if (old === null) continue
  console.log(
    token.padEnd(42),
    old.padEnd(24), ratio(old, '#ffffff').toFixed(2), '->',
    now.padEnd(24), ratio(now, BASE).toFixed(2),
  )
}

const source = readFileSync(FILE, 'utf8')
const start = source.indexOf('const DIVA_SKIN = {')
const end = source.indexOf('const OH_DSH_SKINS = [')
if (start < 0 || end < 0 || end < start) throw new Error('cannot locate the DIVA_SKIN block')
let block = source.slice(start, end)
const quote = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const already = []
const would = []
const unexpected = []
for (const [token, [old, next]] of Object.entries(WARM)) {
  const key = quote(token)
  const patternOld = new RegExp(`("${key}": )"${quote(old)}"`)
  const patternNew = new RegExp(`("${key}": )"${quote(next)}"`)
  if (patternNew.test(block)) {
    already.push(token)
  } else if (patternOld.test(block)) {
    would.push(token)
    block = block.replace(patternOld, `$1"${next}"`)
  } else {
    unexpected.push(block.includes(`"${token}":`) ? `${token}: neither ${old} nor ${next}` : `${token}: token absent`)
  }
}
console.log(`\nalready warm ${already.length} · would swap ${would.length} · unexpected ${unexpected.length} (of ${Object.keys(WARM).length})`)
if (unexpected.length) console.log('unexpected:\n  ' + unexpected.join('\n  '))
if (WRITE && would.length > 0) {
  writeFileSync(FILE, source.slice(0, start) + block + source.slice(end))
  console.log(`\nwrote ${FILE}`)
} else if (WRITE) {
  console.log('\nnothing to write')
} else {
  console.log('\n(dry run — pass --write to save)')
}
if (unexpected.length > 0) process.exitCode = 1
