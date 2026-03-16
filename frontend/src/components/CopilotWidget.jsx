import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { streamChatCompletions } from '../services/chat.js'

const makeId = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`
const posKey = 'nexusops_copilot_fab_pos'
const fabSize = 54
const fabPad = 22
const clamp = (v, min, max) => Math.min(max, Math.max(min, v))
const panelPad = 8

export default function CopilotWidget() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState('')
  const [fabPos, setFabPos] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [panelPos, setPanelPos] = useState(null)
  const [panelDragging, setPanelDragging] = useState(false)
  const abortRef = useRef(null)
  const listRef = useRef(null)
  const panelRef = useRef(null)
  const dragRef = useRef({ active: false, moved: false, id: null, sx: 0, sy: 0, ox: 0, oy: 0 })
  const suppressClickRef = useRef(false)
  const anchorRef = useRef(null)
  const panelDragRef = useRef({ active: false, id: null, sx: 0, sy: 0, ox: 0, oy: 0, w: 0, h: 0 })

  const messages = useMemo(() => {
    return (items || []).map((m) => ({ role: m.role, content: m.content }))
  }, [items])

  useEffect(() => {
    const getDefault = () => {
      const w = typeof window !== 'undefined' ? window.innerWidth || 0 : 0
      const h = typeof window !== 'undefined' ? window.innerHeight || 0 : 0
      const x = Math.max(0, w - fabPad - fabSize)
      const y = Math.max(0, h - fabPad - fabSize)
      return { x, y }
    }

    const readStored = () => {
      try {
        const raw = localStorage.getItem(posKey) || ''
        if (!raw) return null
        const v = JSON.parse(raw)
        const x = Number(v?.x)
        const y = Number(v?.y)
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null
        return { x, y }
      } catch {
        return null
      }
    }

    const clampToViewport = (p) => {
      const w = window.innerWidth || 0
      const h = window.innerHeight || 0
      const maxX = Math.max(0, w - fabSize)
      const maxY = Math.max(0, h - fabSize)
      return { x: clamp(p.x, 0, maxX), y: clamp(p.y, 0, maxY) }
    }

    const init = clampToViewport(readStored() || getDefault())
    setFabPos(init)

    const onResize = () => {
      setFabPos((prev) => (prev ? clampToViewport(prev) : clampToViewport(getDefault())))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!open) return
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [open, items])

  const close = () => {
    setOpen(false)
    setPanelPos(null)
    setPanelDragging(false)
  }

  const openPanel = () => {
    anchorRef.current = fabPos
    setPanelPos(null)
    setOpen(true)
  }

  useLayoutEffect(() => {
    if (!open) return
    if (panelPos) return
    const anchor = anchorRef.current || fabPos
    const el = panelRef.current
    if (!el || !anchor) return

    const rect = el.getBoundingClientRect()
    const w = window.innerWidth || 0
    const h = window.innerHeight || 0

    const maxX = Math.max(panelPad, w - rect.width - panelPad)
    const maxY = Math.max(panelPad, h - rect.height - panelPad)

    const x = clamp(anchor.x + fabSize - rect.width, panelPad, maxX)
    const yAbove = anchor.y - rect.height - 12
    const yBelow = anchor.y + fabSize + 12
    const y = yAbove >= panelPad ? clamp(yAbove, panelPad, maxY) : clamp(yBelow, panelPad, maxY)
    setPanelPos({ x, y })
  }, [open, panelPos, fabPos])

  const send = async () => {
    const text = (draft || '').trim()
    if (!text || streaming) return
    setError('')

    const uid = makeId()
    const aid = makeId()
    const next = [
      ...(items || []),
      { id: uid, role: 'user', content: text },
      { id: aid, role: 'assistant', content: '', streaming: true }
    ]
    setItems(next)
    setDraft('')
    setStreaming(true)

    const ac = new AbortController()
    abortRef.current = ac

    try {
      await streamChatCompletions({
        messages: next.map((m) => ({ role: m.role, content: m.content })),
        signal: ac.signal,
        onDelta: (delta) => {
          setItems((prev) => {
            const arr = [...(prev || [])]
            const idx = arr.findIndex((x) => x.id === aid)
            if (idx < 0) return prev
            const cur = arr[idx]
            arr[idx] = { ...cur, content: String(cur.content || '') + String(delta || '') }
            return arr
          })
        },
        onFinish: () => {
          setItems((prev) => {
            const arr = [...(prev || [])]
            const idx = arr.findIndex((x) => x.id === aid)
            if (idx < 0) return prev
            const cur = arr[idx]
            arr[idx] = { ...cur, streaming: false }
            return arr
          })
        }
      })
    } catch (e) {
      setError(String(e?.message || e || '请求失败'))
      setItems((prev) => {
        const arr = [...(prev || [])]
        const idx = arr.findIndex((x) => x.id === aid)
        if (idx < 0) return prev
        const cur = arr[idx]
        arr[idx] = { ...cur, streaming: false }
        return arr
      })
    } finally {
      abortRef.current = null
      setStreaming(false)
    }
  }

  const persistFabPos = (p) => {
    try {
      localStorage.setItem(posKey, JSON.stringify(p))
    } catch {
    }
  }

  const onFabPointerDown = (e) => {
    if (open) return
    if (e.button !== undefined && e.button !== 0) return
    if (!fabPos) return
    const el = e.currentTarget
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
    }
    dragRef.current = { active: true, moved: false, id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: fabPos.x, oy: fabPos.y }
    suppressClickRef.current = false
    setDragging(true)
    e.preventDefault()
  }

  const onFabPointerMove = (e) => {
    const d = dragRef.current
    if (!d.active || d.id !== e.pointerId) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) d.moved = true

    const w = window.innerWidth || 0
    const h = window.innerHeight || 0
    const maxX = Math.max(0, w - fabSize)
    const maxY = Math.max(0, h - fabSize)
    const next = { x: clamp(d.ox + dx, 0, maxX), y: clamp(d.oy + dy, 0, maxY) }
    setFabPos(next)
    e.preventDefault()
  }

  const onFabPointerUp = (e) => {
    const d = dragRef.current
    if (!d.active || d.id !== e.pointerId) return
    const el = e.currentTarget
    try {
      el.releasePointerCapture(e.pointerId)
    } catch {
    }
    dragRef.current = { active: false, moved: false, id: null, sx: 0, sy: 0, ox: 0, oy: 0 }
    setDragging(false)
    if (d.moved) {
      suppressClickRef.current = true
      if (fabPos) persistFabPos(fabPos)
    }
    e.preventDefault()
  }

  const onFabClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    openPanel()
  }

  const onPanelPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return
    const el = panelRef.current
    if (!el || !panelPos) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
    }
    const rect = el.getBoundingClientRect()
    panelDragRef.current = {
      active: true,
      id: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      ox: panelPos.x,
      oy: panelPos.y,
      w: rect.width,
      h: rect.height
    }
    setPanelDragging(true)
    e.preventDefault()
  }

  const onPanelPointerMove = (e) => {
    const d = panelDragRef.current
    if (!d.active || d.id !== e.pointerId) return
    const w = window.innerWidth || 0
    const h = window.innerHeight || 0
    const maxX = Math.max(panelPad, w - d.w - panelPad)
    const maxY = Math.max(panelPad, h - d.h - panelPad)
    const next = { x: clamp(d.ox + (e.clientX - d.sx), panelPad, maxX), y: clamp(d.oy + (e.clientY - d.sy), panelPad, maxY) }
    setPanelPos(next)
    e.preventDefault()
  }

  const onPanelPointerUp = (e) => {
    const d = panelDragRef.current
    if (!d.active || d.id !== e.pointerId) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
    }
    panelDragRef.current = { active: false, id: null, sx: 0, sy: 0, ox: 0, oy: 0, w: 0, h: 0 }
    setPanelDragging(false)
    e.preventDefault()
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <>
      {open ? null : (
        <button
          className={`copilot-fab ${dragging ? 'dragging' : ''}`}
          type="button"
          title="智能助手"
          style={fabPos ? { left: fabPos.x, top: fabPos.y } : undefined}
          onPointerDown={onFabPointerDown}
          onPointerMove={onFabPointerMove}
          onPointerUp={onFabPointerUp}
          onClick={onFabClick}
        >
          <Icon name="robot" />
        </button>
      )}

      {open ? (
        <div className="copilot-overlay" onPointerDown={close}>
          <div
            className={`copilot-panel ${panelDragging ? 'dragging' : ''}`}
            ref={panelRef}
            style={panelPos ? { left: panelPos.x, top: panelPos.y } : undefined}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div
              className="copilot-header"
              onPointerDown={onPanelPointerDown}
              onPointerMove={onPanelPointerMove}
              onPointerUp={onPanelPointerUp}
            >
              <div className="copilot-title">
                <span className="copilot-dot" />
                NexusOps Copilot
              </div>
              <button className="copilot-close" type="button" title="关闭" onPointerDown={(e) => e.stopPropagation()} onClick={close}>
                <Icon name="xmark" />
              </button>
            </div>

            <div className="copilot-messages" ref={listRef}>
              {(items || []).length ? null : <div className="copilot-empty">你可以问我：部署状态、审计日志、系统设置等</div>}
              {(items || []).map((m) => {
                const isUser = m.role === 'user'
                return (
                  <div key={m.id} className={`copilot-row ${isUser ? 'user' : 'assistant'}`}>
                    <div className={`copilot-bubble ${isUser ? 'user' : 'assistant'}`}>
                      <span>{m.content}</span>
                      {m.streaming ? <span className="copilot-cursor" /> : null}
                    </div>
                  </div>
                )
              })}
            </div>

            {error ? <div className="copilot-error">{error}</div> : null}

            <div className="copilot-input">
              <textarea
                className="copilot-textarea"
                placeholder="输入问题，Enter 发送，Shift+Enter 换行"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                rows={2}
              />
              <button className="btn btn-primary" type="button" onClick={send} disabled={streaming || !(draft || '').trim()}>
                发送
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
