import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export default function Tooltip({ content, children, delay = 500, disabled, maxWidth = 320, block }) {
  const text = useMemo(() => {
    if (content === null || content === undefined) return ''
    const s = String(content).trim()
    return s
  }, [content])
  const off = disabled || !text

  const ref = useRef(null)
  const timerRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const clear = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }

  const compute = () => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ top: r.bottom + 10, left: r.left + r.width / 2 })
  }

  useEffect(() => {
    if (!open) return
    compute()
    const onScroll = () => compute()
    const onResize = () => compute()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  useEffect(() => () => clear(), [])

  const onEnter = () => {
    if (off) return
    clear()
    timerRef.current = setTimeout(() => {
      compute()
      setOpen(true)
    }, Math.max(0, Number(delay) || 0))
  }
  const onLeave = () => {
    clear()
    setOpen(false)
  }

  return (
    <>
      {block ? (
        <div ref={ref} className="tooltip-wrap is-block" onMouseEnter={onEnter} onMouseLeave={onLeave} onFocus={onEnter} onBlur={onLeave}>
          {children}
        </div>
      ) : (
        <span ref={ref} className="tooltip-wrap" onMouseEnter={onEnter} onMouseLeave={onLeave} onFocus={onEnter} onBlur={onLeave}>
          {children}
        </span>
      )}
      {open
        ? createPortal(
            <div className="tooltip-pop" style={{ top: pos.top, left: pos.left, maxWidth }}>
              {text}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
