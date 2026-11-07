(() => {
  // Injected by index.js so the product name has a single source.
  const PRODUCT = window.__VIVY_PRODUCT__ || "DIVA"
  /* The shell writes "<session title> — <product>", or just "<product>" when
     the window shows no session, and it writes the product in the interface
     language: a source checkout says "DSH 本地构建" / "DSH Local Build" where a
     release build says "DeepSeek Harness". Replace whichever one is present and
     keep the session prefix intact. */
  const NATIVE = ["DeepSeek Harness", "DSH 本地构建", "DSH Local Build"]
  const rename = () => {
    const raw = document.title || ""
    if (raw === "") {
      document.title = PRODUCT
      return
    }
    let next = raw
    for (const name of NATIVE) next = next.replaceAll(name, PRODUCT)
    // Only write when something changed: a write re-enters the observer.
    if (next !== raw) document.title = next
  }
  rename()
  const title = document.querySelector("title")
  if (title) {
    new MutationObserver(rename).observe(title, {
      childList: true,
      characterData: true,
      subtree: true,
    })
  }

  /* The main title's five exclamation marks. Each one has to be its own element
     because CSS cannot colour a single character of a text node, and each
     carries data-bang so the sheet knows which pen to use. The sentence itself
     is drawn by that span's ::before, so these marks are appended to the span
     and land after it; with the script missing, the title still reads
     "寻找真心之旅" without marks. */
  const BANGS = 5
  const SLOGAN =
    '[class*="headline"] > [class*="titleGroup"] > span:not([class*="previewBadge"])'
  let current = null

  const drop = () => {
    for (const mark of document.querySelectorAll(".diva-bang")) mark.remove()
    current = null
  }

  const decorate = () => {
    if (document.documentElement.getAttribute("data-dsh-skin") !== "diva") {
      if (current !== null) drop()
      return
    }
    // Fast path: the span we already dressed is still on screen.
    if (current !== null && current.isConnected) return
    current = null
    const slogan = document.querySelector(SLOGAN)
    if (slogan === null) return
    for (const stale of slogan.querySelectorAll(":scope > .diva-bang")) stale.remove()
    for (let index = 1; index <= BANGS; index += 1) {
      const mark = document.createElement("span")
      mark.className = "diva-bang"
      mark.dataset.bang = String(index)
      mark.textContent = "!"
      slogan.append(mark)
    }
    current = slogan
  }

  decorate()

  /* The hero is mounted and unmounted as the window changes view, so look again
     when the document changes — throttled, and free while the hero is already
     dressed. The skin id lives on <html> and can change at any time. */
  let queued = null
  const queue = () => {
    if (queued !== null) return
    queued = setTimeout(() => {
      queued = null
      decorate()
    }, 300)
  }
  if (document.body !== null) {
    new MutationObserver(queue).observe(document.body, { childList: true, subtree: true })
  }
  new MutationObserver(queue).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-dsh-skin"],
  })
})()
