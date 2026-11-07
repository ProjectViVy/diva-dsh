import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const name = "vivy-studio-skin"
export const inject = ["webServer"]

/* Single source of truth for the product name. The document title, the client
   rename script and the sidebar wordmark (via the __VIVY_PRODUCT__ token in
   theme.css) all derive from this constant. */
const PRODUCT = "DIVA"

/* Fluorite gem tab icon, matching the sidebar mark. Inline SVG because a
   browser icon cannot read the sheet's CSS variables; the two fills mirror the
   fluorite pair in theme.css. */
const GEM =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'>" +
  "<path fill='#2aa8a4' d='M10 1.6 18.4 10 10 18.4 1.6 10Z'/>" +
  "<path fill='#fbf7f0' d='M10 6.3 13.7 10 10 13.7 6.3 10Z'/>" +
  "</svg>"

const here = dirname(fileURLToPath(import.meta.url))

/* The lettering subset travels as a data URI. The panel exposes no route a
   plugin could serve an asset from, and a local build must not fetch a font
   from anywhere — so the 5.7 KB subset is read once and inlined. If it is
   missing, the whole @font-face is dropped and the stack falls through to the
   system kai in `--diva-letter`; a broken asset degrades the type, it does not
   take the skin down. */
function withLettering(css) {
  let uri
  try {
    const bytes = readFileSync(join(here, "fonts", "DivaWenKai-brand.woff2"))
    uri = `data:font/woff2;base64,${bytes.toString("base64")}`
  } catch {
    return css.replace(/@font-face\s*\{[^}]*__DIVA_WENKAI__[^}]*\}\s*/, "")
  }
  /* Anchor on the declaration, not on the bare token: the comment above the
     block mentions the token too, and replacing the first occurrence would have
     put 7 KB of base64 inside a comment and left the `src` broken. */
  return css.replace('url("__DIVA_WENKAI__")', () => `url("${uri}")`)
}

const themeCss = withLettering(
  readFileSync(join(here, "theme.css"), "utf8").replace(/__VIVY_PRODUCT__/g, PRODUCT),
)
const brandJs = readFileSync(join(here, "brand.js"), "utf8")
const coreJs = readFileSync(join(here, "sidebar-core.js"), "utf8")

const FAVICON = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(GEM)}" />`

function withFavicon(html) {
  const official = /<link[^>]*\brel="icon"[^>]*>/i
  if (official.test(html)) return html.replace(official, FAVICON)
  const head = /<head(?:\s[^>]*)?>/i.exec(html)
  if (head === null) return html + FAVICON
  const at = head.index + head[0].length
  return html.slice(0, at) + FAVICON + html.slice(at)
}

function injectSkin(html) {
  const titled = withFavicon(
    html.replace(/<title>[^<]*<\/title>/i, `<title>${PRODUCT}</title>`),
  )
  /* One script tag for both enhancements: the shell's index has no slot for a
     second plugin asset, and verify-skin.mjs reads back exactly this tag. The
     separator is a semicolon, not a newline — two parenthesised IIFEs with no
     statement terminator between them parse as one call chain, and the second
     one is then never invoked. */
  const snippet =
    `<style data-plugin="dsh-vivy-studio">${themeCss}</style>` +
    `<script data-plugin="dsh-vivy-studio">window.__VIVY_PRODUCT__=${JSON.stringify(PRODUCT)};${brandJs};\n${coreJs}</script>`
  const body = /<body(?:\s[^>]*)?>/i.exec(titled)
  if (body === null) return titled + snippet
  const at = body.index + body[0].length
  return titled.slice(0, at) + snippet + titled.slice(at)
}

export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.tapIndex((html) => injectSkin(html)),
    "vivy-studio: fluorite theme and product identity",
  )
}
