import { useMemo, useState } from 'react'
import BaseLayout from './layouts/BaseLayout.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Detail from './pages/Detail.jsx'
import History from './pages/History.jsx'
import Settings from './pages/Settings.jsx'

export default function App() {
  const [page, setPage] = useState('dashboard')
  const [detailId, setDetailId] = useState(null)
  const [detailHistoryId, setDetailHistoryId] = useState(null)
  const [returnPage, setReturnPage] = useState('dashboard')

  const breadcrumb = useMemo(() => {
    if (page === 'settings') return '系统设置'
    if (page === 'history') return '审计日志'
    return '部署管理'
  }, [page])

  const navigate = (p, id, opts = {}) => {
    if (p === 'detail') {
      setReturnPage(page)
      setDetailHistoryId(opts.historyId || null)
    } else {
      setDetailHistoryId(null)
    }
    setPage(p)
    if (id) setDetailId(id)
  }

  const content =
    page === 'settings' ? (
      <Settings />
    ) : page === 'history' ? (
      <History onNavigate={navigate} />
    ) : page === 'detail' ? (
      <Detail taskId={detailId} historyId={detailHistoryId} onBack={() => setPage(returnPage)} />
    ) : (
      <Dashboard onNavigate={navigate} />
    )

  return (
    <BaseLayout page={page} setPage={setPage} breadcrumb={breadcrumb}>
      {content}
    </BaseLayout>
  )
}
