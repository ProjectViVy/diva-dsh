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

    const styles = {
      root: { display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-base)', borderRadius: 'var(--dsw-radius-lg)', minHeight: '100%', boxSizing: 'border-box' },
      header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' },
      title: { margin: 0, fontSize: '20px', fontWeight: 600 },
      subtitle: { margin: '4px 0 0', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' },
      tabs: { display: 'flex', gap: '4px', flexWrap: 'wrap', borderBottom: '1px solid var(--dsw-alias-border-l2)', paddingBottom: '8px' },
      tab: { border: '1px solid transparent', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', padding: '7px 12px', borderRadius: 'var(--dsw-radius-md)', cursor: 'pointer', fontSize: '13px' },
      tabActive: { borderColor: 'var(--dsw-alias-border-l3)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', fontWeight: 600 },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' },
      card: { border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', borderRadius: 'var(--dsw-radius-lg)', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 },
      cardTitle: { margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' },
      metric: { fontSize: '24px', fontWeight: 650, lineHeight: 1.1 },
      metricLabel: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' },
      row: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
      field: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '140px', flex: '1 1 160px' },
      label: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      input: { padding: '7px 9px', border: '1px solid var(--dsw-alias-border-l3)', borderRadius: 'var(--dsw-radius-md)', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', fontSize: '13px', minWidth: 0 },
      textarea: { padding: '8px 9px', border: '1px solid var(--dsw-alias-border-l3)', borderRadius: 'var(--dsw-radius-md)', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', fontSize: '13px', minHeight: '88px', resize: 'vertical', width: '100%', boxSizing: 'border-box' },
      button: { padding: '7px 12px', border: '1px solid var(--dsw-alias-border-l3)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', borderRadius: 'var(--dsw-radius-md)', cursor: 'pointer', fontSize: '13px' },
      primary: { borderColor: 'var(--dsw-alias-state-business-primary)', background: 'var(--dsw-alias-state-business-primary)', color: 'var(--dsw-alias-label-primary-inverted)' },
      danger: { borderColor: 'var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)' },
      link: { background: 'transparent', border: 'none', color: 'var(--dsw-alias-link)', cursor: 'pointer', padding: '4px 6px', fontSize: '12px' },
      item: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 'var(--dsw-radius-md)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px', background: 'var(--dsw-alias-bg-layer-1)' },
      meta: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', display: 'flex', gap: '8px', flexWrap: 'wrap' },
      text: { margin: 0, fontSize: '13px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.55 },
      badge: { fontSize: '11px', padding: '2px 7px', borderRadius: '999px', border: '1px solid var(--dsw-alias-border-l3)', color: 'var(--dsw-alias-label-secondary)' },
      badgeWarn: { borderColor: 'var(--dsw-alias-state-warn-primary)', color: 'var(--dsw-alias-state-warn-label)' },
      badgeError: { borderColor: 'var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)' },
      badgeOk: { borderColor: 'var(--dsw-alias-state-success-primary)', color: 'var(--dsw-alias-state-success-primary)' },
      alert: { border: '1px solid var(--dsw-alias-state-error-primary)', background: 'var(--dsw-alias-state-error-secondary)', color: 'var(--dsw-alias-label-primary)', borderRadius: 'var(--dsw-radius-md)', padding: '10px 12px', fontSize: '12px', lineHeight: 1.5 },
      warn: { border: '1px solid var(--dsw-alias-state-warn-primary)', background: 'var(--dsw-alias-state-warn-tertiary)', color: 'var(--dsw-alias-label-primary)', borderRadius: 'var(--dsw-radius-md)', padding: '10px 12px', fontSize: '12px', lineHeight: 1.5 },
      toast: { position: 'sticky', top: 0, zIndex: 5, padding: '9px 12px', borderRadius: 'var(--dsw-radius-md)', fontSize: '12px', border: '1px solid var(--dsw-alias-border-l3)', background: 'var(--dsw-alias-bg-layer-3)' },
      toastError: { borderColor: 'var(--dsw-alias-state-error-primary)' },
      toastOk: { borderColor: 'var(--dsw-alias-state-success-primary)' },
      pre: { margin: 0, padding: '10px', borderRadius: 'var(--dsw-radius-md)', background: 'var(--dsw-alias-markdown-code-block)', color: 'var(--dsw-alias-label-primary)', fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '320px', overflow: 'auto' },
      table: { width: '100%', borderCollapse: 'collapse', fontSize: '12px' },
      th: { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-tertiary)', fontWeight: 500 },
      td: { padding: '6px 8px', borderBottom: '1px solid var(--dsw-alias-border-l1)', verticalAlign: 'top' },
      barTrack: { height: '6px', borderRadius: '999px', background: 'var(--dsw-alias-bg-layer-3)', overflow: 'hidden', minWidth: '60px', flex: '1 1 80px' },
      barFill: { height: '100%', background: 'var(--dsw-alias-state-business-primary)' },
      muted: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px' },
      empty: { border: '1px dashed var(--dsw-alias-border-l3)', borderRadius: 'var(--dsw-radius-lg)', padding: '24px', textAlign: 'center', color: 'var(--dsw-alias-label-tertiary)', fontSize: '13px' },
      scroll: { overflowX: 'auto' },
    }

    function button(label, onClick, options = {}) {
      const style = { ...styles.button, ...(options.kind === 'primary' ? styles.primary : {}), ...(options.kind === 'danger' ? styles.danger : {}), ...(options.style || {}) }
      return h('button', { type: 'button', onClick, disabled: options.disabled, style }, label)
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
      return h('span', { style: { ...styles.badge, ...(kind === 'warn' ? styles.badgeWarn : {}), ...(kind === 'error' ? styles.badgeError : {}), ...(kind === 'ok' ? styles.badgeOk : {}) } }, children)
    }

    function Card({ title, actions, children }) {
      return h('section', { style: styles.card },
        title || actions ? h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
          title ? h('h3', { style: styles.cardTitle }, title) : h('span'),
          actions ? h('div', { style: styles.row }, actions) : null) : null,
        children)
    }

    function Field({ label, children, style }) {
      return h('label', { style: { ...styles.field, ...(style || {}) } }, h('span', { style: styles.label }, label), children)
    }

    function Empty({ children }) {
      return h('div', { style: styles.empty }, children)
    }

    function Failure({ error, onRetry }) {
      if (!error) return null
      return h('div', { style: styles.alert, role: 'alert' },
        h('div', null, error),
        onRetry ? h('div', { style: { marginTop: '8px' } }, button('重试', onRetry)) : null)
    }

    function Toast({ toast, onClose }) {
      useEffect(() => {
        if (!toast) return undefined
        const timer = setTimeout(onClose, 4000)
        return () => clearTimeout(timer)
      }, [toast, onClose])
      if (!toast) return null
      return h('div', {
        style: { ...styles.toast, ...(toast.kind === 'error' ? styles.toastError : styles.toastOk) },
        role: toast.kind === 'error' ? 'alert' : 'status',
      }, h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
        h('span', null, toast.text),
        h('button', { type: 'button', onClick: onClose, style: styles.link, 'aria-label': '关闭提示' }, '关闭')))
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
        h('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height: '120px', role: 'img', 'aria-label': `最近 28 天共写入 ${total} 条记忆` },
          h('line', { x1: pad, y1: height - pad, x2: width - pad, y2: height - pad, stroke: 'var(--dsw-alias-border-l2)', strokeWidth: 1 }),
          h('polyline', { points, fill: 'none', stroke: 'var(--dsw-alias-state-business-primary)', strokeWidth: 2, strokeLinejoin: 'round' }),
          days.map((day, index) => h('circle', { key: day.key, cx: pad + index * step, cy: height - pad - (day.count / max) * (height - pad * 2), r: day.count > 0 ? 2.5 : 0, fill: 'var(--dsw-alias-state-business-primary)' }))),
        h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
          h('span', { style: styles.muted }, days[0]?.key),
          h('span', { style: styles.muted }, `28 天合计 ${total} 条`),
          h('span', { style: styles.muted }, days[days.length - 1]?.key)))
    }

    function Bars({ title, counts }) {
      const entries = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]).slice(0, 8)
      const max = Math.max(1, ...entries.map(entry => entry[1]))
      return h(Card, { title },
        entries.length === 0 ? h('div', { style: styles.muted }, '暂无数据') : entries.map(([name, count]) => h('div', { key: name, style: styles.row },
          h('span', { style: { ...styles.muted, flex: '0 1 110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: name }, name),
          h('div', { style: styles.barTrack }, h('div', { style: { ...styles.barFill, width: `${(count / max) * 100}%` } })),
          h('span', { style: { ...styles.muted, minWidth: '28px', textAlign: 'right' } }, count))))
    }

    function OverviewTab({ snapshot, refreshStatus, notify }) {
      const [wakeup, setWakeup] = useState(null)
      const [error, setError] = useState('')
      const loadWakeup = useCallback(async () => {
        try {
          setWakeup(await request('/wakeup'))
          setError('')
        } catch (failure) { setError(failure.message) }
      }, [])
      useEffect(() => { void loadWakeup() }, [loadWakeup])
      const stats = snapshot?.stats
      const ready = snapshot?.state === 'ready'
      return h(React.Fragment, null,
        !snapshot ? h('div', { style: styles.warn, role: 'status' }, '正在读取记忆宫殿状态…') : null,
        snapshot && !ready ? h('div', { style: snapshot.state === 'loading' ? styles.warn : styles.alert, role: 'alert' },
          h('strong', null, snapshot?.state === 'loading' ? '数据层正在加载…' : '内存宫殿数据层不可用'),
          snapshot?.error ? h('div', { style: { marginTop: '6px' } }, snapshot.error) : null,
          snapshot?.hint ? h('div', { style: { marginTop: '6px' } }, `提示：${snapshot.hint}`) : null,
          h('div', { style: { marginTop: '8px' } }, button('重新检查', () => { void refreshStatus() }))) : null,
        h('div', { style: styles.grid },
          h(Card, { title: '记忆总量' }, h('div', { style: styles.metric }, stats?.total ?? '—'), h('div', { style: styles.metricLabel }, '条（含分块）')),
          h(Card, { title: '存储占用' }, h('div', { style: styles.metric }, stats ? `${stats.storageSizeKb}` : '—'), h('div', { style: styles.metricLabel }, 'KB（数据库 + WAL）')),
          h(Card, { title: '会话' }, h('div', { style: styles.metric }, stats?.sessions ?? '—'), h('div', { style: styles.metricLabel }, '个已记录会话')),
          h(Card, { title: '项目' }, h('div', { style: styles.metric }, stats ? Object.keys(stats.projects).length : '—'), h('div', { style: styles.metricLabel }, '个记忆房间')),
          h(Card, { title: '向量后端' }, h('div', { style: styles.row }, h(Badge, { kind: snapshot?.models?.embedding === 'ready' ? 'ok' : 'warn' }, snapshot?.models?.embedding || 'idle')), h('div', { style: styles.metricLabel }, snapshot?.fts?.enabled ? '关键字索引已启用' : '关键字索引未启用')),
          h(Card, { title: '自动捕获' }, h('div', { style: styles.metric }, snapshot?.config?.autoCapture ? '开' : '关'), h('div', { style: styles.metricLabel }, `唤醒注入 ${snapshot?.config?.wakeUpEnabled ? '开启' : '关闭'}`))),
        stats && stats.oldest ? h('div', { style: styles.muted }, `时间范围：${fmtDay(stats.oldest)} → ${fmtDay(stats.newest)} · 平均 ${stats.avgContentLength} 字符/条`) : null,
        h(Card, { title: '最近 28 天活动' }, h(Sparkline, { timeline: stats?.timeline })),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' } },
          h(Bars, { title: '项目分布', counts: stats?.projects }),
          h(Bars, { title: '话题分布', counts: stats?.topics }),
          h(Bars, { title: '来源分布', counts: stats?.sources })),
        h(Card, { title: '唤醒注入预览', actions: button('刷新预览', loadWakeup) },
          h(Failure, { error }),
          wakeup?.text ? h('pre', { style: styles.pre }, wakeup.text) : h('div', { style: styles.muted }, '当前没有可注入的记忆（或唤醒注入已关闭）。'),
          wakeup?.tokens ? h('div', { style: styles.muted }, `估算 ${wakeup.tokens} tokens · 项目：${wakeup.project || '全部'}`) : null,
          h('div', { style: styles.muted }, '记忆内容以“不可信参考数据”包裹，模型不会把其中的文字当作指令。')))
    }

    function MemoriesTab({ snapshot, project, setProject, refreshStatus, notify }) {
      const [filters, setFilters] = useState({ topic: '', source: '', q: '', sort: 'newest' })
      const [data, setData] = useState(null)
      const [offset, setOffset] = useState(0)
      const [expanded, setExpanded] = useState('')
      const [confirmId, setConfirmId] = useState('')
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [draft, setDraft] = useState({ content: '', project: '', topic: '', source: 'manual-save', importance: 0.8 })
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
      async function save() {
        const content = draft.content.trim()
        if (!content) { notify('error', '记忆内容不能为空'); return }
        setBusy(true)
        try {
          try {
            const search = await request('/search', { query: content, n_results: 1 })
            const hit = search.results?.[0]
            if (hit && hit.similarity >= 0.9 && !window.confirm(`发现相似记忆（${pct(hit.similarity)}）：\n${hit.text.slice(0, 200)}\n\n仍然保存？`)) {
              setBusy(false)
              return
            }
          } catch { /* duplicate check is advisory */ }
          const saved = await request('/memories', {
            content,
            project: draft.project || project || undefined,
            topic: draft.topic || undefined,
            source: draft.source || undefined,
            importance: Number(draft.importance),
          })
          notify('ok', saved.status === 'duplicate' ? '相同内容已存在，未重复写入' : '记忆已保存')
          setDraft({ content: '', project: '', topic: '', source: 'manual-save', importance: 0.8 })
          setOffset(0)
          await load()
          await refreshStatus()
        } catch (failure) { notify('error', failure.message) } finally { setBusy(false) }
      }
      async function remove(id) {
        if (confirmId !== id) {
          setConfirmId(id)
          setTimeout(() => setConfirmId(current => current === id ? '' : current), 5000)
          return
        }
        setBusy(true)
        try {
          await request('/memories/delete', { id })
          notify('ok', '记忆已删除')
          setConfirmId('')
          if (data?.items?.length === 1 && offset > 0) setOffset(Math.max(0, offset - limit))
          else await load()
          await refreshStatus()
        } catch (failure) { notify('error', failure.message) } finally { setBusy(false) }
      }
      const pages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1
      const page = Math.floor(offset / limit) + 1
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
        h(Card, { title: '筛选' },
          h('div', { style: styles.row },
            h(Field, { label: '项目' }, h('input', { style: styles.input, value: project, placeholder: '全部项目', onChange: event => { setProject(event.target.value.trim()); setOffset(0) } })),
            h(Field, { label: '话题' }, h('input', { style: styles.input, value: filters.topic, placeholder: '全部话题', onChange: event => { setFilters({ ...filters, topic: event.target.value }); setOffset(0) } })),
            h(Field, { label: '来源' }, h('input', { style: styles.input, value: filters.source, placeholder: '全部来源', onChange: event => { setFilters({ ...filters, source: event.target.value }); setOffset(0) } })),
            h(Field, { label: '关键字' }, h('input', { style: styles.input, value: filters.q, placeholder: '内容包含…', onChange: event => { setFilters({ ...filters, q: event.target.value }); setOffset(0) } })),
            h(Field, { label: '排序' }, h('select', { style: styles.input, value: filters.sort, onChange: event => { setFilters({ ...filters, sort: event.target.value }); setOffset(0) } },
              h('option', { value: 'newest' }, '最新优先'),
              h('option', { value: 'oldest' }, '最早优先'),
              h('option', { value: 'importance' }, '重要度优先'))),
            h(Field, { label: '操作' }, button('刷新', load, { disabled: busy })))),
        h(Card, { title: '新增记忆' },
          h('textarea', { style: styles.textarea, value: draft.content, placeholder: '要记住的内容（含上下文）', onChange: event => setDraft({ ...draft, content: event.target.value }) }),
          h('div', { style: styles.row },
            h(Field, { label: '项目' }, h('input', { style: styles.input, value: draft.project, placeholder: project || '会话项目 / general', onChange: event => setDraft({ ...draft, project: event.target.value }) })),
            h(Field, { label: '话题' }, h('input', { style: styles.input, value: draft.topic, placeholder: '例如 auth、database', onChange: event => setDraft({ ...draft, topic: event.target.value }) })),
            h(Field, { label: '来源' }, h('input', { style: styles.input, value: draft.source, onChange: event => setDraft({ ...draft, source: event.target.value }) })),
            h(Field, { label: `重要度 ${Number(draft.importance).toFixed(2)}` }, h('input', { style: styles.input, type: 'range', min: 0, max: 1, step: 0.05, value: draft.importance, onChange: event => setDraft({ ...draft, importance: Number(event.target.value) }) }))),
          h('div', { style: styles.row }, button('保存记忆', save, { kind: 'primary', disabled: busy || !draft.content.trim() }), h('span', { style: styles.muted }, '保存前会自动做一次相似度检查。'))),
        h(Failure, { error, onRetry: load }),
        data && data.items.length === 0 ? h(Empty, null, '当前筛选下没有记忆。') : null,
        data ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
          data.items.map(item => h('article', { key: item.id, style: styles.item },
            h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
              h('div', { style: styles.meta },
                h(Badge, null, item.project),
                h(Badge, null, item.topic),
                h(Badge, { kind: item.embedded ? 'ok' : 'warn' }, item.embedded ? '已向量化' : '关键字'),
                h('span', null, item.source),
                h('span', null, fmtTime(item.timestamp))),
              h('div', { style: styles.row },
                item.parent_id ? h(Badge, null, `分块 ${item.chunk_index}`) : null,
                h('span', { style: styles.muted }, item.id))),
            h('p', { style: styles.text }, expanded === item.id ? item.content : `${item.content.slice(0, 320)}${item.content.length > 320 ? '…' : ''}`),
            h('div', { style: styles.row },
              item.content.length > 320 ? h('button', { type: 'button', style: styles.link, onClick: () => setExpanded(expanded === item.id ? '' : item.id) }, expanded === item.id ? '收起' : '展开全文') : null,
              h('button', { type: 'button', style: { ...styles.link, color: 'var(--dsw-alias-state-error-primary)' }, disabled: busy, onClick: () => remove(item.id) }, confirmId === item.id ? '再次点击确认删除' : '删除'))))) : null,
        data ? h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
          h('span', { style: styles.muted }, `共 ${data.total} 条 · 第 ${page} / ${pages} 页`),
          h('div', { style: styles.row },
            button('上一页', () => setOffset(Math.max(0, offset - limit)), { disabled: busy || offset === 0 }),
            button('下一页', () => setOffset(offset + limit), { disabled: busy || offset + limit >= data.total }))) : null)
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
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
        h(Card, { title: '语义搜索' },
          h('div', { style: styles.row },
            h(Field, { label: '查询', style: { flex: '3 1 260px' } }, h('input', { style: styles.input, value: query, placeholder: '例如：我们上次怎么解决登录过期？', onChange: event => setQuery(event.target.value), onKeyDown: event => { if (event.key === 'Enter') void search() } })),
            h(Field, { label: '项目' }, h('input', { style: styles.input, value: filters.project, placeholder: '全部项目', onChange: event => setFilters({ ...filters, project: event.target.value }) })),
            h(Field, { label: '话题' }, h('input', { style: styles.input, value: filters.topic, placeholder: '全部话题', onChange: event => setFilters({ ...filters, topic: event.target.value }) })),
            h(Field, { label: '结果数' }, h('input', { style: styles.input, type: 'number', min: 1, max: 20, value: filters.n_results, onChange: event => setFilters({ ...filters, n_results: event.target.value }) })),
            h(Field, { label: '操作' }, h('div', { style: styles.row },
              button(busy ? '搜索中…' : '搜索', search, { kind: 'primary', disabled: busy || !query.trim() }),
              busy ? button('取消', () => controller.current?.abort()) : null)))),
        h(Failure, { error }),
        result ? h(Card, { title: `结果（${result.results.length}）`, actions: result.mode === 'keyword' ? h(Badge, { kind: 'warn' }, '关键字回退') : h(Badge, { kind: 'ok' }, result.mode === 'mixed' ? '语义 + 关键字' : '语义') },
          result.results.length === 0 ? h(Empty, null, '没有匹配的记忆。') : result.results.map(item => h('article', { key: item.id, style: { ...styles.item, marginBottom: '8px' } },
            h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
              h('div', { style: styles.meta }, h(Badge, null, item.project), h(Badge, null, item.topic), h('span', null, fmtTime(item.timestamp))),
              h('div', { style: styles.row },
                h('span', { style: { ...styles.muted, minWidth: '48px' } }, item.similarity > 0 ? pct(item.similarity) : '关键字'),
                h('div', { style: { ...styles.barTrack, maxWidth: '120px' } }, h('div', { style: { ...styles.barFill, width: `${Math.max(2, item.similarity * 100)}%` } })),
                button('复制', () => copy(item.text), { style: styles.link }))),
            h('p', { style: styles.text }, item.text)))) : null)
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
          notify('ok', saved.status === 'updated' ? '实体已更新' : '实体已创建')
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
          await request('/knowledge/triple', {
            subject: tripleDraft.subject.trim(),
            predicate: tripleDraft.predicate.trim(),
            object: tripleDraft.object.trim(),
            valid_from: tripleDraft.valid_from || undefined,
            valid_to: tripleDraft.valid_to || undefined,
            confidence: Number(tripleDraft.confidence),
            project: tripleDraft.project || project || undefined,
          })
          notify('ok', '事实已写入知识图谱')
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
          await request('/knowledge/invalidate', {
            subject: fact.subject,
            predicate: fact.predicate,
            object: fact.object,
            ended: new Date().toISOString(),
          })
          notify('ok', '事实已标记为失效')
          setInvalidateId(null)
          await loadStats()
          if (selected) await loadDetail(selected)
        } catch (failure) { notify('error', failure.message) } finally { setBusy(false) }
      }
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
        h('div', { style: styles.grid },
          h(Card, { title: '实体' }, h('div', { style: styles.metric }, stats?.entityCount ?? '—'), h('div', { style: styles.metricLabel }, '个实体')),
          h(Card, { title: '事实' }, h('div', { style: styles.metric }, stats?.tripleCount ?? '—'), h('div', { style: styles.metricLabel }, `${stats?.activeTriples ?? 0} 条仍有效`)),
          h(Card, { title: '谓语' }, h('div', { style: styles.metric }, stats ? Object.keys(stats.predicates).length : '—'), h('div', { style: styles.metricLabel }, '种关系类型'))),
        h(Failure, { error, onRetry: () => { void loadStats(); void loadEntities() } }),
        h(Card, { title: '实体列表', actions: h('div', { style: styles.row },
          h('input', { style: styles.input, value: entityQuery, placeholder: '搜索实体', onChange: event => setEntityQuery(event.target.value) }),
          button('刷新', loadEntities)) },
          entities.length === 0 ? h(Empty, null, '还没有实体。先添加实体或直接写入一条事实。') : h('div', { style: styles.scroll },
            h('table', { style: styles.table },
              h('thead', null, h('tr', null, h('th', { style: styles.th }, '名称'), h('th', { style: styles.th }, '类型'), h('th', { style: styles.th }, '事实数'), h('th', { style: styles.th }, '操作'))),
              h('tbody', null, entities.map(entity => h('tr', { key: entity.id, style: selected === entity.name ? { background: 'var(--dsw-alias-interactive-bg-hover)' } : undefined },
                h('td', { style: styles.td }, entity.name),
                h('td', { style: styles.td }, entity.type),
                h('td', { style: styles.td }, entity.facts),
                h('td', { style: styles.td }, button(selected === entity.name ? '已选中' : '查看', () => setSelected(entity.name), { style: styles.link })))))))),
        h(Card, { title: '新增实体' },
          h('div', { style: styles.row },
            h(Field, { label: '名称' }, h('input', { style: styles.input, value: entityDraft.name, onChange: event => setEntityDraft({ ...entityDraft, name: event.target.value }) })),
            h(Field, { label: '类型' }, h('input', { style: styles.input, value: entityDraft.entity_type, onChange: event => setEntityDraft({ ...entityDraft, entity_type: event.target.value }) })),
            h(Field, { label: '属性 JSON', style: { flex: '2 1 220px' } }, h('input', { style: styles.input, value: entityDraft.properties, onChange: event => setEntityDraft({ ...entityDraft, properties: event.target.value }) }))),
          button('保存实体', addEntity, { kind: 'primary', disabled: busy })),
        h(Card, { title: '新增事实' },
          h('div', { style: styles.row },
            h(Field, { label: '主语' }, h('input', { style: styles.input, value: tripleDraft.subject, onChange: event => setTripleDraft({ ...tripleDraft, subject: event.target.value }) })),
            h(Field, { label: '谓语' }, h('input', { style: styles.input, value: tripleDraft.predicate, placeholder: 'uses / depends_on', onChange: event => setTripleDraft({ ...tripleDraft, predicate: event.target.value }) })),
            h(Field, { label: '宾语' }, h('input', { style: styles.input, value: tripleDraft.object, onChange: event => setTripleDraft({ ...tripleDraft, object: event.target.value }) })),
            h(Field, { label: '项目' }, h('input', { style: styles.input, value: tripleDraft.project, onChange: event => setTripleDraft({ ...tripleDraft, project: event.target.value }) }))),
          h('div', { style: styles.row },
            h(Field, { label: '生效时间' }, h('input', { style: styles.input, value: tripleDraft.valid_from, placeholder: '2026-01-01（可选）', onChange: event => setTripleDraft({ ...tripleDraft, valid_from: event.target.value }) })),
            h(Field, { label: '失效时间' }, h('input', { style: styles.input, value: tripleDraft.valid_to, placeholder: '可选', onChange: event => setTripleDraft({ ...tripleDraft, valid_to: event.target.value }) })),
            h(Field, { label: '置信度' }, h('input', { style: styles.input, type: 'number', min: 0, max: 1, step: 0.1, value: tripleDraft.confidence, onChange: event => setTripleDraft({ ...tripleDraft, confidence: event.target.value }) }))),
          button('写入事实', addTriple, { kind: 'primary', disabled: busy })),
        selected ? h(Card, { title: `实体详情：${selected}`, actions: button('关闭', () => setSelected(null)) },
          facts.length === 0 ? h(Empty, null, '该实体没有匹配的事实。') : h('div', { style: styles.scroll },
            h('table', { style: styles.table },
              h('thead', null, h('tr', null, h('th', { style: styles.th }, '事实'), h('th', { style: styles.th }, '有效期'), h('th', { style: styles.th }, '项目'), h('th', { style: styles.th }, '操作'))),
              h('tbody', null, facts.map(fact => h('tr', { key: fact.id },
                h('td', { style: styles.td }, `${fact.subject} ${fact.predicate} ${fact.object}`),
                h('td', { style: styles.td }, `${fact.valid_from ? fmtDay(fact.valid_from) : '—'} → ${fact.valid_to ? fmtDay(fact.valid_to) : '现在'}`),
                h('td', { style: styles.td }, fact.project),
                h('td', { style: styles.td }, fact.valid_to ? h(Badge, { kind: 'warn' }, '已失效') : h('button', { type: 'button', style: { ...styles.link, color: 'var(--dsw-alias-state-error-primary)' }, disabled: busy, onClick: () => invalidate(fact) }, invalidateId === fact.id ? '再次点击确认' : '标记失效'))))))),
          h('h4', { style: styles.cardTitle }, '实体时间线'),
          timeline.length === 0 ? h('div', { style: styles.muted }, '暂无时间线。') : timeline.map(fact => h('div', { key: fact.id, style: { ...styles.meta, padding: '4px 0' }, }, h('span', null, `${fact.valid_from || fact.created_at} → ${fact.valid_to || '现在'}`), h('span', null, `${fact.subject} ${fact.predicate} ${fact.object}`)))) : null)
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
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
        h(Failure, { error, onRetry: load }),
        h(Card, { title: '宫殿图', actions: button('刷新', load) },
          !graph ? h('div', { style: styles.muted }, '加载中…') : graph.nodes.length === 0 ? h(Empty, null, '还没有项目房间。保存几条记忆后，项目会自动出现。') : h('div', null,
            h('svg', { viewBox: `0 0 ${layout.width} ${layout.height}`, width: '100%', role: 'img', style: { height: 'auto', display: 'block' }, 'aria-label': `宫殿图：${graph.nodes.length} 个项目、${graph.edges.length} 条隧道` },
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
            graph.nodes.length === 1 ? h('div', { style: styles.warn }, '目前只有一个项目，且没有共享话题。再保存一个项目或让两个项目共享话题后会出现隧道。') : null,
            h('div', { style: styles.muted }, `点击项目节点查看该项目记忆；点击彩色线查看隧道两侧的记忆。线宽表示共享话题的记忆总量（最大 ${maxStrength}）。`))),
        selectedEdge ? h(Card, { title: `隧道：${selectedEdge.projectA} ↔ ${selectedEdge.projectB} · ${selectedEdge.topic}`, actions: button('关闭', () => { setSelectedEdge(null); setTunnel(null) }) },
          busy ? h('div', { style: styles.muted }, '加载隧道记忆…') : tunnel && tunnel.length > 0 ? tunnel.map(item => h('div', { key: item.id, style: { ...styles.item, marginBottom: '8px' } },
            h('div', { style: styles.meta }, h(Badge, null, item.project), h(Badge, null, item.topic), h('span', null, fmtTime(item.timestamp))),
            h('p', { style: styles.text }, item.text))) : h(Empty, null, '这条隧道暂时没有记忆。')) : null,
        graph && graph.edges.length > 0 ? h(Card, { title: '隧道列表' }, h('div', { style: styles.scroll },
          h('table', { style: styles.table },
            h('thead', null, h('tr', null, h('th', { style: styles.th }, '话题'), h('th', { style: styles.th }, '项目 A'), h('th', { style: styles.th }, '项目 B'), h('th', { style: styles.th }, '强度'), h('th', { style: styles.th }, '操作'))),
            h('tbody', null, graph.edges.map((edge, index) => h('tr', { key: `${edge.topic}-${index}` },
              h('td', { style: styles.td }, edge.topic),
              h('td', { style: styles.td }, edge.projectA),
              h('td', { style: styles.td }, edge.projectB),
              h('td', { style: styles.td }, edge.strength),
              h('td', { style: styles.td }, button('查看', () => { void openTunnel(edge) }, { style: styles.link })))))))) : null)
    }

    function DiaryTab({ notify }) {
      const [agentName, setAgentName] = useState(() => {
        try { return window.localStorage.getItem('dsh-mempalace.diary-agent') || 'agent' } catch { return 'agent' }
      })
      const [lastN, setLastN] = useState(10)
      const [entries, setEntries] = useState(null)
      const [draft, setDraft] = useState({ entry: '', topic: 'diary' })
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
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
      async function write() {
        if (!draft.entry.trim()) { notify('error', '日记内容不能为空'); return }
        setBusy(true)
        try {
          await request('/diary', { agent_name: agentName, entry: draft.entry, topic: draft.topic || undefined })
          notify('ok', '日记已写入')
          setDraft({ entry: '', topic: 'diary' })
          await load()
        } catch (failure) { notify('error', failure.message) } finally { setBusy(false) }
      }
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
        h(Card, { title: '日记' },
          h('div', { style: styles.row },
            h(Field, { label: 'Agent 名称' }, h('input', { style: styles.input, value: agentName, onChange: event => setAgentName(event.target.value) })),
            h(Field, { label: '读取条数' }, h('input', { style: styles.input, type: 'number', min: 1, max: 100, value: lastN, onChange: event => setLastN(Number(event.target.value) || 10) })),
            h(Field, { label: '操作' }, button('读取', load))),
          h('textarea', { style: styles.textarea, value: draft.entry, placeholder: '今天的反思、经验或交接笔记…', onChange: event => setDraft({ ...draft, entry: event.target.value }) }),
          h('div', { style: styles.row },
            h(Field, { label: '话题' }, h('input', { style: styles.input, value: draft.topic, onChange: event => setDraft({ ...draft, topic: event.target.value }) })),
            h(Field, { label: '操作' }, button('写入日记', write, { kind: 'primary', disabled: busy || !draft.entry.trim() })))),
        h(Failure, { error, onRetry: load }),
        entries ? h(Card, { title: `最近 ${entries.length} 条（按时间正序）`, actions: button('刷新', load) },
          entries.length === 0 ? h(Empty, null, '还没有日记条目。') : entries.map(entry => h('article', { key: entry.id, style: { ...styles.item, marginBottom: '8px' } },
            h('div', { style: styles.meta }, h(Badge, null, entry.topic), h('span', null, fmtTime(entry.timestamp))),
            h('p', { style: styles.text }, entry.text)))) : null)
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
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
          h(Failure, { error, onRetry: load }),
          h('div', { style: styles.muted }, '加载设置…'))
      }
      const toggle = key => h('input', { type: 'checkbox', checked: Boolean(config[key]), onChange: event => setConfig({ ...config, [key]: event.target.checked }) })
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
        h(Failure, { error, onRetry: load }),
        h(Card, { title: '行为设置' },
          h('div', { style: styles.row },
            h('label', { style: styles.row }, toggle('autoCapture'), '自动捕获真人对话（关闭后不再写入新会话内容）'),
            h('label', { style: styles.row }, toggle('wakeUpEnabled'), '新会话注入唤醒记忆'),
            h('label', { style: styles.row }, toggle('topicInferenceEnabled'), '本地话题推断')),
          h('div', { style: styles.row },
            h(Field, { label: '唤醒 token 上限' }, h('input', { style: styles.input, type: 'number', min: 64, max: 8000, value: config.wakeUpMaxTokens, onChange: event => setConfig({ ...config, wakeUpMaxTokens: Number(event.target.value) }) })),
            h(Field, { label: '默认项目（留空用会话）' }, h('input', { style: styles.input, value: config.defaultProject || '', onChange: event => setConfig({ ...config, defaultProject: event.target.value.trim() || null }) })),
            h(Field, { label: '去重阈值' }, h('input', { style: styles.input, type: 'number', min: 0, max: 1, step: 0.05, value: config.dedupeThreshold, onChange: event => setConfig({ ...config, dedupeThreshold: Number(event.target.value) }) }))),
          h('div', { style: styles.row },
            h(Field, { label: '用户消息最小字符' }, h('input', { style: styles.input, type: 'number', min: 0, value: config.userMinChars, onChange: event => setConfig({ ...config, userMinChars: Number(event.target.value) }) })),
            h(Field, { label: '回答最小字符' }, h('input', { style: styles.input, type: 'number', min: 0, value: config.captureMinChars, onChange: event => setConfig({ ...config, captureMinChars: Number(event.target.value) }) })),
            h(Field, { label: '单条捕获上限' }, h('input', { style: styles.input, type: 'number', min: 100, value: config.captureMaxChars, onChange: event => setConfig({ ...config, captureMaxChars: Number(event.target.value) }) })),
            h(Field, { label: '待写入队列上限' }, h('input', { style: styles.input, type: 'number', min: 1, max: 100, value: config.maxPendingCaptures, onChange: event => setConfig({ ...config, maxPendingCaptures: Number(event.target.value) }) })))),
        h(Card, { title: '模型与网络' },
          h('div', { style: styles.row },
            h(Field, { label: '向量模型' }, h('input', { style: styles.input, value: config.embeddingModel, onChange: event => setConfig({ ...config, embeddingModel: event.target.value }) })),
            h(Field, { label: '话题模型（留空关闭）' }, h('input', { style: styles.input, value: config.topicModel, onChange: event => setConfig({ ...config, topicModel: event.target.value }) })),
            h(Field, { label: '模型缓存目录' }, h('input', { style: styles.input, value: config.modelCacheDir, placeholder: '$DSH_HOME/mempalace/models', onChange: event => setConfig({ ...config, modelCacheDir: event.target.value }) })),
            h(Field, { label: 'HF 端点（镜像）' }, h('input', { style: styles.input, value: config.hfEndpoint, placeholder: 'https://hf-mirror.com', onChange: event => setConfig({ ...config, hfEndpoint: event.target.value }) })),
            h(Field, { label: '模型加载超时（秒）' }, h('input', { style: styles.input, type: 'number', min: 10, max: 900, value: Math.round((config.modelLoadTimeoutMs || 60000) / 1000), onChange: event => setConfig({ ...config, modelLoadTimeoutMs: Number(event.target.value) * 1000 }) }))),
          h('div', { style: styles.row },
            h('label', { style: styles.row }, toggle('keywordsFallback'), '语义不可用时使用关键字检索'),
            button('保存设置', save, { kind: 'primary', disabled: Boolean(busy) }),
            button(busy === 'warmup' ? '加载模型中…' : '预热模型', () => action('warmup', '/models/warmup', data => `模型状态：向量 ${data.result.embedding}，话题 ${data.result.topic}`), { disabled: Boolean(busy) }))),
        h(Card, { title: '诊断' },
          h('div', { style: styles.meta },
            h(Badge, { kind: snapshot?.state === 'ready' ? 'ok' : 'warn' }, `数据层 ${snapshot?.state || 'unknown'}`),
            h(Badge, { kind: snapshot?.models?.embedding === 'ready' ? 'ok' : 'warn' }, `向量 ${snapshot?.models?.embedding || 'idle'}`),
            h(Badge, { kind: snapshot?.models?.topic === 'ready' ? 'ok' : 'warn' }, `话题模型 ${snapshot?.models?.topic || 'idle'}`)),
          snapshot?.error ? h('div', { style: styles.alert }, snapshot.error) : null,
          snapshot?.hint ? h('div', { style: styles.warn }, snapshot.hint) : null,
          diagnostics?.paths ? h('div', { style: { ...styles.muted, display: 'flex', flexDirection: 'column', gap: '3px' } },
            h('span', null, `状态目录：${diagnostics.paths.stateDir}`),
            h('span', null, `数据库：${diagnostics.paths.dbPath}`),
            h('span', null, `身份文件：${diagnostics.paths.identityPath}`)) : null,
          diagnostics?.diagnostics ? h('pre', { style: styles.pre }, JSON.stringify(diagnostics.diagnostics, null, 2)) : h('div', { style: styles.muted }, '未找到 setup 诊断文件；运行 npm run setup:mempalace 后重启服务。'),
          h('div', { style: { ...styles.muted, marginTop: '4px' } }, '模型首次使用时会下载到缓存目录；中国网络可使用 https://hf-mirror.com。自动捕获会把真人对话原文写入本地数据库。')),
        h(Card, { title: '导入 / 导出' },
          h('div', { style: styles.row },
            h('input', { ref: fileRef, type: 'file', accept: 'application/json,.json', 'aria-label': '选择导入文件', onChange: event => { void importFile(event.target.files?.[0]) } }),
            button(busy === 'export' ? '导出中…' : '导出全部数据', download, { disabled: Boolean(busy) })),
          h('div', { style: styles.muted }, '导出为 JSON 附件（先做 WAL checkpoint）。导入上限 10 MB，重复记忆与事实会跳过。'),
          importSummary ? h('pre', { style: styles.pre }, JSON.stringify(importSummary, null, 2)) : null),
        h(Card, { title: '维护' },
          h('div', { style: styles.row },
            button(busy === 'reindex' ? '重建中…' : '重建缺失向量', () => action('reindex', '/reindex', data => `重建完成：更新 ${data.updated}，失败 ${data.failed}`), { disabled: Boolean(busy) }),
            button(busy === 'vacuum' ? '整理中…' : '整理数据库（VACUUM）', () => action('vacuum', '/maintenance/vacuum', '数据库已整理'), { disabled: Boolean(busy) }))))
    }

    function MempalacePanel() {
      const [tab, setTab] = useState('overview')
      const [snapshot, setSnapshot] = useState(null)
      const [toast, setToast] = useState(null)
      const [memoryProject, setMemoryProject] = useState('')
      const [statusError, setStatusError] = useState('')
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
      const openProject = useCallback(project => {
        setMemoryProject(project)
        setTab('memories')
      }, [])
      let content = null
      if (tab === 'overview') content = h(OverviewTab, { snapshot, refreshStatus, notify })
      else if (tab === 'memories') content = h(MemoriesTab, { snapshot, project: memoryProject, setProject: setMemoryProject, refreshStatus, notify })
      else if (tab === 'search') content = h(SearchTab, { project: memoryProject, notify })
      else if (tab === 'knowledge') content = h(KnowledgeTab, { project: memoryProject, notify })
      else if (tab === 'palace') content = h(PalaceTab, { notify, onOpenProject: openProject })
      else if (tab === 'diary') content = h(DiaryTab, { notify })
      else content = h(SettingsTab, { snapshot, refreshStatus, notify })
      return h('div', { style: styles.root, className: 'mempalace-panel' },
        h(Toast, { toast, onClose: closeToast }),
        h('header', { style: styles.header },
          h('div', null,
            h('h2', { style: styles.title }, '记忆宫殿'),
            h('p', { style: styles.subtitle }, '本地持久记忆 · 语义检索 · 宫殿图 · 时序知识图谱 · 日记')),
          h('div', { style: styles.row },
            snapshot?.state === 'ready' ? h(Badge, { kind: 'ok' }, `后端 ${snapshot.stats?.total ?? 0} 条`) : h(Badge, { kind: 'warn' }, `后端 ${snapshot?.state || '未知'}`),
            button('刷新状态', refreshStatus))),
        h(Failure, { error: statusError, onRetry: refreshStatus }),
        h('nav', { style: styles.tabs, 'aria-label': '记忆宫殿标签' },
          TABS.map(([key, label]) => h('button', {
            key,
            type: 'button',
            style: { ...styles.tab, ...(tab === key ? styles.tabActive : {}) },
            'aria-current': tab === key ? 'page' : undefined,
            onClick: () => setTab(key),
          }, label))),
        h('div', { role: 'tabpanel' }, content))
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
