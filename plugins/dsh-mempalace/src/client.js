window.__ModuleLoader__.load({
  id: 'dsh-mempalace',
  factory: (require) => {
    const React = require('react')
    const { createElement: h, useCallback, useEffect, useMemo, useRef, useState } = React
    const API = '/dsh-mempalace/api'

    async function request(path, body, signal) {
      const res = await fetch(`${API}${path}`, body === undefined ? { signal } : {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) {
        const error = new Error([data.error, data.hint].filter(Boolean).join('：') || `HTTP ${res.status}`)
        error.code = data.code
        throw error
      }
      return data
    }

    const TABS = [
      ['overview', '概览'],
      ['memories', '记忆'],
      ['search', '搜索'],
      ['knowledge', '知识图谱'],
      ['palace', '宫殿图'],
      ['diary', '日记'],
      ['settings', '设置'],
    ]

    const MZ_CSS = `
      .mempalace-panel{--mz-line:var(--dsw-alias-border-l2,rgba(127,127,127,.24));--mz-line-strong:var(--dsw-alias-border-l3,rgba(127,127,127,.4));--mz-brand:var(--dsw-alias-brand-primary,#2f6fed);--mz-ok:var(--dsw-alias-state-success-primary,#1a7f4b);--mz-warn:var(--dsw-alias-state-warn-primary,#a86a00);--mz-bad:var(--dsw-alias-state-error-primary,#c43b3b);--mz-fg:var(--dsw-alias-label-primary,#1f2329);--mz-fg2:var(--dsw-alias-label-secondary,rgba(0,0,0,.64));--mz-fg3:var(--dsw-alias-label-tertiary,rgba(0,0,0,.46));--mz-bg:var(--dsw-alias-bg-base,#fff);--mz-bg1:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.04));--mz-bg2:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));height:100%;display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box;background:var(--mz-bg);color:var(--mz-fg);font:13.5px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
      .mempalace-panel *{box-sizing:border-box}
      .mempalace-panel h1,.mempalace-panel h2,.mempalace-panel h3,.mempalace-panel p{margin:0}
      .mempalace-panel a{color:var(--mz-brand)}
      .mz-head{flex:none;display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:15px 22px 13px;border-bottom:1px solid var(--mz-line);background:linear-gradient(135deg,rgba(47,111,237,.10),rgba(255,122,162,.07) 58%,transparent)}
      .mz-head-main{min-width:0}
      .mz-kicker{margin:0 0 2px;font-size:10.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--mz-fg3)}
      .mz-head h1{font-size:19px;font-weight:660;letter-spacing:.01em}
      .mz-sub{margin-top:3px;font-size:12px;color:var(--mz-fg2);max-width:660px}
      .mz-head-actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px 12px;padding-top:2px}
      .mz-dots{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px 12px;max-width:100%}
      .mz-dot{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--mz-fg2);white-space:nowrap}
      .mz-dot::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--mz-fg3);box-shadow:0 0 0 3px rgba(127,127,127,.12);flex:none}
      .mz-dot.ok::before{background:var(--mz-ok);box-shadow:0 0 0 3px rgba(26,127,75,.16)}
      .mz-dot.warn::before{background:var(--mz-warn);box-shadow:0 0 0 3px rgba(168,106,0,.16)}
      .mz-dot.bad::before{background:var(--mz-bad);box-shadow:0 0 0 3px rgba(196,59,59,.16)}
      .mz-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:999px;border:1px solid var(--mz-line-strong);font-size:11px;line-height:1.6;color:var(--mz-fg2);background:rgba(127,127,127,.06);white-space:nowrap}
      .mz-chip.ok{color:var(--mz-ok);border-color:rgba(26,127,75,.35);background:rgba(26,127,75,.1)}
      .mz-chip.warn{color:var(--mz-warn);border-color:rgba(168,106,0,.35);background:rgba(168,106,0,.1)}
      .mz-chip.bad{color:var(--mz-bad);border-color:rgba(196,59,59,.35);background:rgba(196,59,59,.1)}
      .mz-chip.info{color:var(--mz-brand);border-color:rgba(47,111,237,.35);background:rgba(47,111,237,.1)}
      .mz-alerts{flex:none;display:flex;flex-direction:column;gap:6px;padding:8px 22px 0}
      .mz-alerts:empty{display:none;padding:0}
      .mz-alert{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:8px 11px;border-radius:9px;border:1px solid var(--mz-line-strong);background:var(--mz-bg2);font-size:12px;color:var(--mz-fg2)}
      .mz-alert.block{flex-direction:column;align-items:stretch;gap:6px}
      .mz-alert.danger{border-color:rgba(196,59,59,.35);background:rgba(196,59,59,.08);color:var(--mz-bad)}
      .mz-alert.warn{border-color:rgba(168,106,0,.35);background:rgba(168,106,0,.08);color:var(--mz-warn)}
      .mz-tabs{flex:none;display:flex;gap:2px;padding:0 14px;margin-top:8px;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none;border-bottom:1px solid var(--mz-line);background:var(--mz-bg1)}
      .mz-tabs::-webkit-scrollbar{display:none}
      .mz-tab{flex:none;appearance:none;background:none;border:0;border-bottom:2px solid transparent;border-radius:6px 6px 0 0;margin:0;padding:9px 12px 7px;font:inherit;font-size:12.5px;font-weight:500;color:var(--mz-fg2);cursor:pointer;transition:background .15s,color .15s,border-color .15s}
      .mz-tab:hover{background:rgba(127,127,127,.08);color:var(--mz-fg)}
      .mz-tab.on{color:var(--mz-brand);border-bottom-color:var(--mz-brand);font-weight:650}
      .mz-tab:focus-visible{outline:2px solid var(--mz-brand);outline-offset:-2px}
      .mz-body{flex:1;min-height:0;overflow:auto;padding:14px 20px 26px;scrollbar-gutter:stable}
      .mz-stack{display:flex;flex-direction:column;gap:13px;width:100%;max-width:1060px;margin:0 auto;outline:0}
      .mz-card{margin:0;padding:13px 15px 15px;border:1px solid var(--mz-line);border-radius:12px;background:var(--mz-bg1);box-shadow:0 1px 2px rgba(16,24,40,.04);min-width:0}
      .mz-card-title{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:14px;font-weight:660;margin-bottom:6px}
      .mz-card-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
      .mz-card-body{display:flex;flex-direction:column;gap:8px;min-width:0}
      .mz-card-body>p{font-size:12px;color:var(--mz-fg2);word-break:break-word}
      .mz-card-body>.mz-btn,.mz-card-body>.mz-linkbtn{align-self:flex-start}
      .mz-card-body>h3{font-size:12.5px;font-weight:650;margin-top:4px}
      .mz-card-subtitle{margin:4px 0 0;font-size:12.5px;font-weight:650}
      .mz-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:9px 12px}
      .mz-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:9px 12px}
      .mz-metric{font-size:22px;font-weight:650;line-height:1.15;letter-spacing:-.01em;font-variant-numeric:tabular-nums;word-break:break-word}
      .mz-metric-label{display:block;margin-top:2px;font-size:11px;font-weight:400;letter-spacing:0;color:var(--mz-fg3)}
      .mz-field{display:flex;flex-direction:column;gap:4px;margin:0;font-size:11.5px;color:var(--mz-fg3);min-width:140px;flex:1 1 160px}
      .mz-field>span{font-size:11.5px;color:var(--mz-fg3)}
      .mz-field>input,.mz-field>select,.mz-field>textarea{width:100%}
      .mz-field>.mz-btn{align-self:flex-start}
      .mz-check{display:inline-flex;align-items:flex-start;gap:7px;margin:2px 0;font-size:12.5px;color:var(--mz-fg);cursor:pointer}
      .mz-check input{width:15px;height:15px;margin:2px 0 0;accent-color:var(--mz-brand);flex:none}
      .mempalace-panel input[type=text],.mempalace-panel input[type=number],.mempalace-panel input[type=password],.mempalace-panel input:not([type]),.mempalace-panel select,.mempalace-panel textarea{font:inherit;font-size:12.5px;color:var(--mz-fg);background:var(--mz-bg);border:1px solid var(--mz-line-strong);border-radius:8px;padding:5px 9px;height:31px;outline:none;transition:border-color .15s,box-shadow .15s}
      .mempalace-panel textarea{height:auto;min-height:76px;padding:8px 10px;resize:vertical;line-height:1.55}
      .mempalace-panel input[type=checkbox]{accent-color:var(--mz-brand)}
      .mempalace-panel input[type=range]{width:100%;margin:7px 0;accent-color:var(--mz-brand)}
      .mempalace-panel input[type=text]:focus,.mempalace-panel input[type=number]:focus,.mempalace-panel input[type=password]:focus,.mempalace-panel input:not([type]):focus,.mempalace-panel select:focus,.mempalace-panel textarea:focus{border-color:var(--mz-brand);box-shadow:0 0 0 3px rgba(47,111,237,.16)}
      .mempalace-panel input:disabled,.mempalace-panel select:disabled,.mempalace-panel textarea:disabled{opacity:.55;cursor:not-allowed}
      .mz-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:31px;margin:0;padding:0 12px;border-radius:8px;border:1px solid var(--mz-line-strong);background:var(--mz-bg);color:var(--mz-fg);font:inherit;font-size:12px;font-weight:550;white-space:nowrap;cursor:pointer;transition:background .15s,border-color .15s,color .15s}
      .mz-btn:hover:not(:disabled){background:var(--mz-bg2);border-color:var(--mz-fg3)}
      .mz-btn:focus-visible{outline:2px solid var(--mz-brand);outline-offset:1px}
      .mz-btn:disabled{opacity:.45;cursor:not-allowed}
      .mz-btn-primary{background:var(--mz-brand);border-color:var(--mz-brand);color:var(--mz-bg)}
      .mz-btn-primary:hover:not(:disabled){background:var(--mz-brand);border-color:var(--mz-brand);filter:brightness(1.07)}
      .mz-btn-danger{color:var(--mz-bad);border-color:rgba(196,59,59,.42);background:rgba(196,59,59,.07)}
      .mz-btn-danger:hover:not(:disabled){background:rgba(196,59,59,.14);border-color:var(--mz-bad)}
      .mz-btn-quiet{border-style:dashed;color:var(--mz-fg2)}
      .mz-linkbtn{appearance:none;display:inline-flex;align-items:center;gap:4px;margin:0;padding:2px 5px;border:0;border-radius:6px;background:transparent;color:var(--mz-brand);font:inherit;font-size:12px;cursor:pointer}
      .mz-linkbtn:hover:not(:disabled){background:rgba(127,127,127,.1);text-decoration:underline}
      .mz-linkbtn:focus-visible{outline:2px solid var(--mz-brand);outline-offset:1px}
      .mz-linkbtn.danger{color:var(--mz-bad)}
      .mz-linkbtn:disabled{opacity:.45;cursor:not-allowed}
      .mz-row{display:flex;flex-wrap:wrap;align-items:center;gap:7px;min-width:0}
      .mz-row.between{justify-content:space-between;row-gap:6px}
      .mz-rec{padding:11px 12px;border:1px solid var(--mz-line);border-radius:10px;background:var(--mz-bg);display:flex;flex-direction:column;gap:5px;min-width:0}
      .mz-list{display:flex;flex-direction:column;gap:8px}
      .mz-rec strong{font-size:13px;font-weight:620;word-break:break-word}
      .mz-rec p{font-size:12.5px;color:var(--mz-fg2);white-space:pre-wrap;word-break:break-word}
      .mz-text{margin:0;font-size:12.5px;color:var(--mz-fg2);white-space:pre-wrap;word-break:break-word}
      .mz-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;font-size:11px;color:var(--mz-fg3);word-break:break-word}
      .mz-mono{font:11.5px/17px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--mz-fg3)}
      .mz-col{display:flex;flex-direction:column;gap:3px}
      .mz-timeline{display:flex;flex-direction:column;gap:2px;padding:3px 0;font-size:11.5px;color:var(--mz-fg3);word-break:break-word}
      .mz-pre{margin:0;padding:9px 11px;max-height:280px;overflow:auto;border:1px solid var(--mz-line);border-radius:9px;background:var(--mz-bg2);color:var(--mz-fg);font:11.5px/17px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
      .mz-hint{font-size:11.5px;color:var(--mz-fg3);word-break:break-word}
      .mz-empty{padding:14px;text-align:center;font-size:12px;color:var(--mz-fg3);border:1px dashed var(--mz-line-strong);border-radius:10px}
      .mz-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
      .mz-table{width:100%;border-collapse:collapse;font-size:12px}
      .mz-table th{text-align:left;padding:6px 8px;border-bottom:1px solid var(--mz-line);color:var(--mz-fg3);font-weight:500;white-space:nowrap}
      .mz-table td{padding:6px 8px;border-bottom:1px solid var(--mz-line);vertical-align:top;word-break:break-word}
      .mz-table tr:last-child td{border-bottom:0}
      .mz-table tbody tr.on{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08))}
      .mz-bar{display:flex;height:6px;flex:1 1 80px;min-width:60px;max-width:100%;border-radius:999px;background:rgba(127,127,127,.18);overflow:hidden}
      .mz-bar-fill{height:100%;border-radius:999px;background:var(--mz-brand);transition:width .3s ease}
      .mz-bar-label{flex:0 1 110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;color:var(--mz-fg3)}
      .mz-bar-count{min-width:28px;text-align:right;font-size:11.5px;color:var(--mz-fg3);font-variant-numeric:tabular-nums}
      .mz-svg{display:block;width:100%;height:auto}
      .mz-spark{display:block;width:100%;height:120px}
      .mz-svg g[role=button]{cursor:pointer}
      .mz-svg g[role=button]:focus-visible{outline:none}
      .mz-svg g[role=button]:focus-visible circle{stroke-width:3}
      .mz-file{max-width:100%;font-size:12px;color:var(--mz-fg2)}
      .mz-file::file-selector-button{margin-right:8px;height:28px;padding:0 11px;border:1px solid var(--mz-line-strong);border-radius:8px;background:var(--mz-bg);color:var(--mz-fg);font:inherit;font-size:12px;font-weight:550;cursor:pointer}
      .mz-file::file-selector-button:hover{background:var(--mz-bg2)}
      .mz-toast{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:60;display:flex;align-items:center;gap:8px;max-width:min(560px,92vw);padding:9px 14px;border-radius:10px;border:1px solid var(--mz-line-strong);background:var(--mz-bg);color:var(--mz-fg);font-size:12.5px;box-shadow:0 8px 28px rgba(16,24,40,.18);animation:mz-in .18s ease}
      .mz-toast::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--mz-ok);flex:none}
      .mz-toast.danger::before{background:var(--mz-bad);box-shadow:0 0 0 3px rgba(196,59,59,.16)}
      .mz-toast-text{flex:1 1 auto;min-width:0;word-break:break-word}
      @keyframes mz-in{from{opacity:0;transform:translate(-50%,-6px)}to{opacity:1;transform:translate(-50%,0)}}
      @media(max-width:760px){.mz-head{flex-direction:column;gap:8px;padding:13px 14px 11px}.mz-head-actions{justify-content:flex-start}.mz-dots{max-width:100%;justify-content:flex-start}.mz-alerts{padding:7px 14px 0}.mz-tabs{padding:0 8px;margin-top:7px}.mz-body{padding:11px 12px 20px}.mz-grid,.mz-metrics{grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}.mz-card-body>.mz-row>.mz-field{flex:1 1 100%}.mz-btn{height:30px;padding:0 10px}.mz-bar-label{flex:1 1 90px}}
      @media(prefers-reduced-motion:reduce){.mempalace-panel *{transition:none!important;animation:none!important}}
    `

    function button(label, onClick, options = {}) {
      const kind = options.kind || ''
      const base = kind === 'link' ? 'mz-linkbtn' : 'mz-btn'
      const className = [base, kind === 'primary' && 'mz-btn-primary', kind === 'danger' && 'mz-btn-danger', kind === 'quiet' && 'mz-btn-quiet', options.className].filter(Boolean).join(' ')
      return h('button', { type: 'button', onClick, disabled: options.disabled, className, style: options.style }, label)
    }

    function fmtTime(value) {
      if (!value) return '—'
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false })
    }

    function fmtDay(value) {
      return value ? String(value).slice(0, 10) : '—'
    }

    function pct(value) {
      return `${Math.round(Number(value) * 1000) / 10}%`
    }

    function Badge({ children, kind }) {
      const tone = kind === 'warn' ? 'warn' : kind === 'error' ? 'bad' : kind === 'ok' ? 'ok' : ''
      return h('span', { className: tone ? `mz-chip ${tone}` : 'mz-chip' }, children)
    }

    function Card({ title, actions, children }) {
      return h('section', { className: 'mz-card' },
        title || actions ? h('div', { className: 'mz-card-title' },
          title ? h('span', null, title) : h('span'),
          actions ? h('div', { className: 'mz-card-actions' }, actions) : null) : null,
        h('div', { className: 'mz-card-body' }, children))
    }

    function Field({ label, children, style }) {
      return h('label', { className: 'mz-field', style }, h('span', null, label), children)
    }

    function Empty({ children }) {
      return h('div', { className: 'mz-empty' }, children)
    }

    function Failure({ error, onRetry }) {
      if (!error) return null
      return h('div', { className: 'mz-alert danger', role: 'alert' },
        h('span', null, error),
        onRetry ? button('重试', onRetry, { kind: 'quiet' }) : null)
    }

    function Toast({ toast, onClose }) {
      useEffect(() => {
        if (!toast) return undefined
        const timer = setTimeout(onClose, 4000)
        return () => clearTimeout(timer)
      }, [toast, onClose])
      if (!toast) return null
      return h('div', {
        className: toast.kind === 'error' ? 'mz-toast danger' : 'mz-toast',
        role: toast.kind === 'error' ? 'alert' : 'status',
      },
        h('span', { className: 'mz-toast-text' }, toast.text),
        h('button', { type: 'button', className: 'mz-linkbtn', onClick: onClose, 'aria-label': '关闭提示' }, '关闭'))
    }

    function Sparkline({ timeline }) {
      const days = useMemo(() => {
        const list = []
        const today = new Date()
        for (let i = 27; i >= 0; i -= 1) {
          const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
          const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
          list.push({ key, count: Number(timeline?.[key] || 0) })
        }
        return list
      }, [timeline])
      const max = Math.max(1, ...days.map(day => day.count))
      const width = 560
      const height = 120
      const pad = 10
      const step = (width - pad * 2) / Math.max(1, days.length - 1)
      const points = days.map((day, index) => `${pad + index * step},${height - pad - (day.count / max) * (height - pad * 2)}`).join(' ')
      const total = days.reduce((sum, day) => sum + day.count, 0)
      return h('div', null,
        h('svg', { className: 'mz-spark', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `最近 28 天共写入 ${total} 条记忆` },
          h('line', { x1: pad, y1: height - pad, x2: width - pad, y2: height - pad, stroke: 'var(--dsw-alias-border-l2)', strokeWidth: 1 }),
          h('polyline', { points, fill: 'none', stroke: 'var(--dsw-alias-state-business-primary)', strokeWidth: 2, strokeLinejoin: 'round' }),
          days.map((day, index) => h('circle', { key: day.key, cx: pad + index * step, cy: height - pad - (day.count / max) * (height - pad * 2), r: day.count > 0 ? 2.5 : 0, fill: 'var(--dsw-alias-state-business-primary)' }))),
        h('div', { className: 'mz-row between' },
          h('span', { className: 'mz-hint' }, days[0]?.key),
          h('span', { className: 'mz-hint' }, `28 天合计 ${total} 条`),
          h('span', { className: 'mz-hint' }, days[days.length - 1]?.key)))
    }

    function Bars({ title, counts }) {
      const entries = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]).slice(0, 8)
      const max = Math.max(1, ...entries.map(entry => entry[1]))
      return h(Card, { title },
        entries.length === 0 ? h('p', { className: 'mz-hint' }, '暂无数据') : entries.map(([name, count]) => h('div', { key: name, className: 'mz-row' },
          h('span', { className: 'mz-bar-label', title: name }, name),
          h('div', { className: 'mz-bar' }, h('div', { className: 'mz-bar-fill', style: { width: `${(count / max) * 100}%` } })),
          h('span', { className: 'mz-bar-count' }, count))))
    }

    function OverviewTab({ snapshot, refreshStatus, notify }) {
      const [recent, setRecent] = useState(null)
      const [error, setError] = useState('')
      const loadRecent = useCallback(async () => {
        try {
          setRecent(await request('/recent-memory'))
          setError('')
        } catch (failure) { setError(failure.message) }
      }, [])
      useEffect(() => { void loadRecent() }, [loadRecent])
      const stats = snapshot?.stats
      const ready = snapshot?.state === 'ready'
      return h(React.Fragment, null,
        !snapshot ? h('div', { className: 'mz-alert warn', role: 'status' }, '正在读取记忆宫殿状态…') : null,
        snapshot && !ready ? h('div', { className: snapshot.state === 'loading' ? 'mz-alert warn block' : 'mz-alert danger block', role: 'alert' },
          h('strong', null, snapshot?.state === 'loading' ? '数据层正在加载…' : '内存宫殿数据层不可用'),
          snapshot?.error ? h('div', null, snapshot.error) : null,
          snapshot?.hint ? h('div', null, `提示：${snapshot.hint}`) : null,
          h('div', { className: 'mz-row' }, button('重新检查', () => { void refreshStatus() }))) : null,
        h('div', { className: 'mz-metrics' },
          h(Card, { title: '记忆总量' }, h('div', { className: 'mz-metric' }, stats?.total ?? '—', h('span', { className: 'mz-metric-label' }, '条（含分块）'))),
          h(Card, { title: '存储占用' }, h('div', { className: 'mz-metric' }, stats ? `${stats.storageSizeKb}` : '—', h('span', { className: 'mz-metric-label' }, 'KB（数据库 + WAL）'))),
          h(Card, { title: '会话' }, h('div', { className: 'mz-metric' }, stats?.sessions ?? '—', h('span', { className: 'mz-metric-label' }, '个已记录会话'))),
          h(Card, { title: '项目' }, h('div', { className: 'mz-metric' }, stats ? Object.keys(stats.projects).length : '—', h('span', { className: 'mz-metric-label' }, '个记忆房间'))),
          h(Card, { title: '向量后端' }, h('div', { className: 'mz-row' }, h(Badge, { kind: snapshot?.models?.embedding === 'ready' ? 'ok' : 'warn' }, snapshot?.models?.embedding || 'idle')), h('div', { className: 'mz-hint' }, snapshot?.fts?.enabled ? '关键字索引已启用' : '关键字索引未启用'))),
        stats && stats.oldest ? h('div', { className: 'mz-hint' }, `时间范围：${fmtDay(stats.oldest)} → ${fmtDay(stats.newest)} · 平均 ${stats.avgContentLength} 字符/条`) : null,
        h(Card, { title: '最近 28 天活动' }, h(Sparkline, { timeline: stats?.timeline })),
        h('div', { className: 'mz-grid' },
          h(Bars, { title: '项目分布', counts: stats?.projects }),
          h(Bars, { title: '话题分布', counts: stats?.topics }),
          h(Bars, { title: '来源分布', counts: stats?.sources })),
        h(Card, { title: '近期记忆预览（只读）', actions: button('刷新预览', loadRecent) },
          h(Failure, { error }),
          recent?.text ? h('pre', { className: 'mz-pre' }, recent.text) : h('p', { className: 'mz-hint' }, '当前没有可预览的记忆。'),
          recent?.tokens ? h('p', { className: 'mz-hint' }, `估算 ${recent.tokens} tokens · 项目：${recent.project || '全部'}`) : null,
          h('p', { className: 'mz-hint' }, '预览只读，不会进入系统提示；记忆内容按“不可信参考数据”展示。')))
    }

    function MemoriesTab({ snapshot, project, setProject }) {
      const [filters, setFilters] = useState({ topic: '', source: '', q: '', sort: 'newest' })
      const [data, setData] = useState(null)
      const [offset, setOffset] = useState(0)
      const [expanded, setExpanded] = useState('')
      const [error, setError] = useState('')
      const limit = 20
      const load = useCallback(async () => {
        const params = new URLSearchParams({ limit: String(limit), offset: String(offset), sort: filters.sort })
        if (project) params.set('project', project)
        if (filters.topic) params.set('topic', filters.topic)
        if (filters.source) params.set('source', filters.source)
        if (filters.q) params.set('q', filters.q)
        try {
          setData(await request(`/memories?${params.toString()}`))
          setError('')
        } catch (failure) {
          setError(failure.message)
          setData(null)
        }
      }, [project, filters.topic, filters.source, filters.q, filters.sort, offset])
      useEffect(() => {
        const timer = setTimeout(() => { void load() }, 250)
        return () => clearTimeout(timer)
      }, [load])
      const pages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1
      const page = Math.floor(offset / limit) + 1
      return h(React.Fragment, null,
        h(Card, { title: '筛选' },
          h('div', { className: 'mz-row' },
            h(Field, { label: '项目' }, h('input', { value: project, placeholder: '全部项目', onChange: event => { setProject(event.target.value.trim()); setOffset(0) } })),
            h(Field, { label: '话题' }, h('input', { value: filters.topic, placeholder: '全部话题', onChange: event => { setFilters({ ...filters, topic: event.target.value }); setOffset(0) } })),
            h(Field, { label: '来源' }, h('input', { value: filters.source, placeholder: '全部来源', onChange: event => { setFilters({ ...filters, source: event.target.value }); setOffset(0) } })),
            h(Field, { label: '关键字' }, h('input', { value: filters.q, placeholder: '内容包含…', onChange: event => { setFilters({ ...filters, q: event.target.value }); setOffset(0) } })),
            h(Field, { label: '排序' }, h('select', { value: filters.sort, onChange: event => { setFilters({ ...filters, sort: event.target.value }); setOffset(0) } },
              h('option', { value: 'newest' }, '最新优先'),
              h('option', { value: 'oldest' }, '最早优先'),
              h('option', { value: 'importance' }, '重要度优先'))),
            h('div', { className: 'mz-field' }, h('span', null, '操作'), button('刷新', load)))),
        h(Card, { title: '只读归档' },
          h('p', { className: 'mz-hint' }, '记忆由 ActMem 写入；这里只展示和检索归档，不提供新增或删除。')),
        h(Failure, { error, onRetry: load }),
        data && data.items.length === 0 ? h(Empty, null, '当前筛选下没有记忆。') : null,
        data ? h('div', { className: 'mz-list' },
          data.items.map(item => h('article', { key: item.id, className: 'mz-rec' },
            h('div', { className: 'mz-row between' },
              h('div', { className: 'mz-meta' },
                h(Badge, null, item.project),
                h(Badge, null, item.topic),
                h(Badge, { kind: item.embedded ? 'ok' : 'warn' }, item.embedded ? '已向量化' : '关键字'),
                h('span', null, item.source),
                h('span', null, fmtTime(item.timestamp))),
              h('div', { className: 'mz-row' },
                item.parent_id ? h(Badge, null, `分块 ${item.chunk_index}`) : null,
                h('span', { className: 'mz-mono' }, item.id))),
            h('p', { className: 'mz-text' }, expanded === item.id ? item.content : `${item.content.slice(0, 320)}${item.content.length > 320 ? '…' : ''}`),
            item.content.length > 320 ? h('div', { className: 'mz-row' }, button(expanded === item.id ? '收起' : '展开全文', () => setExpanded(expanded === item.id ? '' : item.id), { kind: 'link' })) : null))) : null,
        data ? h('div', { className: 'mz-row between' },
          h('span', { className: 'mz-hint' }, `共 ${data.total} 条 · 第 ${page} / ${pages} 页`),
          h('div', { className: 'mz-row' },
            button('上一页', () => setOffset(Math.max(0, offset - limit)), { disabled: offset === 0 }),
            button('下一页', () => setOffset(offset + limit), { disabled: offset + limit >= data.total }))) : null)
    }

    function SearchTab({ project, notify }) {
      const [query, setQuery] = useState('')
      const [filters, setFilters] = useState({ project, topic: '', n_results: 8 })
      const [result, setResult] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const controller = useRef(null)
      useEffect(() => { setFilters(current => ({ ...current, project })) }, [project])
      useEffect(() => () => { controller.current?.abort() }, [])
      async function search() {
        if (!query.trim()) return
        controller.current?.abort()
        controller.current = new AbortController()
        setBusy(true)
        try {
          const data = await request('/search', {
            query: query.trim(),
            project: filters.project || undefined,
            topic: filters.topic || undefined,
            n_results: Number(filters.n_results) || 8,
          }, controller.current.signal)
          setResult(data)
          setError('')
        } catch (failure) {
          if (failure.name !== 'AbortError') setError(failure.message)
        } finally { setBusy(false) }
      }
      function copy(text) {
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(text).then(() => notify('ok', '已复制到剪贴板')).catch(() => notify('error', '复制失败'))
        } else notify('error', '当前环境不支持剪贴板')
      }
      return h(React.Fragment, null,
        h(Card, { title: '语义搜索' },
          h('div', { className: 'mz-row' },
            h(Field, { label: '查询', style: { flex: '3 1 260px' } }, h('input', { value: query, placeholder: '例如：我们上次怎么解决登录过期？', onChange: event => setQuery(event.target.value), onKeyDown: event => { if (event.key === 'Enter') void search() } })),
            h(Field, { label: '项目' }, h('input', { value: filters.project, placeholder: '全部项目', onChange: event => setFilters({ ...filters, project: event.target.value }) })),
            h(Field, { label: '话题' }, h('input', { value: filters.topic, placeholder: '全部话题', onChange: event => setFilters({ ...filters, topic: event.target.value }) })),
            h(Field, { label: '结果数' }, h('input', { type: 'number', min: 1, max: 20, value: filters.n_results, onChange: event => setFilters({ ...filters, n_results: event.target.value }) })),
            h('div', { className: 'mz-field' }, h('span', null, '操作'), h('div', { className: 'mz-row' },
              button(busy ? '搜索中…' : '搜索', search, { kind: 'primary', disabled: busy || !query.trim() }),
              busy ? button('取消', () => controller.current?.abort()) : null)))),
        h(Failure, { error }),
        result ? h(Card, { title: `结果（${result.results.length}）`, actions: result.mode === 'keyword' ? h(Badge, { kind: 'warn' }, '关键字回退') : h(Badge, { kind: 'ok' }, result.mode === 'mixed' ? '语义 + 关键字' : '语义') },
          result.results.length === 0 ? h(Empty, null, '没有匹配的记忆。') : result.results.map(item => h('article', { key: item.id, className: 'mz-rec' },
            h('div', { className: 'mz-row between' },
              h('div', { className: 'mz-meta' }, h(Badge, null, item.project), h(Badge, null, item.topic), h('span', null, fmtTime(item.timestamp))),
              h('div', { className: 'mz-row' },
                h('span', { className: 'mz-hint', style: { minWidth: '48px' } }, item.similarity > 0 ? pct(item.similarity) : '关键字'),
                h('div', { className: 'mz-bar', style: { maxWidth: '120px' } }, h('div', { className: 'mz-bar-fill', style: { width: `${Math.max(2, item.similarity * 100)}%` } })),
                button('复制', () => copy(item.text), { kind: 'link' }))),
            h('p', { className: 'mz-text' }, item.text)))) : null)
    }

    function LedgerCard() {
      const [scope, setScope] = useState('')
      const [limit, setLimit] = useState(50)
      const [commits, setCommits] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const load = useCallback(async () => {
        setBusy(true)
        try {
          const query = `limit=${limit}${scope.trim() ? `&assetScope=${encodeURIComponent(scope.trim())}` : ''}`
          const data = await request(`/knowledge/commits?${query}`)
          setCommits(data.commits || [])
          setError('')
        } catch (failure) {
          setError(failure.message)
          setCommits(null)
        } finally { setBusy(false) }
      }, [scope, limit])
      useEffect(() => { void load() }, [])
      const tone = state => state === 'live' ? 'ok' : state === 'rolled_back' ? 'error' : 'warn'
      return h(Card, { title: '知识版本账本（只读）', actions: button(busy ? '读取中…' : '刷新', load, { disabled: busy }) },
        h('div', { className: 'mz-row' },
          h(Field, { label: '资源范围（留空为全部）' }, h('input', { value: scope, placeholder: 'knowledge:conflict:…', onChange: event => setScope(event.target.value) })),
          h(Field, { label: '条数（1-200）' }, h('input', { type: 'number', min: 1, max: 200, value: limit, onChange: event => setLimit(Math.min(200, Math.max(1, Number(event.target.value) || 50))) }))),
        h(Failure, { error, onRetry: load }),
        commits === null
          ? (error ? null : h('p', { className: 'mz-hint' }, '加载中…'))
          : commits.length === 0
            ? h(Empty, null, '还没有知识版本提交。')
            : h('div', { className: 'mz-scroll' },
              h('table', { className: 'mz-table' },
                h('thead', null, h('tr', null,
                  h('th', null, '修订'), h('th', null, '状态'), h('th', null, '资源范围'),
                  h('th', null, '提交键'), h('th', null, '恢复自'), h('th', null, '时间'))),
                h('tbody', null, commits.map(entry => h('tr', { key: entry.commitKey },
                  h('td', null, `r${entry.revision}`),
                  h('td', null, h(Badge, { kind: tone(entry.state) }, entry.state)),
                  h('td', null, h('span', { className: 'mz-mono' }, entry.assetScope)),
                  h('td', null, h('span', { className: 'mz-mono' }, entry.commitKey)),
                  h('td', null, entry.restoresRevision === null ? '—' : `r${entry.restoresRevision}`),
                  h('td', null, fmtTime(entry.createdAt))))))),
        h('p', { className: 'mz-hint' }, '账本只读：提交与回滚由所有者组件写入，这里只按时间倒序展示。'))
    }

    function KnowledgeTab({ project, notify }) {
      const [stats, setStats] = useState(null)
      const [entities, setEntities] = useState([])
      const [entityQuery, setEntityQuery] = useState('')
      const [selected, setSelected] = useState(null)
      const [facts, setFacts] = useState([])
      const [timeline, setTimeline] = useState([])
      const [entityDraft, setEntityDraft] = useState({ name: '', entity_type: 'project', properties: '{}' })
      const [tripleDraft, setTripleDraft] = useState({ subject: '', predicate: '', object: '', valid_from: '', valid_to: '', confidence: 1, project })
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [invalidateId, setInvalidateId] = useState(null)
      const loadStats = useCallback(async () => {
        try {
          const data = await request('/knowledge/stats')
          setStats(data.stats)
          setError('')
        } catch (failure) { setError(failure.message) }
      }, [])
      const loadEntities = useCallback(async () => {
        try {
          const params = new URLSearchParams({ limit: '100' })
          if (entityQuery.trim()) params.set('q', entityQuery.trim())
          const data = await request(`/knowledge/entities?${params.toString()}`)
          setEntities(data.entities)
        } catch (failure) { setError(failure.message) }
      }, [entityQuery])
      const loadDetail = useCallback(async name => {
        if (!name) { setFacts([]); setTimeline([]); return }
        try {
          const [queried, history] = await Promise.all([
            request(`/knowledge/query?${new URLSearchParams({ entity: name, ...(project ? { project } : {}) })}`),
            request(`/knowledge/timeline?${new URLSearchParams({ entity: name })}`),
          ])
          setFacts(queried.facts || [])
          setTimeline(history.timeline || [])
        } catch (failure) { notify('error', failure.message) }
      }, [project, notify])
      useEffect(() => { void loadStats() }, [loadStats])
      useEffect(() => {
        const timer = setTimeout(() => { void loadEntities() }, 250)
        return () => clearTimeout(timer)
      }, [loadEntities])
      useEffect(() => { void loadDetail(selected) }, [selected, loadDetail])
      useEffect(() => { setTripleDraft(current => ({ ...current, project })) }, [project])
      async function addEntity() {
        if (!entityDraft.name.trim()) { notify('error', '实体名称不能为空'); return }
        let properties = {}
        try { properties = entityDraft.properties.trim() ? JSON.parse(entityDraft.properties) : {} }
        catch { notify('error', '属性必须是合法 JSON'); return }
        setBusy(true)
        try {
          const saved = await request('/knowledge/entity', { name: entityDraft.name.trim(), entity_type: entityDraft.entity_type || undefined, properties })
          notify('ok', `${saved.status === 'updated' ? '实体已更新' : '实体已创建'} · r${saved.revision}`)
          setEntityDraft({ name: '', entity_type: 'project', properties: '{}' })
          await loadStats()
          await loadEntities()
          await loadDetail(saved.name || selected)
        } catch (failure) { notify('error', failure.message) } finally { setBusy(false) }
      }
      async function addTriple() {
        if (!tripleDraft.subject.trim() || !tripleDraft.predicate.trim() || !tripleDraft.object.trim()) {
          notify('error', '主语、谓语和宾语均为必填')
          return
        }
        setBusy(true)
        try {
          const saved = await request('/knowledge/triple', {
            subject: tripleDraft.subject.trim(),
            predicate: tripleDraft.predicate.trim(),
            object: tripleDraft.object.trim(),
            valid_from: tripleDraft.valid_from || undefined,
            valid_to: tripleDraft.valid_to || undefined,
            confidence: Number(tripleDraft.confidence),
            project: tripleDraft.project || project || undefined,
          })
          notify('ok', `事实已写入知识图谱 · r${saved.revision}`)
          setTripleDraft({ subject: '', predicate: '', object: '', valid_from: '', valid_to: '', confidence: 1, project })
          await loadStats()
          if (selected) await loadDetail(selected)
        } catch (failure) { notify('error', failure.message) } finally { setBusy(false) }
      }
      async function invalidate(fact) {
        if (invalidateId !== fact.id) {
          setInvalidateId(fact.id)
          setTimeout(() => setInvalidateId(current => current === fact.id ? null : current), 5000)
          return
        }
        setBusy(true)
        try {
          const saved = await request('/knowledge/invalidate', {
            subject: fact.subject,
            predicate: fact.predicate,
            object: fact.object,
            ended: new Date().toISOString(),
          })
          notify('ok', `事实已标记为失效 · r${saved.revision}`)
          setInvalidateId(null)
          await loadStats()
          if (selected) await loadDetail(selected)
        } catch (failure) { notify('error', failure.message) } finally { setBusy(false) }
      }
      return h(React.Fragment, null,
        h('div', { className: 'mz-metrics' },
          h(Card, { title: '实体' }, h('div', { className: 'mz-metric' }, stats?.entityCount ?? '—', h('span', { className: 'mz-metric-label' }, '个实体'))),
          h(Card, { title: '事实' }, h('div', { className: 'mz-metric' }, stats?.tripleCount ?? '—', h('span', { className: 'mz-metric-label' }, `${stats?.activeTriples ?? 0} 条仍有效`))),
          h(Card, { title: '谓语' }, h('div', { className: 'mz-metric' }, stats ? Object.keys(stats.predicates).length : '—', h('span', { className: 'mz-metric-label' }, '种关系类型')))),
        h(Failure, { error, onRetry: () => { void loadStats(); void loadEntities() } }),
        h(Card, { title: '实体列表', actions: h('div', { className: 'mz-row' },
          h('input', { value: entityQuery, placeholder: '搜索实体', onChange: event => setEntityQuery(event.target.value) }),
          button('刷新', loadEntities)) },
          entities.length === 0 ? h(Empty, null, '还没有实体。先添加实体或直接写入一条事实。') : h('div', { className: 'mz-scroll' },
            h('table', { className: 'mz-table' },
              h('thead', null, h('tr', null, h('th', null, '名称'), h('th', null, '类型'), h('th', null, '事实数'), h('th', null, '操作'))),
              h('tbody', null, entities.map(entity => h('tr', { key: entity.id, className: selected === entity.name ? 'on' : undefined },
                h('td', null, entity.name),
                h('td', null, entity.type),
                h('td', null, entity.facts),
                h('td', null, button(selected === entity.name ? '已选中' : '查看', () => setSelected(entity.name), { kind: 'link' })))))))),
        h(Card, { title: '新增实体' },
          h('div', { className: 'mz-row' },
            h(Field, { label: '名称' }, h('input', { value: entityDraft.name, onChange: event => setEntityDraft({ ...entityDraft, name: event.target.value }) })),
            h(Field, { label: '类型' }, h('input', { value: entityDraft.entity_type, onChange: event => setEntityDraft({ ...entityDraft, entity_type: event.target.value }) })),
            h(Field, { label: '属性 JSON', style: { flex: '2 1 220px' } }, h('input', { value: entityDraft.properties, onChange: event => setEntityDraft({ ...entityDraft, properties: event.target.value }) }))),
          button('保存实体', addEntity, { kind: 'primary', disabled: busy })),
        h(Card, { title: '新增事实' },
          h('div', { className: 'mz-row' },
            h(Field, { label: '主语' }, h('input', { value: tripleDraft.subject, onChange: event => setTripleDraft({ ...tripleDraft, subject: event.target.value }) })),
            h(Field, { label: '谓语' }, h('input', { value: tripleDraft.predicate, placeholder: 'uses / depends_on', onChange: event => setTripleDraft({ ...tripleDraft, predicate: event.target.value }) })),
            h(Field, { label: '宾语' }, h('input', { value: tripleDraft.object, onChange: event => setTripleDraft({ ...tripleDraft, object: event.target.value }) })),
            h(Field, { label: '项目' }, h('input', { value: tripleDraft.project, onChange: event => setTripleDraft({ ...tripleDraft, project: event.target.value }) }))),
          h('div', { className: 'mz-row' },
            h(Field, { label: '生效时间' }, h('input', { value: tripleDraft.valid_from, placeholder: '2026-01-01（可选）', onChange: event => setTripleDraft({ ...tripleDraft, valid_from: event.target.value }) })),
            h(Field, { label: '失效时间' }, h('input', { value: tripleDraft.valid_to, placeholder: '可选', onChange: event => setTripleDraft({ ...tripleDraft, valid_to: event.target.value }) })),
            h(Field, { label: '置信度' }, h('input', { type: 'number', min: 0, max: 1, step: 0.1, value: tripleDraft.confidence, onChange: event => setTripleDraft({ ...tripleDraft, confidence: event.target.value }) }))),
          button('写入事实', addTriple, { kind: 'primary', disabled: busy })),
        selected ? h(Card, { title: `实体详情：${selected}`, actions: button('关闭', () => setSelected(null)) },
          facts.length === 0 ? h(Empty, null, '该实体没有匹配的事实。') : h('div', { className: 'mz-scroll' },
            h('table', { className: 'mz-table' },
              h('thead', null, h('tr', null, h('th', null, '事实'), h('th', null, '有效期'), h('th', null, '项目'), h('th', null, '操作'))),
              h('tbody', null, facts.map(fact => h('tr', { key: fact.id },
                h('td', null, `${fact.subject} ${fact.predicate} ${fact.object}`),
                h('td', null, `${fact.valid_from ? fmtDay(fact.valid_from) : '—'} → ${fact.valid_to ? fmtDay(fact.valid_to) : '现在'}`),
                h('td', null, fact.project),
                h('td', null, fact.valid_to ? h(Badge, { kind: 'warn' }, '已失效') : button(invalidateId === fact.id ? '再次点击确认' : '标记失效', () => invalidate(fact), { kind: 'link', className: 'danger', disabled: busy }))))))),
          h('h3', { className: 'mz-card-subtitle' }, '实体时间线'),
          timeline.length === 0 ? h('p', { className: 'mz-hint' }, '暂无时间线。') : timeline.map(fact => h('div', { key: fact.id, className: 'mz-timeline' }, h('span', null, `${fact.valid_from || fact.created_at} → ${fact.valid_to || '现在'}`), h('span', null, `${fact.subject} ${fact.predicate} ${fact.object}`)))) : null,
        h(LedgerCard))
    }

    function PalaceTab({ notify, onOpenProject }) {
      const [graph, setGraph] = useState(null)
      const [error, setError] = useState('')
      const [selectedEdge, setSelectedEdge] = useState(null)
      const [tunnel, setTunnel] = useState(null)
      const [hover, setHover] = useState(null)
      const [busy, setBusy] = useState(false)
      const load = useCallback(async () => {
        try {
          const data = await request('/graph/palace')
          setGraph(data.graph)
          setError('')
        } catch (failure) { setError(failure.message) }
      }, [])
      useEffect(() => { void load() }, [load])
      async function openTunnel(edge) {
        setSelectedEdge(edge)
        setBusy(true)
        try {
          const params = new URLSearchParams({ topic: edge.topic, projectA: edge.projectA, projectB: edge.projectB, n: '20' })
          const data = await request(`/graph/tunnel?${params.toString()}`)
          setTunnel(data.results)
        } catch (failure) { notify('error', failure.message); setTunnel(null) } finally { setBusy(false) }
      }
      const layout = useMemo(() => {
        const nodes = graph?.nodes || []
        const width = 680
        const height = 420
        const cx = width / 2
        const cy = height / 2
        const radius = nodes.length <= 1 ? 0 : Math.min(width, height) * 0.31
        const positions = nodes.map((node, index) => {
          const angle = nodes.length <= 1 ? 0 : (Math.PI * 2 * index) / nodes.length - Math.PI / 2
          return { ...node, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius }
        })
        const byName = new Map(positions.map(node => [node.name, node]))
        const maxCount = Math.max(1, ...positions.map(node => node.memoryCount))
        const nodeRadius = count => Math.min(46, 20 + (Math.log2(count + 1) / Math.log2(maxCount + 1)) * 22)
        const edges = (graph?.edges || []).map(edge => {
          const a = byName.get(edge.projectA)
          const b = byName.get(edge.projectB)
          if (!a || !b) return null
          const mx = (a.x + b.x) / 2
          const my = (a.y + b.y) / 2
          const dx = b.x - a.x
          const dy = b.y - a.y
          const length = Math.hypot(dx, dy) || 1
          const bend = Math.min(70, length * 0.18)
          return {
            ...edge,
            x1: a.x, y1: a.y, x2: b.x, y2: b.y,
            cx: mx + (-dy / length) * bend,
            cy: my + (dx / length) * bend,
            width: 1 + Math.min(5, Math.log2(edge.strength + 1)),
          }
        }).filter(Boolean)
        return { width, height, positions, edges, byName, nodeRadius }
      }, [graph])
      const maxStrength = Math.max(1, ...layout.edges.map(edge => edge.strength))
      const hoveredNode = hover?.type === 'node' ? hover.name : null
      return h(React.Fragment, null,
        h(Failure, { error, onRetry: load }),
        h(Card, { title: '宫殿图', actions: button('刷新', load) },
          !graph ? h('p', { className: 'mz-hint' }, '加载中…') : graph.nodes.length === 0 ? h(Empty, null, '还没有项目房间。保存几条记忆后，项目会自动出现。') : h('div', null,
            h('svg', { className: 'mz-svg', viewBox: `0 0 ${layout.width} ${layout.height}`, role: 'img', 'aria-label': `宫殿图：${graph.nodes.length} 个项目、${graph.edges.length} 条隧道` },
              layout.edges.map((edge, index) => h('path', {
                key: `${edge.topic}-${index}`,
                d: `M ${edge.x1} ${edge.y1} Q ${edge.cx} ${edge.cy} ${edge.x2} ${edge.y2}`,
                fill: 'none',
                stroke: selectedEdge === edge ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-l3)',
                strokeWidth: selectedEdge === edge ? edge.width + 2 : edge.width,
                strokeOpacity: hoveredNode && hoveredNode !== edge.projectA && hoveredNode !== edge.projectB ? 0.2 : 0.75,
                style: { cursor: 'pointer' },
                onClick: () => { void openTunnel(edge) },
              }, h('title', null, `${edge.projectA} ↔ ${edge.projectB} — ${edge.topic}（${edge.strength} 条）`))),
              layout.positions.map(node => h('g', {
                key: node.name,
                role: 'button',
                tabIndex: 0,
                'aria-label': `${node.name}，${node.memoryCount} 条记忆`,
                style: { cursor: 'pointer' },
                onClick: () => onOpenProject(node.name),
                onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenProject(node.name) } },
                onMouseEnter: () => setHover({ type: 'node', name: node.name }),
                onMouseLeave: () => setHover(null),
              },
              h('circle', {
                cx: node.x, cy: node.y, r: layout.nodeRadius(node.memoryCount),
                fill: hoveredNode === node.name ? 'var(--dsw-alias-interactive-bg-hover-solid)' : 'var(--dsw-alias-bg-layer-2)',
                stroke: 'var(--dsw-alias-state-business-primary)',
                strokeWidth: hoveredNode === node.name ? 3 : 1.5,
              }),
              h('text', { x: node.x, y: node.y + 4, textAnchor: 'middle', fontSize: 12, fill: 'var(--dsw-alias-label-primary)' }, node.name.slice(0, 14)),
              h('text', { x: node.x, y: node.y + layout.nodeRadius(node.memoryCount) + 16, textAnchor: 'middle', fontSize: 11, fill: 'var(--dsw-alias-label-tertiary)' }, `${node.memoryCount} 条`))),
              hoveredNode ? (() => {
                const node = layout.byName.get(hoveredNode)
                if (!node?.topics?.length) return null
                return h('text', { x: node.x, y: node.y - layout.nodeRadius(node.memoryCount) - 10, textAnchor: 'middle', fontSize: 11, fill: 'var(--dsw-alias-label-secondary)' }, node.topics.slice(0, 3).join(' · '))
              })() : null),
            graph.nodes.length === 1 ? h('div', { className: 'mz-alert warn' }, '目前只有一个项目，且没有共享话题。再保存一个项目或让两个项目共享话题后会出现隧道。') : null,
            h('p', { className: 'mz-hint' }, `点击项目节点查看该项目记忆；点击彩色线查看隧道两侧的记忆。线宽表示共享话题的记忆总量（最大 ${maxStrength}）。`))),
        selectedEdge ? h(Card, { title: `隧道：${selectedEdge.projectA} ↔ ${selectedEdge.projectB} · ${selectedEdge.topic}`, actions: button('关闭', () => { setSelectedEdge(null); setTunnel(null) }) },
          busy ? h('p', { className: 'mz-hint' }, '加载隧道记忆…') : tunnel && tunnel.length > 0 ? tunnel.map(item => h('div', { key: item.id, className: 'mz-rec' },
            h('div', { className: 'mz-meta' }, h(Badge, null, item.project), h(Badge, null, item.topic), h('span', null, fmtTime(item.timestamp))),
            h('p', { className: 'mz-text' }, item.text))) : h(Empty, null, '这条隧道暂时没有记忆。')) : null,
        graph && graph.edges.length > 0 ? h(Card, { title: '隧道列表' }, h('div', { className: 'mz-scroll' },
          h('table', { className: 'mz-table' },
            h('thead', null, h('tr', null, h('th', null, '话题'), h('th', null, '项目 A'), h('th', null, '项目 B'), h('th', null, '强度'), h('th', null, '操作'))),
            h('tbody', null, graph.edges.map((edge, index) => h('tr', { key: `${edge.topic}-${index}` },
              h('td', null, edge.topic),
              h('td', null, edge.projectA),
              h('td', null, edge.projectB),
              h('td', null, edge.strength),
              h('td', null, button('查看', () => { void openTunnel(edge) }, { kind: 'link' })))))))) : null)
    }

    function DiaryTab() {
      const [agentName, setAgentName] = useState(() => {
        try { return window.localStorage.getItem('dsh-mempalace.diary-agent') || 'agent' } catch { return 'agent' }
      })
      const [lastN, setLastN] = useState(10)
      const [entries, setEntries] = useState(null)
      const [error, setError] = useState('')
      const load = useCallback(async () => {
        try { window.localStorage.setItem('dsh-mempalace.diary-agent', agentName) } catch { /* private mode */ }
        try {
          const params = new URLSearchParams({ agent_name: agentName, last_n: String(lastN) })
          const data = await request(`/diary?${params.toString()}`)
          setEntries(data.entries)
          setError('')
        } catch (failure) { setError(failure.message); setEntries(null) }
      }, [agentName, lastN])
      useEffect(() => { void load() }, [load])
      return h(React.Fragment, null,
        h(Card, { title: '日记' },
          h('div', { className: 'mz-row' },
            h(Field, { label: 'Agent 名称' }, h('input', { value: agentName, onChange: event => setAgentName(event.target.value) })),
            h(Field, { label: '读取条数' }, h('input', { type: 'number', min: 1, max: 100, value: lastN, onChange: event => setLastN(Number(event.target.value) || 10) })),
            h('div', { className: 'mz-field' }, h('span', null, '操作'), button('读取', load))),
          h('p', { className: 'mz-hint' }, '日记为只读归档：写入已退役，新的个人记忆由 ActMem 提交。')),
        h(Failure, { error, onRetry: load }),
        entries ? h(Card, { title: `最近 ${entries.length} 条（按时间正序）`, actions: button('刷新', load) },
          entries.length === 0 ? h(Empty, null, '还没有日记条目。') : entries.map(entry => h('article', { key: entry.id, className: 'mz-rec' },
            h('div', { className: 'mz-meta' }, h(Badge, null, entry.topic), h('span', null, fmtTime(entry.timestamp))),
            h('p', { className: 'mz-text' }, entry.text)))) : null)
    }

    function SettingsTab({ snapshot, refreshStatus, notify }) {
      const [config, setConfig] = useState(null)
      const [diagnostics, setDiagnostics] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState('')
      const [importSummary, setImportSummary] = useState(null)
      const fileRef = useRef(null)
      const load = useCallback(async () => {
        try {
          const data = await request('/config')
          setConfig(data.config)
          setDiagnostics(data)
          setError('')
        } catch (failure) { setError(failure.message) }
      }, [])
      useEffect(() => { void load() }, [load])
      async function save() {
        setBusy('save')
        try {
          const data = await request('/config', config)
          setConfig(data.config)
          notify('ok', '设置已保存')
          await refreshStatus()
        } catch (failure) { notify('error', failure.message) } finally { setBusy('') }
      }
      async function action(name, path, success) {
        setBusy(name)
        try {
          const data = await request(path, {})
          notify('ok', typeof success === 'function' ? success(data) : success)
          await load()
          await refreshStatus()
        } catch (failure) { notify('error', failure.message) } finally { setBusy('') }
      }
      async function importFile(file) {
        if (!file) return
        if (file.size > 10 * 1024 * 1024) { notify('error', '导入文件不能超过 10 MB'); return }
        setBusy('import')
        try {
          const text = await file.text()
          const payload = JSON.parse(text)
          const data = await request('/import', { payload })
          setImportSummary(data.summary)
          notify('ok', `导入完成：${data.summary.memories.stored} 条新记忆`)
          await load()
          await refreshStatus()
        } catch (failure) { notify('error', `导入失败：${failure.message}`) } finally {
          setBusy('')
          if (fileRef.current) fileRef.current.value = ''
        }
      }
      async function download() {
        setBusy('export')
        try {
          const res = await fetch(`${API}/export`)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = `mempalace-${new Date().toISOString().slice(0, 10)}.json`
          document.body.appendChild(anchor)
          anchor.click()
          anchor.remove()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
          notify('ok', '导出文件已开始下载')
        } catch (failure) { notify('error', `导出失败：${failure.message}`) } finally { setBusy('') }
      }
      if (!config) {
        return h(React.Fragment, null,
          h(Failure, { error, onRetry: load }),
          h('p', { className: 'mz-hint' }, '加载设置…'))
      }
      const toggle = key => h('input', { type: 'checkbox', checked: Boolean(config[key]), onChange: event => setConfig({ ...config, [key]: event.target.checked }) })
      return h(React.Fragment, null,
        h(Failure, { error, onRetry: load }),
        h(Card, { title: '行为设置' },
          h('div', { className: 'mz-row' },
            h('label', { className: 'mz-check' }, toggle('topicInferenceEnabled'), '本地话题推断')),
          h('div', { className: 'mz-row' },
            h(Field, { label: '预览 token 上限' }, h('input', { type: 'number', min: 64, max: 8000, value: config.wakeUpMaxTokens, onChange: event => setConfig({ ...config, wakeUpMaxTokens: Number(event.target.value) }) })),
            h(Field, { label: '默认项目（留空用会话）' }, h('input', { value: config.defaultProject || '', onChange: event => setConfig({ ...config, defaultProject: event.target.value.trim() || null }) })),
            h(Field, { label: '去重阈值' }, h('input', { type: 'number', min: 0, max: 1, step: 0.05, value: config.dedupeThreshold, onChange: event => setConfig({ ...config, dedupeThreshold: Number(event.target.value) }) })))),
        h(Card, { title: '模型与网络' },
          h('div', { className: 'mz-row' },
            h(Field, { label: '向量模型' }, h('input', { value: config.embeddingModel, onChange: event => setConfig({ ...config, embeddingModel: event.target.value }) })),
            h(Field, { label: '话题模型（留空关闭）' }, h('input', { value: config.topicModel, onChange: event => setConfig({ ...config, topicModel: event.target.value }) })),
            h(Field, { label: '模型缓存目录' }, h('input', { value: config.modelCacheDir, placeholder: '$DSH_HOME/mempalace/models', onChange: event => setConfig({ ...config, modelCacheDir: event.target.value }) })),
            h(Field, { label: 'HF 端点（镜像）' }, h('input', { value: config.hfEndpoint, placeholder: 'https://hf-mirror.com', onChange: event => setConfig({ ...config, hfEndpoint: event.target.value }) })),
            h(Field, { label: '模型加载超时（秒）' }, h('input', { type: 'number', min: 10, max: 900, value: Math.round((config.modelLoadTimeoutMs || 60000) / 1000), onChange: event => setConfig({ ...config, modelLoadTimeoutMs: Number(event.target.value) * 1000 }) }))),
          h('div', { className: 'mz-row' },
            h('label', { className: 'mz-check' }, toggle('keywordsFallback'), '语义不可用时使用关键字检索'),
            button('保存设置', save, { kind: 'primary', disabled: Boolean(busy) }),
            button(busy === 'warmup' ? '加载模型中…' : '预热模型', () => action('warmup', '/models/warmup', data => `模型状态：向量 ${data.result.embedding}，话题 ${data.result.topic}`), { disabled: Boolean(busy) }))),
        h(Card, { title: '诊断' },
          h('div', { className: 'mz-meta' },
            h(Badge, { kind: snapshot?.state === 'ready' ? 'ok' : 'warn' }, `数据层 ${snapshot?.state || 'unknown'}`),
            h(Badge, { kind: snapshot?.models?.embedding === 'ready' ? 'ok' : 'warn' }, `向量 ${snapshot?.models?.embedding || 'idle'}`),
            h(Badge, { kind: snapshot?.models?.topic === 'ready' ? 'ok' : 'warn' }, `话题模型 ${snapshot?.models?.topic || 'idle'}`)),
          snapshot?.error ? h('div', { className: 'mz-alert danger' }, snapshot.error) : null,
          snapshot?.hint ? h('div', { className: 'mz-alert warn' }, snapshot.hint) : null,
          diagnostics?.retirement?.warnings?.length
            ? h('div', { className: 'mz-alert warn block' }, `旧状态迁移警告：${diagnostics.retirement.warnings.join('；')}`)
            : null,
          diagnostics?.paths ? h('div', { className: 'mz-hint mz-col' },
            h('span', null, `状态目录：${diagnostics.paths.stateDir}`),
            h('span', null, `数据库：${diagnostics.paths.dbPath}`)) : null,
          diagnostics?.diagnostics ? h('pre', { className: 'mz-pre' }, JSON.stringify(diagnostics.diagnostics, null, 2)) : h('p', { className: 'mz-hint' }, '未找到 setup 诊断文件；运行 npm run setup:mempalace 后重启服务。'),
          h('p', { className: 'mz-hint' }, '模型首次使用时会下载到缓存目录；中国网络可使用 https://hf-mirror.com。本插件不再记录对话；新个人记忆由 ActMem 写入，历史归档仍可检索。')),
        h(Card, { title: '导入 / 导出' },
          h('div', { className: 'mz-row' },
            h('input', { ref: fileRef, type: 'file', className: 'mz-file', accept: 'application/json,.json', 'aria-label': '选择导入文件', onChange: event => { void importFile(event.target.files?.[0]) } }),
            button(busy === 'export' ? '导出中…' : '导出全部数据', download, { disabled: Boolean(busy) })),
          h('p', { className: 'mz-hint' }, '导出为 JSON 附件（先做 WAL checkpoint）。导入上限 10 MB，重复记忆与事实会跳过。'),
          importSummary ? h('pre', { className: 'mz-pre' }, JSON.stringify(importSummary, null, 2)) : null),
        h(Card, { title: '维护' },
          h('div', { className: 'mz-row' },
            button(busy === 'reindex' ? '重建中…' : '重建缺失向量', () => action('reindex', '/reindex', data => `重建完成：更新 ${data.updated}，失败 ${data.failed}`), { disabled: Boolean(busy) }),
            button(busy === 'vacuum' ? '整理中…' : '整理数据库（VACUUM）', () => action('vacuum', '/maintenance/vacuum', '数据库已整理'), { disabled: Boolean(busy) }))))
    }

    function MempalacePanel() {
      const [tab, setTab] = useState('overview')
      const [snapshot, setSnapshot] = useState(null)
      const [toast, setToast] = useState(null)
      const [memoryProject, setMemoryProject] = useState('')
      const [statusError, setStatusError] = useState('')
      const bodyRef = useRef(null)
      const notify = useCallback((kind, text) => setToast({ kind, text, at: Date.now() }), [])
      const closeToast = useCallback(() => setToast(null), [])
      const refreshStatus = useCallback(async () => {
        try {
          const data = await request('/status')
          setSnapshot(data.snapshot)
          setStatusError('')
        } catch (failure) { setStatusError(failure.message) }
      }, [])
      useEffect(() => { void refreshStatus() }, [refreshStatus])
      useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0 }, [tab])
      const openProject = useCallback(project => {
        setMemoryProject(project)
        setTab('memories')
      }, [])
      let content = null
      if (tab === 'overview') content = h(OverviewTab, { snapshot, refreshStatus, notify })
      else if (tab === 'memories') content = h(MemoriesTab, { snapshot, project: memoryProject, setProject: setMemoryProject })
      else if (tab === 'search') content = h(SearchTab, { project: memoryProject, notify })
      else if (tab === 'knowledge') content = h(KnowledgeTab, { project: memoryProject, notify })
      else if (tab === 'palace') content = h(PalaceTab, { notify, onOpenProject: openProject })
      else if (tab === 'diary') content = h(DiaryTab)
      else content = h(SettingsTab, { snapshot, refreshStatus, notify })
      const tabItems = TABS.map(([id, label]) => ({ id, label }))
      const onTabKeyDown = (event, index) => {
        if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault()
          const next = event.key === 'Home' ? 0 : tabItems.length - 1
          setTab(tabItems[next].id)
          if (typeof document !== 'undefined') document.getElementById(`mz-tab-${tabItems[next].id}`)?.focus()
          return
        }
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
        if (!step) return
        event.preventDefault()
        const next = (index + step + tabItems.length) % tabItems.length
        setTab(tabItems[next].id)
        if (typeof document !== 'undefined') document.getElementById(`mz-tab-${tabItems[next].id}`)?.focus()
      }
      const dots = [
        h('span', { key: 'backend', className: `mz-dot ${snapshot?.state === 'ready' ? 'ok' : snapshot ? 'warn' : ''}` },
          snapshot ? `数据层 ${snapshot.state}` : '正在读取状态'),
        h('span', { key: 'total', className: 'mz-dot' }, `记忆 ${snapshot?.stats?.total ?? 0} 条`),
        h('span', { key: 'embed', className: `mz-dot ${snapshot?.models?.embedding === 'ready' ? 'ok' : 'warn'}` },
          `向量 ${snapshot?.models?.embedding || 'idle'}`),
        statusError ? h('span', { key: 'status', className: 'mz-dot bad' }, '状态读取失败') : null,
      ].filter(Boolean)
      return h('main', { className: 'mempalace-panel' },
        h('style', null, MZ_CSS),
        h('header', { className: 'mz-head' },
          h('div', { className: 'mz-head-main' },
            h('p', { className: 'mz-kicker' }, 'DSH · 记忆宫殿'),
            h('h1', null, '记忆宫殿'),
            h('p', { className: 'mz-sub' }, '本地持久记忆 · 语义检索 · 宫殿图 · 时序知识图谱 · 日记')),
          h('div', { className: 'mz-head-actions' },
            h('div', { className: 'mz-dots' }, ...dots),
            button('刷新状态', refreshStatus))),
        h('div', { className: 'mz-alerts' },
          statusError ? h('div', { className: 'mz-alert danger', role: 'alert' },
            h('span', null, statusError),
            button('重试', refreshStatus, { kind: 'quiet' })) : null),
        h('div', { className: 'mz-tabs', role: 'tablist', 'aria-label': '记忆宫殿导航' },
          tabItems.map((item, index) => h('button', {
            key: item.id,
            id: `mz-tab-${item.id}`,
            type: 'button',
            role: 'tab',
            'aria-selected': tab === item.id,
            'aria-controls': `mz-panel-${item.id}`,
            tabIndex: tab === item.id ? 0 : -1,
            className: tab === item.id ? 'mz-tab on' : 'mz-tab',
            onClick: () => setTab(item.id),
            onKeyDown: event => onTabKeyDown(event, index),
          }, item.label))),
        h('div', { className: 'mz-body', ref: bodyRef },
          h('div', {
            id: `mz-panel-${tab}`,
            role: 'tabpanel',
            'aria-labelledby': `mz-tab-${tab}`,
            tabIndex: 0,
            className: 'mz-stack',
          }, content)),
        h(Toast, { toast, onClose: closeToast }))
    }

    function Icon({ size = 20 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true },
        h('path', { d: 'M4 20V9l8-5 8 5v11' }),
        h('path', { d: 'M9 20v-6h6v6' }),
        h('path', { d: 'M8 9h8' }))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'mempalace', inject: () => ({}) }, MempalacePanel))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'mempalace', order: 13, label: () => '记忆宫殿' }, Icon))
      },
    }
  },
})
