# dsh-vivy-studio

DIVA identity, the Fluorite palette, and the gradient, hand-written layer of the
white **diva** skin, for the **vivy-dsh** web shell.

Ported from [`mastwet/vivy-studio`](https://github.com/mastwet/vivy-studio)
(`dsh-vivy-studio`), where it was the first-party skin of the independent Vivy
Studio application, and re-pointed at the DSH 0.2.1-rc.5 shell this template
pins. No other plugin from that repository is installed here.

- Product name: **DIVA** — tab title, sidebar wordmark, tab icon and welcome
  dialog title. `index.js` holds the name once, as `PRODUCT`; `theme.css`
  carries the `__VIVY_PRODUCT__` token that `index.js` substitutes at boot.
  The title is rewritten per session, in the interface language, so `brand.js`
  replaces `DSH 本地构建` / `DSH Local Build` as well as the release name and
  keeps the `"<session> — "` prefix.
- Sidebar grouping: every global panel except `插件`, `自动化任务` and `相遇` is folded under
  a **VIVY心核** group header that opens and shuts (`sidebar-core.js`). The list slot
  hands over a flat, order-sorted list and its contract has no group field, so the
  header is inserted into the nav React already owns; the membership is read off each
  row's `aria-label` on every pass rather than pinned to a count, the resident rows are
  named rather than counted, and the shut state is kept in `localStorage`. The whole-column
  collapse is left to the shell. In the 56px rail the header steps out and the member
  icons keep the geometry the shell gives them.

  The header is drawn as a panel row rather than a caption — heart, `VIVY心核`, then the
  disclosure at the row's trailing edge, on the shell's own 36px box — so it reads as a
  peer of `插件` and `自动化任务` instead of a title wedged between them. Its caption stays
  in the interface face in every skin: the display hand is for things that are *set*
  (the wordmark, the badge, the title and its marks), not for a row a reader picks from. Panel rows are
  sorted by a per-plugin `order` and more than one plugin ships the same one: SurfCore,
  Superagent and `自动化任务` all register at 10, so `自动化任务` renders after the first
  two and the header would otherwise land between it and `插件`. A resident row found
  behind the header is therefore moved back in front of it; the members themselves are
  only marked, never moved.
- Skins: two, and they share nothing but the brand.
  - `vivy` is **Fluorite** — concert-hall paper / night ink in light and dark,
    one teal accent, the gem mark, the wide-tracked wordmark, the serif hero
    slogan and the welcome copy. Its full 112-token palette lives in
    `theme.css`, scoped to the `vivy` skin id.
  - `diva` is **warm paper, drawn by hand** — still a light skin, but the
    surfaces are paper rather than screen: a warm neutral palette the manager
    registers, two hairline gratings standing in for the fibre of the sheet,
    three watercolour washes, edges drawn with uneven corner radii and a second
    wobbling outline, and ink shadows instead of blurs. One orange-to-pink
    gradient (`#ff9538 -> #ff6f61 -> #ff5c8a`) is used only as decoration. Its
    palette is registered by `dsh-skin-manager` (a full 112-token set, light by
    construction), so what this sheet owns for it is the layer tokens cannot
    carry: the paper, the washes, the hand-drawn kit, the gem mark as a gradient
    behind an alpha mask, the wordmark and the onboarding title as
    gradient-filled type, the lettering face, and the main title.
- One face, by design, and only where the copy is fixed. **Lettering**
  (`--diva-letter`) is an embedded subset of LXGW WenKai TC (48 glyphs, 5.7 KB,
  inlined by `index.js` as a data URI) and is used for the literals the subset
  provably covers — the wordmark, the main title, its five marks, the badge and
  the onboarding title; the system 楷体 behind it is a fallback for a build whose
  subset did not load. Headings keep the shell's sans stack: their text is
  arbitrary, so a hand there would either mix two faces (a glyph the subset
  misses) or set a whole document in a kai, which reads as decoration rather
  than as type.
- The paper is painted on the surfaces, not behind them. `#root` and the
  columns paint opaque fills, so an ambient layer on `body::before` shows
  through nowhere — the fibre and the washes go on `[class*="sidebarCol"]` and
  `[class*="centerCol"]` themselves (this was a real bug in the revision before
  this one: the ambience was measured as *painted* and was in fact invisible).
  The washes follow the surfaces' own palette rather than a fixed colour, so the
  light still moves if the palette does.
- The hand-drawn kit: the composer card, the sidebar's action button and the
  navigation rows take uneven four-value corner radii, a 1.5px warm-ink rule
  instead of a hairline, a second outline rotated a third of a degree off true,
  and an ink shadow whose blur is zero — a drawn edge, not a lit one. The
  composer's `:focus-within` ring re-states itself on top of all of it, so the
  keyboard focus indicator is never eaten by the drawing (checked by focusing the
  input in `verify-skin.mjs`, not by reading the rule).
- The badge beside the title is the reference's stamp: an organic radius, a
  coral wash, a double ring and a four-degree tilt. The shell already renders
  one there, so it is dressed rather than hidden.
- The main title reads **寻找真心之旅!!!!!** — the sentence from the shared copy
  rules, plus five exclamation marks that each take their own pen. CSS cannot
  colour one character of a text node, so `brand.js` appends one real `<span>`
  per mark (`data-bang="1"…"5"`) and the sheet paints each one, sets it a size
  down from the title and tips it a few degrees off true. The sentence itself is
  drawn by the slogan's `::before`, so the appended marks land after it and the
  title still reads without the script; the slogan's `::after` carries the
  coloured-pencil stroke the title is drawn on top of, which is why the wrapper
  is made a stacking context of its own — that is the only way a pseudo-element
  can land behind glyphs it does not own. The marks that carry text are
  deliberately not the bright gradient: on paper it measures 2.19–2.94:1, under
  AA even for large text, so it stays on the mark, the wordmark, the badge and
  the ambience, and the title uses the palette's ink and a deepened five-pen
  ramp (`--diva-bang-1…5`, 3.02–5.11:1, checked in `verify-skin.mjs`).
- The brand row is DIVA's, so the build version chip under the wordmark is
  hidden (`[class*="localBuildBrand"] [class*="buildVersion"]`). The version is
  still readable in 设置 → 通用设置 (「当前版本」). The shell fixes that row at
  24px, so nothing around it moves: measured, the identity row and the
  navigation keep their geometry and the wordmark centres in the slot the chip
  vacated.
- The built-in DSH themes ship empty token maps, so for `vivy` this stylesheet
  *is* the palette: it defines every official `--dsw-alias-*` /
  `--dsw-specific-*` on the pinned sheet (`node check-tokens.mjs` diffs the
  two). For `diva` it paints only the chrome listed above.
- Loaded as the `dsh-vivy-studio` bundle of the active profile. The host
  `webServer.tapIndex` injects one `<style>` and one `<script>` into
  `index.html`; no React tree is patched.
## Sharing the surface with another skin

`dsh-skin-manager` (when installed) marks the selected skin as `data-dsh-skin`
on `<html>` and, for every skin but `vivy`, layers that skin's tokens on `body`
as inline variables. The Fluorite palette blocks in `theme.css` therefore apply
only while that attribute is `vivy` or absent: without that scoping, a ported
palette's 32 inline tokens would sit on top of these 112 and leave the
remaining ones — tooltips, menus, diffs, previews — painting paper over a
foreign skin.

The `--vivy-*` vocabulary, the fonts and the brand lockup are deliberately *not*
scoped: the gem, wordmark, slogan and welcome copy belong to this plugin
whichever skin is selected, and the dark vocabulary stays mode-aware under any
skin. The gem artwork (`--vivy-mark`) and the ambient haze (`--vivy-haze`) are
tokens rather than literals so the accent can move without leaving teal behind.
With the manager uninstalled the attribute is never set, so this sheet is
Fluorite, exactly as it was before there was a second skin.

`diva` is the one skin that keeps the attribute *and* takes its palette from
elsewhere: the manager registers it as a light theme, and this sheet paints the
gradient, the paper and the hand-drawn kit on top of the `diva` id without
redefining a single alias token for it. That split is checked from both sides —
`verify-skin.mjs` asserts the Fluorite palette does **not** follow the `diva`
attribute, and the manager's own verification asserts the registered palette is
what paints the canvas.

There is deliberately no rail across the top of the window. The first version of
`diva` drew a two-pixel gradient strip there; it read as a band stuck to the
chrome rather than part of the page, so it was removed. The gradient now only
ever sits on something — the mark, the wordmark, the badge, the ambience.

`verify-skin.mjs` parks the manager on `vivy` for its run and then drives
`data-dsh-skin` itself to read every state; the manager's verification covers
the palettes through the manager, including its default.

## Differences from upstream

| Upstream | Here | Why |
| --- | --- | --- |
| product name `Nierland` | `DIVA` | this workbench is not the Vivy Studio application |
| welcome copy described the `vivy.exe` build/distribution lifecycle | describes this workbench, and keeps the shell's name apart from the persona speaking in it | the upstream text is not true of this instance |
| `div[class*="turnStatus"]` restyle with a `Seeking.....` overlay | the running label is recoloured through `--dsw-alias-label-deep-diving*`, and the whale mask follows it | DSH 0.2.1 deleted the `turnStatus` class, and the label now carries the live elapsed clock, which a copy overlay would drop; the overlay is kept, commented out, in `theme.css` |
| `ellipse[fill="#6187D8"]` recolour | removed | the glyph draws a single `currentColor` path now, and the skin hides it anyway |
| 89 official tokens | 112 | the sheet gained 23 tokens (diff surfaces, document preview, menu, turn trigger, switch, …) after the skin was written |
| sidebar identity taken to be the official wordmark SVG | the local-build identity is rebuilt too: gem mark, DIVA wordmark, and the version chip dropped | in a source checkout the sidebar renders `localBuildTitle` + `buildVersion` instead of the wordmark, so upstream's rules matched nothing and the row read `DSH 本地构建`; the version itself stays visible in 设置 → 通用设置 (「当前版本」) |
| `[class*="dialog"] h2[class*="title"]`, `[class*="copy"] p` | anchored with `:has([class*="copy"] p)` | those prefixes also match `turnErrorCopy`, `signedOutCopy`, `copyButton` and any modal heading, so upstream's rules would rewrite other dialogs' titles and could blank other text |
| `brand.js` replaced only `DeepSeek Harness` | replaces the local-build names too | a source build writes the interface-language name, so the title stayed `DSH 本地构建` |
| one teal accent; gem and haze colours inlined in the SVG data URIs | the gem artwork and the ambience are `--vivy-mark` / `--vivy-haze` tokens | the accent can move without leaving teal behind in the mark or the glow |
| one skin | a second skin, `diva`: white surfaces from a palette the manager registers, plus a hand-written display face and a gradient chrome layer here (glows, masked gem, gradient wordmark) | the workbench needed a light, white look next to Fluorite, not another tint of it — and a warmer, less corporate voice than the serif Fluorite hero |
| `brand.js` renamed the document title only | it also appends the main title's five exclamation marks | each mark needs its own colour, and one text node cannot be coloured per character |
| flat panel list, one row per global panel | the DIVA panels are folded under a `VIVY心核` header that is drawn as a panel row in the interface face, the resident `插件` / `自动化任务` rows stay outside it and above it | the list slot's contract carries no group field and exposes no seam for one, so the header is a DOM enhancement of the nav React owns; it is inserted as a sibling of the rows, the members are only marked, and the one resident row the shell files behind the group (`自动化任务` shares its sort `order` with two members) is moved in front of the header |
| no verification script | `verify-skin.mjs` | every hook above is a shell internal; the script fails loudly when a DSH upgrade moves one |

## Files

| File | Role |
| --- | --- |
| `index.js` | host plugin: `webServer.tapIndex`, product name, favicon, title, and the inlining of the lettering subset |
| `theme.css` | the Fluorite palette, lockup and copy, and the white skin's paper, hand-drawn kit, lettering and gradient layers |
| `brand.js` | renames the document title when the shell rewrites it, and appends the main title's five exclamation marks |
| `sidebar-core.js` | inserts the `VIVY心核` group header into the shell's panel list, keeps the resident rows above it, and keys the group's open/shut and wide/rail state off two attributes on the list |
| `fonts/DivaWenKai-brand.woff2` | the 48-glyph LXGW WenKai TC subset the lettering face is cut from (OFL-1.1, licence beside it) |
| `fonts/README.md` | where that subset came from and the exact `pyftsubset` command to rebuild it |
| `cordis.patch.yml` | inserts the plugin into the profile tree |
| `check-tokens.mjs` | token-coverage check against the pinned DSH sheet |
| `verify-skin.mjs` | live DOM checks against a running shell (Playwright), including the `data-dsh-skin` scoping matrix |

## Check

```sh
node check-tokens.mjs
```

Offline: the stylesheet covers all 112 official tokens on the pinned sheet.

```sh
PANEL_URL="http://127.0.0.1:3082/?token=…" node verify-skin.mjs
```

Live: 93 assertions against a running shell — palette in both schemes, the
sidebar gem and DIVA wordmark in both layout states, the hidden whale, the
hidden version chip and the geometry it leaves behind, the main title (lettering,
ink, the pencil stroke behind it, five differently coloured marks a size down
from it, AA-large contrast of each pen), headings keeping the shell's type,
the absence of
the old top rail, and that a modal which is *not* the welcome notice keeps its
own title and text. It drives the `VIVY心核` group through a real click rather than
trusting the sheet: one header reading the product name, sitting directly above the
first member, membership counted against the rows the shell rendered minus the
resident ones (so a pinned or unpinned panel moves the number), the resident rows
unmarked and still visible while the group is shut, the members hidden and
`aria-expanded="false"` and the state stored while shut, the header stepping out in
the rail with the members keeping the shell's own 36px row, 0px indent and 18px
glyph, and the shut state coming back after a reload. The cozy layer is measured
rather than assumed: that the
lettering subset is inlined and that no build placeholder survives into the
served sheet, that the face actually decodes and draws its own glyphs (two
advance widths, one against a font that does not exist — a subset that lost its
glyphs still "loads"), that the canvas and the sidebar paint fibre, that the
composer and the sidebar action come back with four distinct corner radii, a
warm-ink rule, a zero-blur ink shadow and a second askew outline, that the
stamp is rotated and double-ringed, that the keyboard focus ring still lands on
the composer when it is actually focused, and that text over the darkest overlap
of the weave keeps 15.3:1 (ink) and 5.5:1 (secondary). It prints the failing hook
and writes screenshots plus `assertions.json` to `$TMPDIR/diva-skin-verify`.
It parks the skin manager on `vivy`, injects the stylesheet this checkout holds
(so it verifies the file, not whatever revision the running process loaded at
boot), and then drives `data-dsh-skin` itself: Fluorite, the gradient and
hand-written layers, another skin's suppression of the palette, and the dark
vocabulary all get measured. Chrome and Playwright are required; the script
finds Playwright in the DSH checkout's pnpm store. Use the token `dsh web` logs
at boot. Run it after a DSH upgrade: the skin depends on class prefixes and
markup that DSH does not promise.

The layout checks compare against the *plugin-free* shell measured in the same
run, never against the served page: once the running process has been restarted
onto this revision, the served page already hides the chip and is no longer a
baseline.

## Disable

Drop `dsh-vivy-studio` from `dsh.profile.bundles` in the profile's
`package.json`, drop the matching `link:` dependency and `node_modules` symlink,
and restart. Nothing outside this directory and that manifest is
needed to remove the skin; the manifest's previous revision is kept beside it.

## Provenance and license

This repository was one module inside the `dsh-superagent-template` workspace and is now versioned on its own.

- **Upstream**: [mastwet/vivy-studio](https://github.com/mastwet/vivy-studio) — original author: mastwet.
- **Bundled font**: `fonts/DivaWenKai-brand.woff2` is derived from LXGW WenKai and ships under the SIL Open Font
  License; the license text is kept at [fonts/LXGWWenKai-OFL.txt](fonts/LXGWWenKai-OFL.txt).
