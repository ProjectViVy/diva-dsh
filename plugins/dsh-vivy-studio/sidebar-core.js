(() => {
  /* The "VIVY心核" group in the sidebar's global-panel list.

     The shell has no concept of a panel group — `sidebar.panellist` hands over a
     flat, order-sorted list and the slot contract carries no group field — so
     this is a DOM enhancement of the nav React already owns: one header button
     of our own inserted between the resident entries and the DIVA ones, a marker
     class on the member rows, and two data attributes on the nav that let the
     stylesheet answer "wide or rail" and "open or shut". Every write is compared
     first, so the observers below can re-run on any mutation without feeding
     themselves.

     The one exception to "touch nothing React made" is the resident row the
     shell files *after* the group. Panel rows are sorted by a per-plugin
     `order`, and several plugins ship the same one: SurfCore, Superagent and
     自动化任务 all register at 10, so the later registration (自动化任务) renders
     below the first two, and the header — inserted before the first member —
     would cut it off from 插件, the row it belongs beside. A resident row found
     behind the header is therefore moved back in front of it. That insert is
     idempotent: once the row precedes the header the test fails and nothing
     moves, and the nav observer settles after the one extra pass. */
  const KEY = "dsh.vivy.sidebar.core.v1"
  /* A product name, not a UI string: it stays "VIVY心核" in either interface
     language, the same way the wordmark does. */
  const LABEL = "VIVY心核"
  const NAV = 'nav[class*="panelList"]'
  const HEAD = ".diva-core-head"
  const ROW = "diva-core-row"
  /* The rows that keep their own place in the list: the resident plugin and
     automation panels, the character stage, and the More launcher — which is a
     panel row too, and would otherwise be pulled into the group by being neither
     of the first two. `相遇` (dsh-live2d) rides at order -10 so it lands above
     插件; folding it into the group would move it below the resident rows it is
     meant to sit in front of. */
  const KEEP = /^(插件|plugins|自动化任务|automation( tasks)?|相遇|更多|more)$/i
  /* Of those, the launcher closes the list: it belongs after the group, so it is
     never pulled in front of the header. */
  const TAIL = /^(更多|more)$/i
  /* Wide is 228px of nav, the rail is 36px. The nav's own box is what gets
     measured because a member row of a shut group is display:none, and a
     display:none row measures 0px — which reads exactly like the rail. */
  const RAIL_MAX_WIDTH = 80
  /* Element.DOCUMENT_POSITION_FOLLOWING, spelled out: the constant is on `Node`,
     which a hardened profile could shadow, and the number is frozen by the DOM
     standard. */
  const FOLLOWING = 4

  const read = () => {
    try {
      return localStorage.getItem(KEY) === "collapsed" ? "collapsed" : "expanded"
    } catch {
      return "expanded"
    }
  }

  const write = (value) => {
    try {
      localStorage.setItem(KEY, value)
    } catch {
      /* A profile that refuses storage still gets a working group for the
         session; it just starts open every time. */
    }
  }

  /* The shell's own rows, in the order it renders them. The header is a button
     as well, so it is told apart by the module class and never listed here. */
  const rowsOf = (nav) =>
    [...nav.querySelectorAll(":scope > button")].filter((row) => row.className.includes("panelRow"))

  const nameOf = (row) => (row.getAttribute("aria-label") || "").trim()

  const membersOf = (rows) => {
    const members = rows.filter((row) => !KEEP.test(nameOf(row)))
    /* Neither label matched: the interface language is not one this script was
       written against. The plugins launcher is the fixed first entry, so treat
       the first row as resident rather than fold it into the group. */
    if (members.length === rows.length && rows.length > 1) return members.slice(1)
    return members
  }

  const SVG_NS = "http://www.w3.org/2000/svg"

  /* One 16px glyph: the shell draws its panel icons at that size in the wide
     layout, and the header is a panel row, so it lines up with them. */
  const icon = (className, d, width) => {
    const svg = document.createElementNS(SVG_NS, "svg")
    svg.setAttribute("class", className)
    svg.setAttribute("viewBox", "0 0 16 16")
    svg.setAttribute("aria-hidden", "true")
    const path = document.createElementNS(SVG_NS, "path")
    path.setAttribute("d", d)
    path.setAttribute("fill", "none")
    path.setAttribute("stroke", "currentColor")
    path.setAttribute("stroke-width", String(width))
    path.setAttribute("stroke-linecap", "round")
    path.setAttribute("stroke-linejoin", "round")
    svg.append(path)
    return svg
  }

  /* The heart marks the group; the chevron at the far end is the disclosure. */
  const heart = () => icon("diva-core-heart", "M8 13.2 3.3 8.5A3 3 0 0 1 7.5 4.3l.5.5.5-.5a3 3 0 0 1 4.2 4.2Z", 1.5)
  const chevron = () => icon("diva-core-chevron", "M4.5 6 8 9.5 11.5 6", 1.5)

  /* Re-used across mutations, so the listener is bound exactly once and a
     re-render that drops the header costs one rebuild rather than a duplicate. */
  const ensureHead = () => {
    const existing = document.querySelector(HEAD)
    if (existing !== null) {
      if (existing.dataset.divaCoreBound !== "true") {
        existing.dataset.divaCoreBound = "true"
        existing.addEventListener("click", toggle)
      }
      return existing
    }
    const head = document.createElement("button")
    head.type = "button"
    head.className = "diva-core-head"
    const label = Object.assign(document.createElement("span"), {
      className: "diva-core-label",
      textContent: LABEL,
    })
    /* Glyph, caption, then the disclosure at the row's far edge — the same
       order a panel row reads in, so the header is a peer and not a title. */
    head.append(heart(), label, chevron())
    head.dataset.divaCoreBound = "true"
    head.addEventListener("click", toggle)
    return head
  }

  function toggle() {
    write(read() === "collapsed" ? "expanded" : "collapsed")
    sync()
  }

  const put = (node, name, value) => {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value)
  }

  const follows = (node, reference) => (reference.compareDocumentPosition(node) & FOLLOWING) !== 0

  function sync() {
    const nav = document.querySelector(NAV)
    const head = document.querySelector(HEAD)
    if (nav === null) {
      if (head !== null) head.remove()
      return
    }

    const rows = rowsOf(nav)
    const members = membersOf(rows)
    if (members.length === 0) {
      // Every panel is unpinned, or only the resident ones are: nothing to group.
      if (head !== null) head.remove()
      for (const row of rows) row.classList.remove(ROW)
      nav.removeAttribute("data-diva-core")
      nav.removeAttribute("data-diva-rail")
      return
    }

    const built = ensureHead()
    /* The header sits *before* the first member, so the test is its next
       sibling. Testing previousSibling would never match, and re-inserting a
       node that is already in place still queues remove+insert records: the
       nav observer would re-enter on its own edit and the page would never
       yield. */
    if (built.nextSibling !== members[0] || built.parentElement !== nav) nav.insertBefore(built, members[0])
    /* A resident row the shell filed behind the header comes back in front of it
       so the group never splits two rows that belong together. Walking `rows` in
       document order keeps the residents' own relative order. */
    for (const row of rows) {
      if (!KEEP.test(nameOf(row)) || TAIL.test(nameOf(row))) continue
      if (!follows(row, built)) continue
      nav.insertBefore(row, built)
    }
    for (const row of rows) {
      const want = members.includes(row)
      if (row.classList.contains(ROW) !== want) row.classList.toggle(ROW, want)
    }

    const state = read()
    put(nav, "data-diva-rail", String(nav.getBoundingClientRect().width <= RAIL_MAX_WIDTH))
    put(nav, "data-diva-core", state)
    put(built, "aria-expanded", String(state === "expanded"))
    watchNav(nav)
  }

  /* The nav is React's, and React replaces rows, rewrites their class when the
     active panel moves, and settles the rail 150ms after the column starts
     collapsing. Each of those leaves the group half-built, so all three are
     watched — the writes above are guarded, so a re-run on our own edit costs a
     comparison and nothing else. */
  let navWatched = null
  const navObserver = new MutationObserver(sync)
  const watchNav = (nav) => {
    if (navWatched === nav) return
    navWatched = nav
    navObserver.observe(nav, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] })
    // The column element is the one that gains `collapsed`; the nav only changes
    // width once that class lands, so this is the rail-settle signal.
    if (nav.parentElement !== null) {
      navObserver.observe(nav.parentElement, { attributes: true, attributeFilter: ["class"] })
    }
  }

  sync()

  let queued = null
  const queue = () => {
    if (queued !== null) return
    queued = setTimeout(() => {
      queued = null
      sync()
    }, 150)
  }
  if (document.body !== null) {
    new MutationObserver(queue).observe(document.body, { childList: true, subtree: true })
  }
  // A dragged or resized column changes the nav's width without touching the DOM.
  addEventListener("resize", queue)
})()
