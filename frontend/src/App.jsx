import { useMemo, useState } from 'react'
import BaseLayout from './layouts/BaseLayout.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Detail from './pages/Detail.jsx'
import History from './pages/History.jsx'
import Overview from './pages/Overview.jsx'
import Settings from './pages/Settings.jsx'

export default function App() {
  const [page, setPage] = useState('overview')
  const [detailId, setDetailId] = useState(null)
  const [detailHistoryId, setDetailHistoryId] = useState(null)
  const [returnPage, setReturnPage] = useState('dashboard')
  const [settingsTab, setSettingsTab] = useState(null)

  const breadcrumb = useMemo(() => {
    if (page === 'settings') return '系统设置'
    if (page === 'history') return '审计日志'
    if (page === 'overview') return '概览大屏'
    return '部署管理'
  }, [page])

  const navigate = (p, id, opts = {}) => {
    if (p === 'detail') {
      setReturnPage(page)
      setDetailHistoryId(opts.historyId || null)
    } else {
      setDetailHistoryId(null)
    }
    if (p === 'settings') {
      setSettingsTab(opts.tab || null)
    } else {
      setSettingsTab(null)
    }
    setPage(p)
    if (id) setDetailId(id)
  }

  const content =
    page === 'settings' ? (
      <Settings initialTab={settingsTab} />
    ) : page === 'history' ? (
      <History onNavigate={navigate} />
    ) : page === 'overview' ? (
      <Overview onNavigate={navigate} />
    ) : page === 'detail' ? (
      <Detail taskId={detailId} historyId={detailHistoryId} onBack={() => setPage(returnPage)} onNavigate={navigate} />
    ) : (
      <Dashboard onNavigate={navigate} />
    )

  return (
    <BaseLayout page={page} setPage={setPage} breadcrumb={breadcrumb}>
      {content}
    </BaseLayout>
  )
}
