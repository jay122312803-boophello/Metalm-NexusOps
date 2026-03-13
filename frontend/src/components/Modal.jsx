import Icon from './Icon.jsx'

export default function Modal({ title, onClose, children, footer, danger }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(ev) => ev.stopPropagation()}>
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
}

