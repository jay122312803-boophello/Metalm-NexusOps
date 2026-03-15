import Icon from './Icon.jsx'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export default function Modal({ title, onClose, children, footer, danger, className = '' }) {
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  const maskDownRef = useRef(null)

  const content = (
    <div
      className="modal-overlay"
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
      <div className={`modal ${className}`.trim()} onPointerDown={(ev) => ev.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {danger ? (
              <span className="modal-danger-icon">
                <Icon name="triangle-exclamation" />
              </span>
            ) : null}
            <span>{title}</span>
          </div>
          <i className="fa-solid fa-xmark modal-close" onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  )

  if (typeof document === 'undefined') return content
  return createPortal(content, document.body)
}
