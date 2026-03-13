export default function Drawer({ title, onClose, children, footer }) {
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(ev) => ev.stopPropagation()}>
        <div className="drawer-header">
          <span>{title}</span>
          <i
            className="fa-solid fa-xmark"
            style={{ cursor: 'pointer', color: '#94a3b8' }}
            onClick={onClose}
          />
        </div>
        <div className="drawer-body">{children}</div>
        {footer ? <div className="drawer-footer">{footer}</div> : null}
      </div>
    </div>
  )
}
