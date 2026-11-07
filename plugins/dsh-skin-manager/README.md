# dsh-skin-manager

A 皮肤 (Skins) section in this panel's Settings: one gallery that switches the
whole shell between the warm-paper **diva** skin (the default), the **vivy**
fluorite skin, and four palettes ported from
[`hust-open-atom-club/oh-dsh`](https://github.com/hust-open-atom-club/oh-dsh)
(`plugins/skins`, branch `dsh-0.1.5-rc.1-upgrade`, commit `9a428a8`).

- **Panel**: `设置` → `皮肤`, next to `通用设置`. Six tiles, each with a palette
  preview, its name and whether it follows the shell's light/dark preference or
  forces one scheme.
- **Stored**: `$DSH_HOME/skin-manager/preferences.json` — `{ activeId,
  fallbackTheme }`, the upstream file format, written atomically through
  `PUT /dsh-skin-manager/api/preferences`. A choice survives a reload and
  restarts with the shell; with nothing stored the panel lands on `diva`.
- **Applied**: five of the six are registered with the shell's theme service
  (`ctx.theme.register`) and selected with `setTheme`, so their alias tokens
  arrive as inline variables on `body` — `diva` among them, which is why the
  light skin pins its own `colorScheme: "light"` and stays light even when the
  shell's preference is dark. `vivy` is the exception: it is *not* registered,
  it is the palette of the `dsh-vivy-studio` stylesheet, selected by a
  `data-dsh-skin` attribute on `<html>` (see that plugin's README). The
  attribute is set for every skin, so `dsh-vivy-studio` can paint its gradient
  layer for `diva`; the Fluorite palette applies only while the attribute reads
  `vivy` or is absent, so no other skin ever inherits paper or night ink.
- **Boot**: the host half stamps the stored skin into the served document, so
  the first paint already carries it rather than flashing another palette until
  the browser half loads.

## Skins

| id | name | scheme | tokens |
| --- | --- | --- | --- |
| `diva` | diva | light, pinned — warm paper either way — **the default** | 112 |
| `vivy` | vivy | follows the shell's light/dark preference | — (the stylesheet) |
| `oh-dsh-skin-deep-current` | Deep Current | dark |
| `oh-dsh-skin-jade-circuit` | Jade Circuit | dark |
| `oh-dsh-skin-porcelain` | Porcelain | light |
| `oh-dsh-skin-ember-dusk` | Ember Dusk | dark |

The four ported palettes (32 tokens each, 128 total) are carried verbatim from
upstream — `tools/extract-catalog.mjs` re-extracts them from an upstream
checkout rather than asking anyone to retype them.

`diva` is written here instead, and it is a full palette rather than a
32-token overlay: warm paper (`#fffdfa` for the canvas, `#fbf6f1` / `#f6f0ea`
for cards, panels and menus) separated by warm-ink hairlines at 8–24% of
`rgb(45 32 25)`, ink `#241c16` at 16.5:1 on that paper, a coral `#ea5560` that
fills buttons (3.6:1 under white text), a deeper rose `#cf3f63` for links and
accent text (4.6:1), and `#ff9538 -> #ff6f61 -> #ff5c8a` held back for the
gradient accents that `dsh-vivy-studio` paints on top of the `diva` skin id.
Every value is a literal: a registered palette is applied before any stylesheet
can define a variable, so a `var()` here would resolve to nothing.

The pass that warmed those 49 values was hue-only and every swap was measured
before it was made — `node tools/warm-diva-palette.mjs` holds the map and prints
the ratios, and running it with no arguments afterwards is the check that the
palette is still the one that was measured (label-primary 17.61 -> 16.51,
label-secondary 5.73 -> 5.94, label-tertiary and caption 3.64 -> 3.94, menu
icon 6.98 -> 6.95, dimmed 1.97 -> 1.98). No swap lowers contrast; the two label
tones that carry meaning move up. Pass `--write` to re-apply after a merge.

`vivy` is the one skin this panel does not carry a palette for. It is
`dsh-vivy-studio`'s scoped stylesheet, and the panel only records that it is
selected and marks the document.

## Differences from upstream

| upstream `plugins/skins` | here | why |
| --- | --- | --- |
| data root from the `ohDshSurface` service | `$DSH_HOME` | that service only exists inside the Oh-DSH shell bundles; plain DSH has none |
| browser half built for the 0.1.5 client-plugin contract (`dsh.client.inject`, a bundled React module, `@deepseek-ai/dsh-client-store`) | hand-written `window.__ModuleLoader__` module with `ctx.slots`, no build step | the 0.1.5 client model is not what this shell loads; `dsh-mempalace` is the local precedent |
| a row inside `通用设置` (`settings.general.item`) | its own `设置` section (`settings.section`) | the placement chosen for this deployment |
| four palettes, no own skin | two DIVA entries — `diva` (default) and `vivy` | the deployment has skins of its own; their brand, copy and stylesheet stay owned by `dsh-vivy-studio` |
| `tui-adapter.ts`, `tuiColors()` | not ported | this panel has no TUI surface |
| migration from the legacy `desktop-skins.json` | not ported | no such file exists here; the file format is the same |
| same-origin check on writes | same-origin **and** loopback `Host` check | DNS rebinding would otherwise pass the origin check; the panel is served on loopback |
| preference read in the browser half only | plus a boot-time attribute in the served document | avoids a first-paint flash |
| reaction to `theme/change` only | plus a bounded post-boot patrol | see below |
| a malformed or oversized body answers `500` | unchanged | kept faithful to upstream; the panel reports a failed save either way |

## Two shell behaviours this plugin works around

Both were measured against this shell, not assumed:

1. **`ThemeRuntime.setTheme(id)` returns early when `id` is already in force.**
   So re-selecting the same skin cannot repaint a document that something else
   overwrote. `forceRepaint()` steps through another *registered* skin and back
   inside a single task — only the final state is ever painted, and custom ids
   are never persisted into the shell's own preference, so the user's
   light/dark setting is untouched.
2. **The shell applies its own stored preference when its settings document
   arrives, and that application lands *after* the `theme/change` event
   announcing it.** Reacting to the event alone loses the race and leaves the
   canvas on the shell's theme while the panel still shows the skin. The
   browser half therefore patrols the document for a few passes after each
   imprint (7 passes, ~2.2 s, bounded by a re-assertion budget) and re-applies
   on drift. Once the patrol retires it stays out of the way, which is what
   lets the division of labour above work: the attribute belongs to whichever
   skin is selected, and after boot nothing rewrites it behind your back.

While a scheme-forcing skin is selected, the shell's own 外观 light/dark choice
is re-imposed on by that skin — `Deep Current`, `Jade Circuit` and `Ember Dusk`
are dark, `Porcelain` is light. Upstream behaves the same way. Selecting `vivy`
(or another skin) hands the scheme back, restored from `fallbackTheme`.

## Check it

```sh
PANEL_URL="http://127.0.0.1:3082/?token=…" node verify-skin-manager.mjs
```

84 assertions against the running panel: the preference route (round-trip,
cross-origin and forged-`Host` rejection, invalid ids and fallback themes,
oversized bodies, disallowed methods, and that rejected writes change
nothing), the boot attribute in the served document, the settings section and
its six tiles and their accent swatches, each skin's document attribute,
inline tokens, canvas colour and persisted value, a full page reload landing
back on the stored skin, and an empty preference landing on the shipped
default (`diva`) with the tile selected. The contrast checks read the paper
base out of the registered palette rather than a literal, so the ink (16.5:1),
secondary (5.9:1) and link (4.6:1) ratios move with it.
It parks the panel back on the preference it found, and exits non-zero on any
failure. Screenshots and `assertions.json` land in `$TMPDIR/skin-manager-verify`.

Uncaught exceptions and console errors are counted separately, and every
console error is attributed by URL before it is blamed: another plugin in this
profile (`dsh-asr`) answers 404 on its own catalog endpoint, so a run reports
those as *another plugin's* and fails only on what belongs to this panel.

The skin stylesheet has its own verification in `dsh-vivy-studio`
(`verify-skin.mjs`), 82 assertions covering both accents, the gem and haze
tokens that follow them, the paper, the lettering face and the scoping matrix;
it parks this manager on `vivy` for its run, so the two scripts can both be run
at any time.

## Turn it off

Remove `dsh-skin-manager` from the profile's `dsh.profile.bundles` and restart.
The stored preference file is then unused and harmless; `dsh-vivy-studio` falls
back to its own palette because the `data-dsh-skin` attribute is never set.

## Provenance and license

This repository was one module inside the `dsh-superagent-template` workspace and is now versioned on its own.

- **Upstream**: [hust-open-atom-club/oh-dsh](https://github.com/hust-open-atom-club/oh-dsh) — the four palettes
  (32 tokens each, 128 total) are carried verbatim from upstream. Original author: hust-open-atom-club.
  License: MIT.
- **Built-in `vivy` skin**: original work of this repository.
