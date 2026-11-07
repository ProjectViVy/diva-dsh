window.__ModuleLoader__.load({
  id: 'dsh-local-asr',
  factory: (require) => {
    const React = require('react')
    const { createElement: h, useCallback, useEffect, useMemo, useRef, useState } = React

    const API = '/dsh-asr/api'

    // The settings page in dsh-local-voice owns configuration and diagnostics;
    // this half only mounts the composer microphone.
    const ASR_CSS = `
      .asr-mic{--a-line:var(--dsw-alias-border-l2,rgba(127,127,127,.24));--a-line-strong:var(--dsw-alias-border-l3,rgba(127,127,127,.4));--a-brand:var(--dsw-alias-brand-primary,#2f6fed);--a-ok:var(--dsw-alias-state-success-primary,#1a7f4b);--a-warn:var(--dsw-alias-state-warn-primary,#a86a00);--a-bad:var(--dsw-alias-state-error-primary,#c43b3b);--a-fg:var(--dsw-alias-label-primary,#1f2329);--a-fg2:var(--dsw-alias-label-secondary,rgba(0,0,0,.64));--a-fg3:var(--dsw-alias-label-tertiary,rgba(0,0,0,.46));--a-bg:var(--dsw-alias-bg-base,#fff);--a-bg1:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.04));--a-bg2:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08))}
      .asr-mic,.asr-mic *{box-sizing:border-box}
      .asr-mic{display:inline-flex;align-items:center;gap:7px}
      .asr-btn{appearance:none;border:1px solid var(--a-line-strong);background:var(--a-bg);color:var(--a-fg);border-radius:8px;padding:5px 11px;font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap}
      .asr-btn:hover:not(:disabled){background:var(--a-bg2)}
      .asr-btn:disabled{opacity:.5;cursor:not-allowed}
      .asr-mic-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--a-fg2,inherit);cursor:pointer}
      .asr-mic-btn:hover:not(:disabled){background:rgba(127,127,127,.14);color:inherit}
      .asr-mic-btn:disabled{opacity:.45;cursor:not-allowed}
      .asr-mic-btn.on{color:#fff;background:var(--dsw-alias-state-error-primary,#c43b3b);border-color:transparent}
      .asr-mic-live{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;color:inherit}
      .asr-mic-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-error-primary,#c43b3b);animation:asr-pulse 1.1s ease-in-out infinite}
      @keyframes asr-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.82)}}
      .asr-mic-level{display:inline-flex;align-items:flex-end;gap:2px;height:14px}
      .asr-mic-level i{width:3px;border-radius:2px;background:currentColor;opacity:.6;display:block}
      .asr-mic-text{max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px}
      .asr-mic-text.bad{color:var(--dsw-alias-state-error-primary,#c43b3b)}
      .asr-mic-round{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border-radius:50%;border:1px solid var(--a-line-strong,rgba(127,127,127,.4));background:transparent;color:inherit;cursor:pointer}
      .asr-mic-round:hover{background:rgba(127,127,127,.14)}
    `

    /** 统一的面板 API 调用：把 code/hint 拼成一句能照做的错误。 */
    async function api(path, body) {
      const res = await fetch(`${API}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      let data = null
      try { data = await res.json() } catch { data = null }
      if (!res.ok || data?.ok === false) {
        const error = new Error([data?.error, data?.hint].filter(Boolean).join('：') || `HTTP ${res.status}`)
        error.code = data?.code
        throw error
      }
      return data
    }

    // ── 浏览器侧录音 ──────────────────────────────────────────────────────
    // 采集用 MediaRecorder，重采样交给 OfflineAudioContext（原生实现），
    // 最后编码成后端唯一接受的 16kHz 单声道 PCM16 WAV。

    /** 把浮点样本编码成规范 WAV。 */
    function encodeWave(samples) {
      const bytes = new Uint8Array(44 + samples.length * 2)
      const view = new DataView(bytes.buffer)
      const text = (at, value) => { for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i) }
      text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ')
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
      view.setUint32(24, 16000, true); view.setUint32(28, 32000, true)
      view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data')
      view.setUint32(40, samples.length * 2, true)
      for (let i = 0; i < samples.length; i++) {
        const value = Math.max(-1, Math.min(1, samples[i]))
        view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true)
      }
      return bytes
    }

    /** Uint8Array → base64（分块避免超长参数）。 */
    function audioBase64(bytes) {
      let text = ''
      for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192))
      return btoa(text)
    }

    /** 把浏览器异常翻译成人话。 */
    function captureMessage(error) {
      if (error?.name === 'NotAllowedError') return '麦克风权限被拒绝，请在浏览器地址栏重新允许'
      if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') return '没有找到可用的麦克风'
      if (error?.name === 'NotReadableError') return '麦克风被其他程序占用'
      return String(error?.message ?? error ?? '录音失败')
    }

    /**
     * 一次录音会话：拿到轨道、开始录制、量电平、停止并返回 WAV。
     * @returns 控制器；`stop()` 之后资源全部释放。
     */
    async function openCapture() {
      if (typeof MediaRecorder === 'undefined') throw new Error('当前浏览器不支持录制音频')
      const devices = navigator.mediaDevices
      if (!devices?.getUserMedia) throw new Error('当前页面拿不到麦克风接口（需要 https 或 localhost）')
      const stream = await devices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })
      const context = new AudioContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = 256
      const samples = new Float32Array(analyser.fftSize)
      context.createMediaStreamSource(stream).connect(analyser)
      const chunks = []
      const recorder = new MediaRecorder(stream)
      recorder.ondataavailable = event => { if (event.data.size > 0) chunks.push(event.data) }
      recorder.start()
      let disposed = false
      const release = () => {
        if (disposed) return
        disposed = true
        try { stream.getTracks().forEach(track => track.stop()) } catch {}
        try { void context.close() } catch {}
      }
      return {
        amplitude() {
          try {
            analyser.getFloatTimeDomainData(samples)
            let sum = 0
            for (const sample of samples) sum += sample * sample
            return Math.sqrt(sum / samples.length)
          } catch { return 0 }
        },
        async stop(maxSeconds) {
          try {
            if (recorder.state === 'recording') {
              await new Promise((resolve, reject) => {
                recorder.onstop = () => resolve()
                recorder.onerror = () => reject(new Error('录音中断'))
                recorder.stop()
              })
            }
            const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
            if (blob.size === 0) throw new Error('没有录到声音')
            const decoded = await context.decodeAudioData(await blob.arrayBuffer())
            const frames = Math.max(1, Math.floor(Math.min(decoded.duration, maxSeconds) * 16000))
            const offline = new OfflineAudioContext(1, frames, 16000)
            const source = offline.createBufferSource()
            source.buffer = decoded
            source.connect(offline.destination)
            source.start()
            const rendered = await offline.startRendering()
            return encodeWave(rendered.getChannelData(0))
          } finally { release() }
        },
        dispose: release,
      }
    }

    // ── 输入框里的麦克风 ──────────────────────────────────────────────────
    // 挂载在 conversation.input.activity：默认是一个小按钮，录音时展开成
    // 「取消 · 计时/电平 · 停止」一行，并把插入位置在开始时锁定一次。
    function MicControl({ sessionId, inputActions, locked, onActiveChange }) {
      const catalogApi = useMemo(() => api, [])
      const [catalog, setCatalog] = useState(null)
      const [phase, setPhase] = useState('idle')
      const [message, setMessage] = useState('')
      const [pending, setPending] = useState('')
      const [elapsed, setElapsed] = useState(0)
      const [level, setLevel] = useState(0)
      const [prepare, setPrepare] = useState(null)
      const active = useRef(null)
      const generation = useRef(0)
      const preparePoll = useRef(null)

      const expanded = phase === 'requesting' || phase === 'recording' || phase === 'transcribing' || (phase === 'feedback' && message !== '')
      useEffect(() => { onActiveChange(expanded); return () => onActiveChange(false) }, [expanded, onActiveChange])

      const refresh = useCallback(async () => {
        try { setCatalog(await catalogApi('/asr/catalog')) } catch (error) { setCatalog(null); setMessage(captureMessage(error)) }
      }, [catalogApi])

      useEffect(() => {
        void refresh()
        // 设置页里下载完模型后，这里最多 30 秒内自己醒来。
        const timer = setInterval(() => { void refresh() }, 30000)
        return () => clearInterval(timer)
      }, [refresh, sessionId])

      const finish = useCallback(async () => {
        const current = active.current
        if (!current || current.phase !== 'recording') return
        current.phase = 'transcribing'
        setPhase('transcribing')
        const run = generation.current
        clearTimeout(current.timer)
        clearInterval(current.ticker)
        try {
          const audio = await current.capture.stop(current.maxSeconds)
          if (run !== generation.current) return
          const result = await catalogApi('/asr/transcribe', { audio: audioBase64(audio), language: catalog?.language })
          if (run !== generation.current) return
          if (!result.text) { setMessage('没听清，再说一次？'); setPhase('feedback'); return }
          if (!inputActions.insertText(result.text, current.span)) { setPending(result.text); setMessage('草稿已经变了，确认一下再插入'); setPhase('feedback'); return }
          setPhase('idle'); setMessage('')
        } catch (error) {
          if (run === generation.current) { setMessage(captureMessage(error)); setPhase('feedback') }
        } finally {
          if (run === generation.current) active.current = null
        }
      }, [catalog, catalogApi, inputActions])

      const cancel = useCallback(() => {
        generation.current += 1
        const current = active.current
        active.current = null
        if (current) { clearTimeout(current.timer); clearInterval(current.ticker); current.capture.dispose() }
        setPhase('idle'); setMessage(''); setPending(''); setElapsed(0); setLevel(0)
      }, [])

      useEffect(() => {
        const escape = event => { if (event.key === 'Escape' && active.current) { event.preventDefault(); cancel() } }
        const hidden = () => { if (document.visibilityState === 'hidden' && active.current) cancel() }
        document.addEventListener('keydown', escape)
        document.addEventListener('visibilitychange', hidden)
        return () => {
          document.removeEventListener('keydown', escape)
          document.removeEventListener('visibilitychange', hidden)
          generation.current += 1
          const current = active.current
          active.current = null
          if (current) { clearTimeout(current.timer); clearInterval(current.ticker); current.capture.dispose() }
          if (preparePoll.current) { clearInterval(preparePoll.current); preparePoll.current = null }
        }
      }, [cancel, sessionId])

      const start = useCallback(async () => {
        if (locked || active.current) return
        const ready = catalog?.engines?.find(engine => engine.id === catalog.engine)?.ready === true
        if (!ready) {
          setMessage(catalog === null ? '语音识别插件没连上，稍后重试' : '识别模型还没准备好，先下载模型')
          setPhase('feedback')
          return
        }
        const run = ++generation.current
        setMessage(''); setPending(''); setElapsed(0); setLevel(0)
        setPhase('requesting')
        const span = inputActions.captureInsertion()
        const maxSeconds = catalog.limits.maxSeconds
        let capture
        try {
          capture = await openCapture()
        } catch (error) {
          if (run === generation.current) { setMessage(captureMessage(error)); setPhase('feedback') }
          return
        }
        if (run !== generation.current) { capture.dispose(); return }
        const session = { capture, span, maxSeconds, phase: 'recording', timer: null, ticker: null }
        active.current = session
        setPhase('recording')
        const began = Date.now()
        session.ticker = setInterval(() => {
          setElapsed((Date.now() - began) / 1000)
          setLevel(capture.amplitude())
        }, 120)
        session.timer = setTimeout(() => { void finish() }, maxSeconds * 1000)
      }, [catalog, finish, inputActions, locked])

      const install = useCallback(async () => {
        try {
          setMessage('正在下载识别模型…')
          const started = await catalogApi('/asr/prepare', {})
          setPrepare(started)
          const poll = setInterval(async () => {
            try {
              const status = await catalogApi('/asr/prepare')
              setPrepare(status)
              if (status.active) return
              clearInterval(poll)
              preparePoll.current = null
              await refresh()
              setMessage(status.ready ? '模型准备好了，再点一次麦克风' : (status.error || '准备结束，但模型仍未就绪'))
            } catch { clearInterval(poll); preparePoll.current = null }
          }, 2000)
          preparePoll.current = poll
        } catch (error) { setMessage(captureMessage(error)) }
      }, [catalogApi, refresh])

      const iconButton = (label, name, onClick) => h('button', { type: 'button', className: 'asr-mic-round', onClick, title: label, 'aria-label': label }, h(Icon, { name, size: 14 }))
      const transfer = prepare?.transfer
      const preparePercent = transfer && transfer.totalAll > 0 ? Math.min(100, Math.round((transfer.receivedAll / transfer.totalAll) * 100)) : 0

      if (!expanded) {
        const ready = catalog?.engines?.find(engine => engine.id === catalog.engine)?.ready === true
        return h('span', { className: 'asr-mic' },
          h('button', {
            type: 'button', className: 'asr-mic-btn', disabled: locked, onClick: () => { void start() },
            title: ready ? '语音转文字' : '识别模型还没准备好（点一下开始下载）', 'aria-label': ready ? '开始语音输入' : '准备语音识别模型',
          }, h(Icon, { name: ready ? 'mic' : 'mic-off', size: 18 })))
      }
      return h('span', { className: 'asr-mic' },
        iconButton('取消录音', 'x', cancel),
        phase === 'recording'
          ? h('span', { className: 'asr-mic-live', role: 'status' },
            h('span', { className: 'asr-mic-dot' }),
            h('span', null, `录音中 ${elapsed.toFixed(1)}s / ${catalog?.limits.maxSeconds ?? 120}s`),
            h('span', { className: 'asr-mic-level', 'aria-hidden': true }, ...[0, 1, 2, 3].map(index => h('i', { key: index, style: { height: `${Math.min(14, 3 + Math.round(level * 40 * (1 - index * 0.2)))}px` } }))))
          : h('span', { className: 'asr-mic-text' + (phase === 'feedback' && message ? ' bad' : ''), role: 'status', title: pending || message },
            phase === 'requesting' ? '正在获取麦克风…'
              : phase === 'transcribing' ? '正在识别…'
                : pending ? '识别完成，等待插入' : (message || (prepare?.active ? `正在下载模型 ${preparePercent}%` : ''))),
        phase === 'recording' ? iconButton('结束并识别', 'stop', () => { void finish() }) : null,
        phase === 'feedback' && pending
          ? h('button', { type: 'button', className: 'asr-btn', onClick: () => { if (inputActions.insertText(pending, inputActions.captureInsertion())) { setPending(''); setMessage(''); setPhase('idle') } } }, '插入')
          : null,
        phase === 'feedback' && !pending
          ? h('span', { className: 'asr-mic', style: { gap: '4px' } },
            catalog?.engines?.find(engine => engine.id === catalog.engine)?.ready === true
              ? iconButton('再录一次', 'mic', () => { void start() })
              : h('button', { type: 'button', className: 'asr-btn', onClick: () => { void install() } }, preparePercent > 0 && preparePercent < 100 ? `下载中 ${preparePercent}%` : '下载模型'),
            iconButton('关闭提示', 'x', () => { setMessage(''); setPhase('idle') }))
          : null)
    }

    /** 麦克风与反馈行上的小图标。 */
    function Icon({ name = 'mic', size = 20 }) {
      const paths = {
        mic: ['M12 4a3 3 0 0 1 3 3v4a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3Z', 'M6 11a6 6 0 0 0 12 0', 'M12 17v3'],
        'mic-off': ['M9 6a3 3 0 0 1 6 0v3', 'M15 12a3 3 0 0 1-5.2 2', 'M6 11a6 6 0 0 0 9.3 5', 'M12 17v3', 'M4 4l16 16'],
        x: ['M7 7l10 10', 'M17 7l-10 10'],
        stop: ['M8 8h8v8H8z'],
      }[name] ?? []
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', 'aria-hidden': true }, ...paths.map((d, index) => h('path', { key: index, d })))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        if (typeof document !== 'undefined') {
          const style = document.createElement('style')
          style.id = 'dsh-local-asr-css'
          style.dataset.plugin = 'dsh-local-asr'
          style.textContent = ASR_CSS
          document.head.appendChild(style)
          ctx.effect(() => () => { style.remove() }, 'dsh-local-asr: microphone styles')
        }
        ctx.slots.inject('conversation.input.activity', () => ctx.slots.register({ name: 'conversation.input.activity' }, MicControl))
      },
    }
  },
})
