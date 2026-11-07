# The lettering subset

`DivaWenKai-brand.woff2` is the face `theme.css` declares as **Diva Lettering**
and uses for the wordmark, the main title 寻找真心之旅, its five exclamation
marks, the STUDIO badge and the onboarding title. It is 5,744 bytes and covers
48 characters — exactly the ones `brand-chars.txt` lists, nothing else.

It is embedded rather than fetched. The panel exposes no static route a plugin
could serve an asset from, and this build must not reach for a CDN, so
`index.js` reads the file once and rewrites the `url("__DIVA_WENKAI__")` in
`theme.css` into a `data:font/woff2;base64,…` URI (7,659 bytes of base64). If the
file is missing, `index.js` drops the whole `@font-face` block instead and the
stack in `--diva-letter` falls through to the system kai.

## Where it came from

- Source: `WenKai.ttf` — **LXGW WenKai TC, version 1.330** (13,061,420 bytes,
  22,348 glyphs), taken from a `diva` oil-ui workdir that already existed on this
  machine (`~/Desktop/.oil-ui/diva/assets/fonts/WenKai.ttf`).
- Upstream: [lxgw/LxgwWenKai](https://github.com/lxgw/LxgwWenKai), licensed
  **SIL Open Font License 1.1**. `LXGWWenKai-OFL.txt` travels beside this file,
  copied from the same source directory (`WenKai-OFL.txt`, byte-identical).
- Subset with `fontTools` 4.68.0 + `brotli`. The resulting face keeps the
  upstream family name, version and timestamps; only the glyph set is cut down.

## Rebuilding it

```sh
FONTS=/Users/mastwet-macmini/Desktop/dsh-superagent-template/plugins/dsh-vivy-studio/fonts
VENV=/Users/mastwet-macmini/Desktop/.oil-ui/diva/font-venv/bin/python   # any python with fontTools + brotli

"$VENV" -m fontTools.subset \
  "$HOME/Desktop/.oil-ui/diva/assets/fonts/WenKai.ttf" \
  --text-file="$FONTS/brand-chars.txt" \
  --flavor=woff2 \
  --output-file="$FONTS/DivaWenKai-brand.woff2"
```

`brand-chars.txt` is the source of truth, not this file: edit it, re-run the
command, and check that the sizes below still hold. Re-running it reproduces the
same coverage (48 mapped characters, 56 glyphs, 5,744 bytes); the exact bytes can
differ, because the WOFF2 stream is not required to be byte-reproducible. Verify
with, for instance:

```sh
"$VENV" -c 'from fontTools.ttLib import TTFont; f=TTFont("'"$FONTS"'/DivaWenKai-brand.woff2"); print(f["maxp"].numGlyphs, len(f.getBestCmap()), len(open("'"$FONTS"'/DivaWenKai-brand.woff2","rb").read()))'
# -> 56 48 5744
```

## Why only 48 characters

The subset is inlined into every `index.html` the plugin touches, so its size is
paid on every page load. Measured on the full face: **≈167 bytes per hanzi** in
WOFF2, which projects to **≈572 KB (≈763 KB as base64)** for the 3,500 common
hanzi — half a megabyte of base64 in the document to render a handful of
headings. So the rule is:

| Use | Face | Why |
| --- | --- | --- |
| fixed brand copy (wordmark, title, marks, badge, onboarding title) | `--diva-letter`, this subset | the text is known, so coverage is provable |
| arbitrary headings (`h1`/`h2`/`h3` in the panel: session titles, message headings) | the sans stack | a subset cannot be complete here, and a whole document of kai reads as decoration rather than as type |
| body copy | the sans stack | a paragraph of kai is tiring to read |

Adding a character to fixed copy means editing `brand-chars.txt` and rebuilding.
Arbitrary text is never a reason to grow the subset.
