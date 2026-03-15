import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export default function Drawer({ title, onClose, children, footer }) {
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  const maskDownRef = useRef(null)

  const content = (
    <div
      className="drawer-overlay"
      onPointerDown={(ev) => {
        if (ev.target !== ev.currentTarget) return
        maskDownRef.current = { x: ev.clientX, y: ev.clientY }
      }}
      onPointerUp={(ev) => {
        const start = maskDownRef.current
        maskDownRef.current = null
        if (!start) return
        if (ev.target !== ev.currentTarget) return
        const dx = ev.clientX - start.x
        const dy = ev.clientY - start.y
        const dist = Math.hypot(dx, dy)
        if (dist <= 6) closeRef.current?.()
      }}
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) ev.preventDefault()
      }}
    >
      <div className="drawer" onPointerDown={(ev) => ev.stopPropagation()}>
        <div className="drawer-header">
          <span>{title}</span>
          <i className="fa-solid fa-xmark" style={{ cursor: 'pointer', color: '#94a3b8' }} onClick={onClose} />
        </div>
        <div className="drawer-body">{children}</div>
        {footer ? <div className="drawer-footer">{footer}</div> : null}
      </div>
    </div>
  )

  if (typeof document === 'undefined') return content
  return createPortal(content, document.body)
}
