import Icon from '../components/Icon.jsx'
import ToastHost from '../components/ToastHost.jsx'

export default function BaseLayout({ page, setPage, breadcrumb, children }) {
  return (
    <div className="app-layout">
      <ToastHost />
      <div className="sidebar">
        <div className="brand">
          <Icon name="cube" />
          NexusOps
        </div>
        <div className="menu">
          <div className={`menu-item ${page === 'overview' ? 'active' : ''}`} onClick={() => setPage('overview')}>
            <Icon name="chart-line" />
            概览大屏
          </div>
          <div
            className={`menu-item ${page === 'dashboard' || page === 'detail' ? 'active' : ''}`}
            onClick={() => setPage('dashboard')}
          >
            <Icon name="table-columns" />
            部署大盘
          </div>
          <div className={`menu-item ${page === 'history' ? 'active' : ''}`} onClick={() => setPage('history')}>
            <Icon name="clock-rotate-left" />
            审计日志
          </div>
          <div className={`menu-item ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')}>
            <Icon name="gears" />
            系统设置
          </div>
        </div>
        <div className="user-panel">
          <div className="avatar">A</div>
          <div>
            <div style={{ fontWeight: 500 }}>Admin</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>DevOps Engineer</div>
          </div>
        </div>
      </div>

      <div className="main-content">
        <div className="top-header">
          <div className="top-header-inner">
            <div className="breadcrumb">
              <span>NexusOps</span>
              <span>/</span>
              <span className="current">{breadcrumb}</span>
            </div>
            <div>
              <Icon name="bell" style={{ color: '#94a3b8', cursor: 'pointer' }} />
            </div>
          </div>
        </div>

        <div className="scroll-view">
          <div className="scroll-inner">{children}</div>
        </div>
      </div>
    </div>
  )
}
