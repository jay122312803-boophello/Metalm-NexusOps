import Icon from '../components/Icon.jsx'

export default function NoAccess({ detail }) {
  return (
    <div className="panel-canvas">
      <div className="panel-frame">
        <div className="empty-state">
          <div className="empty-icon">
            <Icon name="ban" />
          </div>
          <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text-main)' }}>无权限访问</div>
          <div style={{ marginTop: 8, color: 'var(--text-sub)' }}>{detail || '请联系管理员授权后重试'}</div>
        </div>
      </div>
    </div>
  )
}

