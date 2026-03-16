import Icon from '../components/Icon.jsx'
import ToastHost from '../components/ToastHost.jsx'
import Can from '../components/Can.jsx'
import CopilotWidget from '../components/CopilotWidget.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'

export default function BaseLayout({ page, setPage, breadcrumb, children }) {
  const auth = useAuth()
  const u = auth?.user
  const name = u?.display_name || u?.username || ''
  const avatar = (name || 'U').slice(0, 1).toUpperCase()
  return (
    <div className="app-layout">
      <ToastHost />
      <CopilotWidget />
      <div className="sidebar">
        <div className="brand">
          <Icon name="cube" />
          NexusOps
        </div>
        <div className="menu">
          <Can perm="overview:read">
            <div className={`menu-item ${page === 'overview' ? 'active' : ''}`} onClick={() => setPage('overview')}>
              <Icon name="chart-line" />
              概览大屏
            </div>
          </Can>
          <Can perm="deploy:manage">
            <div
              className={`menu-item ${page === 'dashboard' || page === 'detail' ? 'active' : ''}`}
              onClick={() => setPage('dashboard')}
            >
              <Icon name="table-columns" />
              部署大盘
            </div>
          </Can>
          <Can perm="audit:read">
            <div className={`menu-item ${page === 'history' ? 'active' : ''}`} onClick={() => setPage('history')}>
              <Icon name="clock-rotate-left" />
              审计日志
            </div>
          </Can>
          <Can perm="ai:manage">
            <div className={`menu-item ${page === 'ai_models' ? 'active' : ''}`} onClick={() => setPage('ai_models')}>
              <Icon name="robot" />
              AI 助手配置
            </div>
          </Can>
          <Can perm="settings:access">
            <div className={`menu-item ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')}>
              <Icon name="gears" />
              系统设置
            </div>
          </Can>
        </div>
        <div className="user-panel">
          <div className="avatar">{avatar}</div>
          <div>
            <div style={{ fontWeight: 700 }}>{name || '-'}</div>
            <button className="btn btn-ghost btn-sm" style={{ padding: '0 0', height: 22 }} onClick={() => auth?.logout?.()}>
              退出登录
            </button>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className="icon-btn" type="button" title="通知">
                <Icon name="bell" />
              </button>
              <button className="icon-btn" type="button" title="退出登录" onClick={() => auth?.logout?.()}>
                <Icon name="right-from-bracket" />
              </button>
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
