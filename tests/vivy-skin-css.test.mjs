import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(root, 'plugins/dsh-vivy-studio/theme.css'), 'utf8')

/** Every selector prelude that opens a block, comments removed. */
function selectorsOf(source) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  let buffer = ''
  for (const char of clean) {
    if (char === '{') {
      const selector = buffer.trim()
      if (selector !== '') out.push(selector)
      buffer = ''
    } else if (char === '}') {
      buffer = ''
    } else {
      buffer += char
    }
  }
  return out
}

test('newSession surface rules target the button, never its inner spans', () => {
  // The harness renders the action as <button class="<hash>_newSession"> with
  // span descendants named newSessionLabelMask, newSessionContent,
  // newSessionLabel and newSessionShortcut. A bare [class*="newSession"]
  // selector repaints every one of them, so the label and the shortcut each
  // draw their own offset outline over the button.
  const hits = selectorsOf(css).filter((selector) => selector.includes('class*="newSession"'))
  assert.ok(hits.length > 0, 'expected the newSession surface rules to exist in theme.css')
  for (const selector of hits) {
    assert.match(
      selector,
      /button\[class\*="newSession"\]/,
      `newSession rule must be scoped to the button element: ${selector}`,
    )
  }
})

test('no other substring class selector collides with a nested module name', () => {
  // The theme matches hashed CSS-module classes by substring. A module name
  // that is also a prefix of a descendant's name would decorate that
  // descendant too. newSession is the only such collision in the shell markup;
  // this pins the set so a future rule can't quietly add another.
  const names = [...new Set(
    selectorsOf(css)
      .flatMap((selector) => [...selector.matchAll(/\[class\*="([A-Za-z0-9_]+)"\]/g)].map((m) => m[1])),
  )].sort()
  const known = ['FTowUG_add', 'FTowUG_card', 'FTowUG_primary', 'brandMark', 'buildVersion', 'bM6_gq_workspace', 'centerCol', 'copy', 'decoration', 'dialog', 'fallbackBrandName', 'fishHitbox', 'headline', 'headlineText', 'localBuildBrand', 'localBuildTitle', 'nd_X0W_root', 'newSession', 'panelRow', 'previewBadge', 'projectRow', 'railMark', 'runningDivider', 'runningText', 'sessionRow', 'sidebarCol', 'text', 'title', 'titleGroup']
  const unexpected = names.filter((name) => !known.includes(name))
  assert.deepEqual(unexpected, [], `unreviewed substring class selector(s): ${unexpected.join(', ')}`)
})

/** The declaration block of one single-selector rule, comments removed. */
function blockOf(source, selector) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const at = clean.indexOf(`${selector} {`)
  assert.notStrictEqual(at, -1, `expected the rule "${selector}" in theme.css`)
  const open = clean.indexOf('{', at)
  return clean.slice(open + 1, clean.indexOf('}', open))
}

/* The VIVY心核 and VIVY工具 groups. sidebar-core.js answers "rail or wide" by
   measuring the nav, because the shell keeps the wide layout mounted for 150ms
   while the column slides; these attributes are the only state the sheet may key
   on, and the rail must never be inferred from a member row's box — a shut group
   hides its members, and a hidden row measures 0px like the rail does. */
test('the groups key their layout off the attributes the script writes', () => {
  assert.match(blockOf(css, '[data-diva-rail="true"] > .diva-core-head'), /display:\s*none/)
  assert.match(blockOf(css, '[data-diva-rail="false"] > .diva-core-row'), /padding-left:\s*22px/)
  assert.match(blockOf(css, '[data-diva-rail="false"][data-diva-core="collapsed"] > .diva-core-row[data-diva-group="core"]'), /display:\s*none/)
  assert.match(blockOf(css, '[data-diva-rail="false"][data-diva-tools="collapsed"] > .diva-core-row[data-diva-group="tools"]'), /display:\s*none/)
  // The members take the rail's own geometry from the shell, so no rail rule
  // may touch a member row at all.
  const rowRules = selectorsOf(css).filter((selector) => selector.includes('[data-diva-rail="true"]'))
  for (const selector of rowRules) {
    assert.ok(!selector.includes('.diva-core-row'), `rail rule must not restyle members: ${selector}`)
  }
})

test('each group shuts only its own members', () => {
  // One attribute per group: a shut core must not take the tools with it.
  const shut = selectorsOf(css).filter((selector) => /data-diva-(core|tools)="collapsed"/.test(selector))
  assert.equal(shut.length, 2, `expected one shut rule per group, found ${shut.length}`)
  for (const group of ['core', 'tools']) {
    assert.ok(
      shut.some((selector) => selector.includes(`data-diva-${group}="collapsed"`) && selector.includes(`data-diva-group="${group}"`)),
      `the ${group} group's shut rule does not match its own members`,
    )
  }
})

test('the groups survive every skin, not only the one they are named after', () => {
  // --diva-* tokens exist only under html[data-dsh-skin="diva"], so a rule that
  // carries a group's behaviour may not reach for one.
  for (const selector of [
    '.diva-core-head',
    '.diva-core-head:focus-visible',
    '.diva-core-chevron',
    '[data-diva-rail="true"] > .diva-core-head',
    '[data-diva-rail="false"] > .diva-core-row',
    '[data-diva-rail="false"][data-diva-core="collapsed"] > .diva-core-row[data-diva-group="core"]',
    '[data-diva-rail="false"][data-diva-tools="collapsed"] > .diva-core-row[data-diva-group="tools"]',
  ]) {
    assert.doesNotMatch(selector, /data-dsh-skin/, `state rule must be skin-independent: ${selector}`)
    assert.doesNotMatch(blockOf(css, selector), /var\(--diva-/, `rule uses a diva-only token: ${selector}`)
  }
  assert.match(blockOf(css, '.diva-core-head:focus-visible'), /--dsw-focus-ring-width/)
  assert.match(blockOf(css, '.diva-core-head[aria-expanded="false"] .diva-core-chevron'), /rotate\(-90deg\)/)
})

/* The header is a peer of the resident rows, not a caption above them: the same
   36px box, the same 7px/8px of padding and the same row ink as `.panelRow` in
   the shell's own sheet. A caption-sized row (28px, 12px type, secondary ink)
   read as a different kind of thing sitting in the middle of the list. */
test('the header is drawn as a panel row, not as a caption', () => {
  const head = blockOf(css, '.diva-core-head')
  assert.match(head, /min-height:\s*36px/)
  assert.match(head, /padding:\s*7px 8px/)
  assert.match(head, /border-radius:\s*var\(--dsw-radius-md\)/)
  assert.match(head, /display:\s*flex/)
  assert.match(head, /line-height:\s*22px/)
  // Ink, like its neighbours; the caption used to sit a shade back in secondary.
  assert.match(head, /color:\s*var\(--dsw-alias-label-primary\)/)
})

/* Heart, caption, then the disclosure at the row's far edge. The caption is the
   only child allowed to grow, which is what pushes the chevron right without a
   hand-set width on the row. */
test('the caption takes the slack between its two glyphs', () => {
  assert.match(blockOf(css, '.diva-core-label'), /flex:\s*1 1 auto/)
  // Both glyphs are the shell's 16px panel icon size.
  assert.match(blockOf(css, '.diva-core-chevron'), /width:\s*16px/)
  const glyphs = blockOf(css, '.diva-core-chevron')
  assert.match(glyphs, /width:\s*16px/)
  assert.match(glyphs, /height:\s*16px/)
  assert.match(glyphs, /flex:\s*none/)
})

/* An inset rule down the members' left edge turned each of them into a boxed tab
   that belonged to nothing — the indent already says who they hang under. */
test('no rule draws an edge down the members', () => {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.doesNotMatch(clean, /diva-core-row[^{]*\{[^}]*box-shadow/, 'a member row is being drawn on again')
  assert.doesNotMatch(clean, /diva-core-row[^{]*\{[^}]*border-left/, 'a member row carries a left rule')
})

/* The caption is a panel name among panel names, so it keeps the interface face
   in every skin. Set in the display hand — the face the wordmark, the badge and
   the title's five marks are written in — the one row that has to look like a
   peer of 插件 instead read as a note slipped between the rows: a different
   kind of writing in a list of labels, and nothing beside it was written that
   way. The hand belongs on things that are *set*, not on things that are
   *chosen*. */
test('the caption keeps the interface face, never the display hand', () => {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const touching = selectorsOf(css).filter((selector) => /diva-core-head|diva-core-label/.test(selector))
  for (const selector of touching) {
    const block = blockOf(css, selector)
    assert.doesNotMatch(block, /--diva-letter/, `${selector} is set in the display hand`)
    assert.doesNotMatch(block, /font-family/, `${selector} overrides the interface face`)
  }
  assert.doesNotMatch(clean, /diva-core-(label|head)[^{]*\{[^}]*font-family/, 'a rule reaches for a family on the group')
})
