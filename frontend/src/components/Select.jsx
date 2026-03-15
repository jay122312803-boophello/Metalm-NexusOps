import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import Tooltip from './Tooltip.jsx'

export default function Select({
  value,
  options,
  onChange,
  placeholder,
  disabled,
  className,
  style,
  popWidth,
  align = 'left'
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  const items = useMemo(() => (Array.isArray(options) ? options : []), [options])
  const current = useMemo(() => items.find((x) => String(x.value) === String(value)), [items, value])
  const label = current?.label ?? (value === null || value === undefined || value === '' ? '' : String(value))

  useEffect(() => {
    if (!open) return
    const onDown = (ev) => {
      const el = rootRef.current
      if (!el) return
      if (el.contains(ev.target)) return
      setOpen(false)
    }
    const onKey = (ev) => {
      if (ev.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (v) => {
    if (disabled) return
    if (typeof onChange === 'function') onChange(v)
    setOpen(false)
  }

  const tip = label || placeholder || ''
  return (
    <div ref={rootRef} className={`select ${disabled ? 'is-disabled' : ''} ${open ? 'is-open' : ''} ${className || ''}`} style={style}>
      <Tooltip content={tip}>
        <button
          type="button"
          className="select-btn"
          disabled={!!disabled}
          onClick={(ev) => {
            ev.stopPropagation()
            if (disabled) return
            setOpen((v) => !v)
          }}
        >
          <span className={`select-btn-text ${label ? '' : 'is-placeholder'}`}>{label || placeholder || '请选择'}</span>
          <Icon name="chevron-down" />
        </button>
      </Tooltip>
      {open ? (
        <div
          className={`select-pop ${align === 'right' ? 'align-right' : 'align-left'}`}
          style={popWidth ? { width: popWidth } : undefined}
        >
          {items.length ? (
            items.map((it) => {
              const active = String(it.value) === String(value)
              return (
                <button
                  key={String(it.value)}
                  type="button"
                  className={`select-item ${active ? 'active' : ''}`}
                  onClick={() => pick(it.value)}
                >
                  <span className="select-item-text">{it.label}</span>
                  {active ? <Icon name="check" /> : null}
                </button>
              )
            })
          ) : (
            <div className="select-empty">暂无选项</div>
          )}
        </div>
      ) : null}
    </div>
  )
}
