/**
 * Skin manager — browser half.
 *
 * Ported from hust-open-atom-club/oh-dsh `plugins/skins` (browser half). The
 * skin catalog, the registry/imprint semantics and the preference model are
 * that plugin's; the panel had to be rewritten because it was written against
 * the 0.1.5 client-plugin contract (`dsh.client.inject` + a bundled React
 * module + `@deepseek-ai/dsh-client-store`), while this shell loads plugin
 * clients through `window.__ModuleLoader__` and contributes UI through
 * `ctx.slots`. See README.md for the full list.
 */
window.__ModuleLoader__.load({
  id: 'dsh-skin-manager',
  factory: (require) => {
    const React = require('react')
    const { createElement: h, useEffect, useSyncExternalStore } = React

    /** Attribute the skin (and the vivy stylesheet's palette) keys off. */
    const ATTRIBUTE = 'data-dsh-skin'
    const API = '/dsh-skin-manager/api/preferences'
    const BUILTIN_THEMES = ['light', 'dark', 'system']
    /**
     * The skin a fresh install (or a cleared preference) lands on: diva, the
     * white palette above. `vivy` is the one catalog entry that is not
     * registered here — it is an attribute-scoped stylesheet in
     * `dsh-vivy-studio`, and it follows the shell's light/dark preference
     * instead of forcing one.
     */
    const DEFAULT_SKIN_ID = 'diva'
    const STYLE_ID = 'dsh-skin-manager-styles'

    /* The panel chrome. Every colour resolves through a --dsw-alias-* token, so
       the settings surface follows whichever skin is active. */
    const CSS = `
.dsm-section{display:flex;flex-direction:column;gap:12px;max-width:720px;color:var(--dsw-alias-label-primary)}
.dsm-title{margin:0;font-size:16px;line-height:24px;font-weight:500}
.dsm-intro{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary)}
.dsm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:9px;margin-top:2px}
.dsm-tile{position:relative;display:flex;min-width:0;flex-direction:column;padding:0;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;text-align:left;transition:border-color 120ms ease,box-shadow 120ms ease,transform 120ms ease}
.dsm-tile:hover:not(:disabled){border-color:var(--dsw-alias-border-l3);transform:translateY(-1px)}
.dsm-tile:disabled{cursor:wait;opacity:.58;transform:none}
.dsm-tile:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsm-tile[data-selected='true']{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.dsm-swatch{display:block;height:58px;background-size:cover;background-position:center;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsm-tile-body{display:flex;flex-direction:column;gap:2px;padding:8px 10px 10px}
.dsm-name-row{display:flex;align-items:center;justify-content:space-between;gap:6px}
.dsm-name{font-size:13px;font-weight:600;line-height:18px}
.dsm-badge{flex:none;font-size:10.5px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-brand-primary)}
.dsm-summary{font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.dsm-note{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsm-error{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}
`

    const TEXT = {
      zh: {
        nav: '皮肤',
        title: '皮肤',
        intro: '给这个工作台换一套配色。选择存在本机，刷新后仍在；diva 是本机默认皮肤——暖白的纸面、一道橙粉渐变，加一点手写；vivy 则跟随系统的浅色／暗色。',
        active: '当前',
        saveFailed: '保存失败，已退回原来的皮肤。',
        loadFailed: '读取皮肤偏好失败，正在使用默认皮肤。',
        unknownSkin: '未知皮肤',
      },
      en: {
        nav: 'Skins',
        title: 'Skins',
        intro: 'Recolour this workbench. The choice is stored on this machine and survives a reload; diva is the default — warm paper, one orange-pink gradient and a hand-drawn line — and vivy follows light/dark.',
        active: 'Active',
        saveFailed: 'Could not save; reverted to the previous skin.',
        loadFailed: 'Could not read the skin preference; using the default skin.',
        unknownSkin: 'Unknown skin',
      },
    }

    function language() {
      const tag = typeof document === 'undefined' ? 'zh' : document.documentElement.lang
      return typeof tag === 'string' && tag.toLowerCase().startsWith('en') ? 'en' : 'zh'
    }

    function text(key) {
      const table = TEXT[language()] ?? TEXT.zh
      return table[key] ?? TEXT.zh[key] ?? key
    }

    function summaryOf(skin) {
      if (typeof skin.summary === 'string') return skin.summary
      return skin.summary[language()] ?? skin.summary.zh
    }

    /**
     * diva — the paper skin, and the one this deployment ships as the default.
     * It is registered here rather than scoped in a stylesheet: with
     * colorScheme "light" the shell pins a light interface even when its own
     * preference is dark, and the palette travels as inline body variables.
     * Nothing in it is a `var()` reference, because a registered palette is
     * applied before any stylesheet can define one.
     *
     * The colours are one system: paper surfaces and warm-ink hairlines (the
     * neutrals are warm rather than plum-tinted, so the sheet reads as paper
     * instead of screen), a coral that fills buttons (`#ea5560`, 3.6:1 against
     * white text), a deeper rose that carries text (`#cf3f63`, 4.6:1 on
     * paper), and `#ff9538 -> #ff6f61 -> #ff5c8a` reserved for the gradient
     * accents that `dsh-vivy-studio` paints on top of the `diva` skin id.
     *
     * Every text-bearing swap in this palette was measured: changing a hue
     * never lowered its contrast against the new base (`#fffdfa`), and the
     * ratios are recorded in `dsh-vivy-studio/README.md`.
     */
    const DIVA_SKIN = {
      id: "diva",
      scheme: "light",
      name: "diva",
      summary: { zh: "暖白纸面 + 手写 · 浅色", en: "Warm paper, hand-drawn · light" },
      preview: "linear-gradient(135deg, #fffdfa 0%, #fffdfa 28%, #ff9538 40%, #ff6f61 52%, #ff5c8a 64%, #fffdfa 78%, #fffdfa 100%)",
      accent: "#ff6f61",
      tokens: Object.freeze({
          "--dsw-alias-bg-base": "#fffdfa",
          "--dsw-alias-bg-layer-1": "#ffffff",
          "--dsw-alias-bg-layer-2": "#fbf6f1",
          "--dsw-alias-bg-layer-3": "#f6f0ea",
          "--dsw-alias-bg-mask-1": "rgba(45, 32, 25, 0.3)",
          "--dsw-alias-bg-mask-2": "rgba(45, 32, 25, 0.14)",
          "--dsw-alias-bg-mask-3": "rgba(45, 32, 25, 0.48)",
          "--dsw-alias-bg-mask-photo": "rgba(30, 22, 18, 0.88)",
          "--dsw-alias-bg-mask-drop": "rgba(255, 255, 255, 0.72)",
          "--dsw-alias-bg-module-platform": "#f6f0ea",
          "--dsw-alias-bg-multi-select": "rgba(255, 111, 97, 0.12)",
          "--dsw-alias-bg-overlay": "#ffffff",
          "--dsw-alias-bg-skeleton": "rgba(45, 32, 25, 0.055)",
          "--dsw-alias-border-inverted2": "transparent",
          "--dsw-alias-border-inverted": "transparent",
          "--dsw-alias-border-l1": "rgba(45, 32, 25, 0.08)",
          "--dsw-alias-border-l2-darkmode-thin": "rgba(45, 32, 25, 0.1)",
          "--dsw-alias-border-l2": "rgba(45, 32, 25, 0.13)",
          "--dsw-alias-border-l3": "rgba(45, 32, 25, 0.18)",
          "--dsw-alias-border-l4": "rgba(45, 32, 25, 0.24)",
          "--dsw-alias-brand-primary": "#ea5560",
          "--dsw-alias-brand-primary-invert": "#ffffff",
          "--dsw-alias-brand-primary-new-colorprimary-new-color": "#ea5560",
          "--dsw-alias-brand-text": "#cf3f63",
          "--dsw-alias-button-contrast-fill": "#241c16",
          "--dsw-alias-button-elevated-fill": "#ffffff",
          "--dsw-alias-button-floating-fill": "#ffffff",
          "--dsw-alias-button-floating-hover": "#f4f0f2",
          "--dsw-alias-button-ghost-active-border": "#ea5560",
          "--dsw-alias-button-ghost-active-fill": "rgba(255, 111, 97, 0.1)",
          "--dsw-alias-button-ghost-active-hover": "rgba(255, 111, 97, 0.16)",
          "--dsw-alias-button-info-fill": "#ea5560",
          "--dsw-alias-button-info-hover": "#d0435a",
          "--dsw-alias-button-primary-dimmed": "rgba(255, 111, 97, 0.3)",
          "--dsw-alias-button-primary-fill": "#ea5560",
          "--dsw-alias-button-primary-hover": "#d0435a",
          "--dsw-alias-button-tool-bar-fill-invisible": "rgba(45, 32, 25, 0.34)",
          "--dsw-alias-button-tool-bar-fill": "rgba(45, 32, 25, 0.46)",
          "--dsw-alias-button-tool-bar-hover": "rgba(45, 32, 25, 0.56)",
          "--dsw-alias-interactive-bg-active": "rgba(255, 111, 97, 0.16)",
          "--dsw-alias-interactive-bg-hover": "rgba(255, 111, 97, 0.07)",
          "--dsw-alias-interactive-bg-hover-accent": "rgba(255, 111, 97, 0.1)",
          "--dsw-alias-interactive-bg-hover-danger": "rgba(217, 74, 74, 0.08)",
          "--dsw-alias-interactive-bg-hover-solid": "#f6f0ea",
          "--dsw-alias-label-caption": "#8d7c70",
          "--dsw-alias-label-dimmed": "#c1b5a9",
          "--dsw-alias-label-primary": "#241c16",
          "--dsw-alias-label-primary-bluish": "#cf3f63",
          "--dsw-alias-label-primary-dimmed": "#332821",
          "--dsw-alias-label-primary-foreground": "#ffffff",
          "--dsw-alias-label-primary-inverted": "#ffffff",
          "--dsw-alias-label-secondary": "#6f6055",
          "--dsw-alias-label-shimmer": "rgba(45, 32, 25, 0.3)",
          "--dsw-alias-label-tertiary": "#8d7c70",
          "--dsw-alias-markdown-citation": "#f6f0ea",
          "--dsw-alias-markdown-code-block": "#fbf6f1",
          "--dsw-alias-markdown-code-block-banner": "#f1eae2",
          "--dsw-alias-markdown-code-segment-selected": "#ffffff",
          "--dsw-alias-markdown-code-segment-unselected": "#f6f0ea",
          "--dsw-alias-markdown-inline-code": "#fdeef1",
          "--dsw-alias-markdown-placeholder": "#f6f0ea",
          "--dsw-alias-markdown-tag": "#f6f0ea",
          "--dsw-alias-menu-group-header-fill": "rgba(255, 255, 255, 0.94)",
          "--dsw-alias-menu-icon": "#64564b",
          "--dsw-alias-scrollbar-bg-l1": "#ded4c9",
          "--dsw-alias-scrollbar-bg-l2": "#ded4c9",
          "--dsw-alias-scrollbar-hover-l1": "#c8bbad",
          "--dsw-alias-scrollbar-hover-l2": "#c8bbad",
          "--dsw-alias-state-business-primary": "#ea5560",
          "--dsw-alias-state-business-tertiary": "rgba(255, 111, 97, 0.14)",
          "--dsw-alias-state-error-primary": "#d94a4a",
          "--dsw-alias-state-error-secondary": "#e5716f",
          "--dsw-alias-state-idle-primary": "#c1b5a9",
          "--dsw-alias-state-success-primary": "#2f9e6b",
          "--dsw-alias-state-success-secondary": "#55b389",
          "--dsw-alias-state-success-tertiary": "#e2f4ea",
          "--dsw-alias-state-warn-label": "#a8681a",
          "--dsw-alias-state-warn-primary": "#c98318",
          "--dsw-alias-state-warn-secondary": "#d9a248",
          "--dsw-alias-state-warn-tertiary": "#f8ecd8",
          "--dsw-alias-switch-thumb": "#ffffff",
          "--dsw-alias-toast-bg": "#2c2320",
          "--dsw-alias-toast-label": "#ffffff",
          "--dsw-alias-tooltip-bg": "#2c2320",
          "--dsw-alias-tooltip-key-bg": "#443a32",
          "--dsw-alias-turn-trigger-bg": "#fbf6f1",
          "--dsw-alias-turn-trigger-bg-hover": "rgba(255, 111, 97, 0.08)",
          "--dsw-specific-bubble": "#fdeef1",
          "--dsw-specific-bubble-highlight": "#fbdde3",
          "--dsw-specific-input-major": "#ffffff",
          "--dsw-specific-login-input": "#f6f0ea",
          "--dsw-specific-menu": "#ffffff",
          "--dsw-specific-selector": "#f6f0ea",
          "--dsw-specific-sidebar-fill": "#fdf4ef",
          "--dsw-specific-sidebar-nav-item-active": "rgba(255, 111, 97, 0.12)",
          "--dsw-specific-sidebar-nav-item-active-accent": "#ea5560",
          "--dsw-specific-sidebar-nav-item-hover": "rgba(45, 32, 25, 0.05)",
          "--dsw-specific-tip": "#f6f0ea",
          "--dsw-alias-bg-document-preview": "#f6f0ea",
          "--dsw-alias-bg-document-selection": "rgba(255, 111, 97, 0.22)",
          "--dsw-alias-code-diff-added": "rgba(47, 158, 107, 0.12)",
          "--dsw-alias-code-diff-deleted": "rgba(217, 74, 74, 0.12)",
          "--dsw-alias-file-diff-added-bg": "#eef8f2",
          "--dsw-alias-file-diff-added-gutter": "#f5fbf8",
          "--dsw-alias-file-diff-added-marker": "#2f9e6b",
          "--dsw-alias-file-diff-deleted-bg": "#fdeeee",
          "--dsw-alias-file-diff-deleted-gutter": "#fef6f6",
          "--dsw-alias-file-diff-deleted-marker": "#d94a4a",
          "--dsw-alias-label-deep-diving": "#ea5560",
          "--dsw-alias-label-deep-diving-shimmer": "#ff5c8a",
          "--dsw-alias-label-document-preview": "#8d7c70",
          "--dsw-alias-link": "#cf3f63",
      }),
    }

    const OH_DSH_SKINS = [
      {
        id: "oh-dsh-skin-deep-current",
        scheme: "dark",
        name: "Deep Current",
        summary: { zh: "Deep Current · 深色", en: "Deep Current · dark" },
        preview: "linear-gradient(135deg, #071923 0%, #143445 64%, #49c8eb 145%)",
        accent: "#49c8eb",
        tokens: Object.freeze({
          "--dsw-alias-bg-base": "#071923",
          "--dsw-alias-bg-layer-1": "#0b2230",
          "--dsw-alias-bg-layer-2": "#0f2a39",
          "--dsw-alias-bg-layer-3": "#143445",
          "--dsw-alias-bg-overlay": "#193e50",
          "--dsw-alias-bg-module-platform": "#0f2a39",
          "--dsw-alias-border-l1": "rgba(143, 214, 235, 0.08)",
          "--dsw-alias-border-l2": "rgba(143, 214, 235, 0.14)",
          "--dsw-alias-border-l3": "rgba(143, 214, 235, 0.22)",
          "--dsw-alias-brand-primary": "#49c8eb",
          "--dsw-alias-brand-primary-invert": "#06151d",
          "--dsw-alias-brand-text": "#bcecf8",
          "--dsw-alias-button-primary-fill": "#49c8eb",
          "--dsw-alias-button-primary-hover": "#6dd7f2",
          "--dsw-alias-interactive-bg-active": "rgba(109, 215, 242, 0.16)",
          "--dsw-alias-interactive-bg-hover": "rgba(109, 215, 242, 0.09)",
          "--dsw-alias-label-primary": "#e9f8fb",
          "--dsw-alias-label-secondary": "#b9dbe4",
          "--dsw-alias-label-tertiary": "#78a8b5",
          "--dsw-alias-markdown-code-block": "#06151e",
          "--dsw-alias-markdown-inline-code": "#123143",
          "--dsw-alias-scrollbar-bg-l1": "#214b5c",
          "--dsw-alias-scrollbar-hover-l1": "#49c8eb",
          "--dsw-alias-state-error-primary": "#ff7185",
          "--dsw-alias-state-success-primary": "#63d5ad",
          "--dsw-alias-state-warn-primary": "#f4c56a",
          "--dsw-specific-bubble": "#123143",
          "--dsw-specific-input-major": "#0a202c",
          "--dsw-specific-menu": "#103041",
          "--dsw-specific-sidebar-fill": "#061521",
          "--dsw-specific-sidebar-nav-item-active": "#123143",
          "--dsw-specific-sidebar-nav-item-hover": "rgba(233, 248, 251, 0.05)"
        }),
      },
      {
        id: "oh-dsh-skin-jade-circuit",
        scheme: "dark",
        name: "Jade Circuit",
        summary: { zh: "Jade Circuit · 深色", en: "Jade Circuit · dark" },
        preview: "linear-gradient(145deg, #071a16 0 42%, #154435 43% 62%, #52d6a0 150%)",
        accent: "#52d6a0",
        tokens: Object.freeze({
          "--dsw-alias-bg-base": "#071a16",
          "--dsw-alias-bg-layer-1": "#0b241e",
          "--dsw-alias-bg-layer-2": "#102e26",
          "--dsw-alias-bg-layer-3": "#15392f",
          "--dsw-alias-bg-overlay": "#1b493b",
          "--dsw-alias-bg-module-platform": "#102e26",
          "--dsw-alias-border-l1": "rgba(124, 236, 187, 0.08)",
          "--dsw-alias-border-l2": "rgba(124, 236, 187, 0.14)",
          "--dsw-alias-border-l3": "rgba(124, 236, 187, 0.22)",
          "--dsw-alias-brand-primary": "#52d6a0",
          "--dsw-alias-brand-primary-invert": "#071a16",
          "--dsw-alias-brand-text": "#bbf3d8",
          "--dsw-alias-button-primary-fill": "#52d6a0",
          "--dsw-alias-button-primary-hover": "#72e5b4",
          "--dsw-alias-interactive-bg-active": "rgba(114, 229, 180, 0.16)",
          "--dsw-alias-interactive-bg-hover": "rgba(114, 229, 180, 0.08)",
          "--dsw-alias-label-primary": "#e9fbf3",
          "--dsw-alias-label-secondary": "#b9ddce",
          "--dsw-alias-label-tertiary": "#78a795",
          "--dsw-alias-markdown-code-block": "#061510",
          "--dsw-alias-markdown-inline-code": "#14372d",
          "--dsw-alias-scrollbar-bg-l1": "#205240",
          "--dsw-alias-scrollbar-hover-l1": "#52d6a0",
          "--dsw-alias-state-error-primary": "#ff7185",
          "--dsw-alias-state-success-primary": "#52d6a0",
          "--dsw-alias-state-warn-primary": "#f3c966",
          "--dsw-specific-bubble": "#14372d",
          "--dsw-specific-input-major": "#0a211b",
          "--dsw-specific-menu": "#123329",
          "--dsw-specific-sidebar-fill": "#061712",
          "--dsw-specific-sidebar-nav-item-active": "#14372d",
          "--dsw-specific-sidebar-nav-item-hover": "rgba(233, 251, 243, 0.05)"
        }),
      },
      {
        id: "oh-dsh-skin-porcelain",
        scheme: "light",
        name: "Porcelain",
        summary: { zh: "Porcelain · 浅色", en: "Porcelain · light" },
        preview: "radial-gradient(circle at 78% 22%, #b9dcd7 0%, transparent 38%), linear-gradient(145deg, #f8fbfa 0%, #e5efec 100%)",
        accent: "#2d7773",
        tokens: Object.freeze({
          "--dsw-alias-bg-base": "#f3f7f6",
          "--dsw-alias-bg-layer-1": "#f8fbfa",
          "--dsw-alias-bg-layer-2": "#edf4f2",
          "--dsw-alias-bg-layer-3": "#e5efec",
          "--dsw-alias-bg-overlay": "#dce9e6",
          "--dsw-alias-bg-module-platform": "#edf4f2",
          "--dsw-alias-border-l1": "rgba(24, 70, 67, 0.07)",
          "--dsw-alias-border-l2": "rgba(24, 70, 67, 0.12)",
          "--dsw-alias-border-l3": "rgba(24, 70, 67, 0.18)",
          "--dsw-alias-brand-primary": "#2d7773",
          "--dsw-alias-brand-primary-invert": "#f7fbfa",
          "--dsw-alias-brand-text": "#245f5c",
          "--dsw-alias-button-primary-fill": "#2d7773",
          "--dsw-alias-button-primary-hover": "#378b86",
          "--dsw-alias-interactive-bg-active": "rgba(45, 119, 115, 0.14)",
          "--dsw-alias-interactive-bg-hover": "rgba(45, 119, 115, 0.07)",
          "--dsw-alias-label-primary": "#18312f",
          "--dsw-alias-label-secondary": "#405d59",
          "--dsw-alias-label-tertiary": "#718b87",
          "--dsw-alias-markdown-code-block": "#e8f0ee",
          "--dsw-alias-markdown-inline-code": "#dfebe8",
          "--dsw-alias-scrollbar-bg-l1": "#cddeda",
          "--dsw-alias-scrollbar-hover-l1": "#8aaca6",
          "--dsw-alias-state-error-primary": "#c65358",
          "--dsw-alias-state-success-primary": "#418b68",
          "--dsw-alias-state-warn-primary": "#b77b25",
          "--dsw-specific-bubble": "#e8f0ee",
          "--dsw-specific-input-major": "#fbfdfc",
          "--dsw-specific-menu": "#edf4f2",
          "--dsw-specific-sidebar-fill": "#eaf1ef",
          "--dsw-specific-sidebar-nav-item-active": "#ffffff",
          "--dsw-specific-sidebar-nav-item-hover": "rgba(255, 255, 255, 0.6)"
        }),
      },
      {
        id: "oh-dsh-skin-ember-dusk",
        scheme: "dark",
        name: "Ember Dusk",
        summary: { zh: "Ember Dusk · 深色", en: "Ember Dusk · dark" },
        preview: "radial-gradient(circle at 78% 24%, #ff9275 0%, transparent 38%), linear-gradient(145deg, #21161f 0%, #4b3042 100%)",
        accent: "#ff9275",
        tokens: Object.freeze({
          "--dsw-alias-bg-base": "#21161f",
          "--dsw-alias-bg-layer-1": "#2a1b27",
          "--dsw-alias-bg-layer-2": "#342130",
          "--dsw-alias-bg-layer-3": "#40283a",
          "--dsw-alias-bg-overlay": "#4b3042",
          "--dsw-alias-bg-module-platform": "#342130",
          "--dsw-alias-border-l1": "rgba(255, 183, 159, 0.08)",
          "--dsw-alias-border-l2": "rgba(255, 183, 159, 0.14)",
          "--dsw-alias-border-l3": "rgba(255, 183, 159, 0.22)",
          "--dsw-alias-brand-primary": "#ff9275",
          "--dsw-alias-brand-primary-invert": "#23151d",
          "--dsw-alias-brand-text": "#ffd4c7",
          "--dsw-alias-button-primary-fill": "#ff9275",
          "--dsw-alias-button-primary-hover": "#ffad96",
          "--dsw-alias-interactive-bg-active": "rgba(255, 173, 150, 0.16)",
          "--dsw-alias-interactive-bg-hover": "rgba(255, 173, 150, 0.08)",
          "--dsw-alias-label-primary": "#fff0ea",
          "--dsw-alias-label-secondary": "#dfc1cb",
          "--dsw-alias-label-tertiary": "#a98391",
          "--dsw-alias-markdown-code-block": "#1b121a",
          "--dsw-alias-markdown-inline-code": "#3b2636",
          "--dsw-alias-scrollbar-bg-l1": "#563649",
          "--dsw-alias-scrollbar-hover-l1": "#ff9275",
          "--dsw-alias-state-error-primary": "#ff6f82",
          "--dsw-alias-state-success-primary": "#7bd3a6",
          "--dsw-alias-state-warn-primary": "#efbe69",
          "--dsw-specific-bubble": "#3b2636",
          "--dsw-specific-input-major": "#281923",
          "--dsw-specific-menu": "#382331",
          "--dsw-specific-sidebar-fill": "#1c131b",
          "--dsw-specific-sidebar-nav-item-active": "#3b2636",
          "--dsw-specific-sidebar-nav-item-hover": "rgba(255, 240, 234, 0.05)"
        }),
      },
    ]

    /** The catalog: the white diva palette, the one remaining attribute-scoped
        skin (Fluorite, owned by dsh-vivy-studio), then the ported palettes. */
    const CATALOG = [
      DIVA_SKIN,
      {
        id: 'vivy',
        scheme: null,
        name: 'vivy',
        summary: { zh: 'Fluorite · 跟随浅色／暗色', en: 'Fluorite · follows light/dark' },
        preview: 'linear-gradient(135deg,#f4efe6 0 38%,#2aa8a4 38% 52%,#161310 52% 100%)',
        accent: '#2aa8a4',
      },
      ...OH_DSH_SKINS,
    ]

    function skinById(id) {
      return CATALOG.find((skin) => skin.id === id)
    }

    function isBuiltin(value) {
      return BUILTIN_THEMES.includes(value)
    }

    function installStyles() {
      const tag = document.createElement('style')
      tag.id = STYLE_ID
      tag.dataset.plugin = 'dsh-skin-manager'
      tag.textContent = CSS
      document.head.append(tag)
      return () => { tag.remove() }
    }

    /**
     * Owns the skin choice: registers the palettes with the shell's theme
     * registry, marks the selected skin on <html>, and persists the choice
     * through the host half.
     */
    class SkinManager {
      constructor(theme) {
        this.theme = theme
        this.registrations = []
        this.listeners = new Set()
        this.reassertions = 0
        this.reconcileTimer = undefined
        this.forcing = false
        this.warnedAboutShell = false
        this.preferences = { activeId: DEFAULT_SKIN_ID, fallbackTheme: 'system' }
        this.state = { activeId: null, ready: false, busy: false, error: null, foreign: null, revision: 0 }
        this.subscribe = (listener) => {
          this.listeners.add(listener)
          return () => { this.listeners.delete(listener) }
        }
        this.getSnapshot = () => this.state
      }

      publish(patch) {
        this.state = Object.freeze({ ...this.state, ...patch, revision: this.state.revision + 1 })
        for (const listener of [...this.listeners]) listener()
      }

      /** Register the ported palettes; the own skin stays unregistered by design. */
      start() {
        for (const skin of CATALOG) {
          if (skin.tokens === undefined) continue
          this.registrations.push(this.theme.register({
            id: skin.id,
            colorScheme: skin.scheme,
            tokens: skin.tokens,
          }))
        }
        void this.load()
      }

      dispose() {
        if (this.reconcileTimer !== undefined) clearTimeout(this.reconcileTimer)
        for (const registration of this.registrations.splice(0).reverse()) registration()
        this.listeners.clear()
      }

      async load() {
        try {
          const response = await fetch(API, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const stored = await response.json()
          const id = skinById(stored?.activeId) === undefined ? DEFAULT_SKIN_ID : stored.activeId
          this.preferences = {
            activeId: id,
            fallbackTheme: isBuiltin(stored?.fallbackTheme) ? stored.fallbackTheme : 'system',
          }
          this.imprint()
          this.publish({ activeId: this.preferences.activeId, ready: true, error: null })
        } catch (error) {
          console.warn('dsh-skin-manager: preferences could not be read', error)
          this.preferences = { activeId: DEFAULT_SKIN_ID, fallbackTheme: isBuiltin(this.theme.getTheme().preference) ? this.theme.getTheme().preference : 'system' }
          this.imprint()
          this.publish({ activeId: DEFAULT_SKIN_ID, ready: true, error: text('loadFailed') })
        }
      }

      /** Where the document should end up for the stored preference. */
      intended() {
        const skin = skinById(this.preferences.activeId)
        if (skin !== undefined && skin.tokens !== undefined) {
          return { attribute: skin.id, preference: skin.id, tokens: skin.tokens, scheme: skin.scheme }
        }
        return {
          attribute: skin?.id ?? DEFAULT_SKIN_ID,
          preference: this.preferences.fallbackTheme,
          tokens: undefined,
          scheme: undefined,
        }
      }

      /** Point the document and the theme registry at the stored preference. */
      apply(force = false) {
        const goal = this.intended()
        try {
          document.documentElement.setAttribute(ATTRIBUTE, goal.attribute)
          if (force && this.theme.getTheme().preference === goal.preference) this.forceRepaint()
          else this.theme.setTheme(goal.preference)
          return true
        } catch (error) {
          this.publish({ error: text('saveFailed') })
          console.warn('dsh-skin-manager: could not imprint the skin', error)
          return false
        }
      }

      /**
       * Make the presenter paint again. `setTheme` returns early when the
       * preference it is handed is already in force, so a document that drifted
       * while the preference stayed put would never be repainted by re-selecting
       * the same theme. Stepping through another registered skin — inside one
       * task, so only the final state is ever painted — re-runs the presenter
       * without touching the shell's persisted preference, which custom ids
       * never are.
       */
      forceRepaint() {
        const step = CATALOG.find((skin) => skin.tokens !== undefined && skin.id !== this.intended().preference)
        if (step === undefined) return
        this.forcing = true
        try {
          this.theme.setTheme(step.id)
          this.theme.setTheme(this.intended().preference)
        } finally {
          this.forcing = false
        }
      }

      /** Whether the document has drifted away from the stored preference. */
      drifted() {
        const goal = this.intended()
        if (document.documentElement.getAttribute(ATTRIBUTE) !== goal.attribute) return true
        if (goal.tokens === undefined) return this.theme.getTheme().preference !== goal.preference
        return document.body.style.getPropertyValue('--dsw-alias-bg-base').trim() !== goal.tokens['--dsw-alias-bg-base']
          || document.body.hasAttribute('data-ds-dark-theme') !== (goal.scheme === 'dark')
      }

      /** Mark the document for the stored preference and start patrolling it. */
      imprint() {
        this.reassertions = 0
        this.apply()
        this.reconcile()
      }

      /**
       * Patrol the document while the shell settles. The shell applies its own
       * stored preference when its settings document arrives, and that
       * application lands *after* the theme event announcing it — so reacting to
       * the event alone loses the race and leaves the canvas on the shell's
       * theme while the panel still shows the skin. Each pass re-asserts only on
       * drift, and the budget stops us before the two of us trade writes.
       */
      reconcile(attempt = 0) {
        if (this.reconcileTimer !== undefined) clearTimeout(this.reconcileTimer)
        if (attempt > 6) return
        this.reconcileTimer = setTimeout(() => {
          if (this.drifted()) {
            if (this.reassertions >= 12) {
              if (this.warnedAboutShell !== true) {
                this.warnedAboutShell = true
                console.warn('dsh-skin-manager: the shell keeps applying its own theme; leaving it alone')
              }
              return
            }
            this.reassertions += 1
            this.apply(true)
          }
          this.reconcile(attempt + 1)
        }, attempt === 0 ? 0 : 150 * attempt)
      }

      /** Choose a skin from the panel: switch at once, then persist. */
      async select(id) {
        if (!this.state.ready || this.state.busy || this.state.activeId === id) return
        const previous = this.preferences
        const current = this.theme.getTheme().preference
        const next = {
          activeId: id,
          // Leaving a scheme-forcing skin hands the scheme back to the user's own
          // preference, exactly as it was before the skin took it over.
          fallbackTheme: isBuiltin(current) ? current : previous.fallbackTheme,
        }
        this.preferences = next
        this.imprint()
        this.publish({ activeId: id, busy: true, error: null, foreign: null })
        try {
          const response = await fetch(API, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(next),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          this.publish({ busy: false })
        } catch (error) {
          console.warn('dsh-skin-manager: the skin preference could not be saved', error)
          this.preferences = previous
          this.imprint()
          this.publish({ activeId: previous.activeId, busy: false, error: text('saveFailed') })
        }
      }

      /**
       * Reconcile with a theme change made elsewhere. The shell re-applies its
       * own preference whenever its settings document arrives, and that event
       * must not knock a selected skin off — so a stored palette is re-imprinted
       * rather than abandoned, which is what the ported controller does too.
       */
      adopt(snapshot) {
        if (!this.state.ready || this.forcing === true) return
        const preference = snapshot.preference
        if (skinById(preference)?.tokens !== undefined) {
          // Chosen through the shell's own control, which lists our skins.
          if (this.state.activeId === preference) return
          document.documentElement.setAttribute(ATTRIBUTE, preference)
          this.preferences = { activeId: preference, fallbackTheme: this.preferences.fallbackTheme }
          this.publish({ activeId: preference, foreign: null })
          this.persist()
          return
        }
        const stored = skinById(this.preferences.activeId)
        if (stored?.tokens !== undefined) {
          if (isBuiltin(preference) && this.preferences.fallbackTheme !== preference) {
            this.preferences = { activeId: stored.id, fallbackTheme: preference }
            this.persist()
          }
          this.imprint()
          return
        }
        if (isBuiltin(preference)) {
          // An own skin follows the scheme preference, and the shell has just
          // applied it; only the record and the attribute need to catch up.
          const own = skinById(this.preferences.activeId)
          if (own === undefined || own.tokens !== undefined) return
          if (this.state.activeId === own.id && this.preferences.fallbackTheme === preference) return
          document.documentElement.setAttribute(ATTRIBUTE, own.id)
          this.preferences = { activeId: own.id, fallbackTheme: preference }
          this.publish({ activeId: own.id, foreign: null })
          this.persist()
          return
        }
        // A theme registered by someone else is in charge; stay out of its way.
        const active = typeof snapshot.active?.id === 'string' ? snapshot.active.id : String(preference)
        document.documentElement.setAttribute(ATTRIBUTE, active)
        this.publish({ activeId: null, foreign: active })
      }

      persist() {
        const payload = this.preferences
        void fetch(API, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }).catch((error) => {
          console.warn('dsh-skin-manager: the skin preference could not be saved', error)
        })
      }
    }

    function SkinTile({ skin, active, disabled, onSelect }) {
      return h('button', {
        type: 'button',
        className: 'dsm-tile',
        'data-selected': active ? 'true' : 'false',
        role: 'radio',
        'aria-checked': active ? 'true' : 'false',
        'aria-label': skin.name,
        disabled,
        onClick: onSelect,
      },
        h('span', { className: 'dsm-swatch', style: { backgroundImage: skin.preview } }),
        h('span', { className: 'dsm-tile-body' },
          h('span', { className: 'dsm-name-row' },
            h('span', { className: 'dsm-name' }, skin.name),
            active ? h('span', { className: 'dsm-badge' }, text('active')) : null,
          ),
          h('span', { className: 'dsm-summary' }, summaryOf(skin)),
        ),
      )
    }

    function SkinSection(props) {
      const manager = props.manager
      const state = useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot)
      return h('div', { className: 'dsm-section' },
        h('h3', { className: 'dsm-title' }, text('title')),
        h('p', { className: 'dsm-intro' }, text('intro')),
        h('div', { className: 'dsm-grid', role: 'radiogroup', 'aria-label': text('title') },
          CATALOG.map((skin) => h(SkinTile, {
            key: skin.id,
            skin,
            active: state.activeId === skin.id,
            disabled: !state.ready || state.busy,
            onSelect: () => { void manager.select(skin.id) },
          })),
        ),
        state.foreign === null ? null : h('p', { className: 'dsm-note' }, `${text('unknownSkin')}：${state.foreign}`),
        state.error === null ? null : h('p', { className: 'dsm-error', role: 'alert' }, state.error),
      )
    }

    return {
      inject: ['slots', 'theme'],
      apply: (ctx) => {
        const manager = new SkinManager(ctx.theme)
        ctx.effect(() => installStyles(), 'dsh-skin-manager: panel styles')
        ctx.effect(() => {
          manager.start()
          const stopTheme = ctx.on('theme/change', (snapshot) => { manager.adopt(snapshot) })
          return () => {
            stopTheme()
            manager.dispose()
          }
        }, 'dsh-skin-manager: skin registry')
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'skins',
          order: 5,
          label: () => text('nav'),
          inject: () => ({ manager }),
        }, SkinSection))
      },
    }
  },
})
