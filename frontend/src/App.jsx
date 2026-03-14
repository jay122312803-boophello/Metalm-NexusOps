import { useEffect, useMemo, useState } from 'react'
import BaseLayout from './layouts/BaseLayout.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Detail from './pages/Detail.jsx'
import History from './pages/History.jsx'
import Overview from './pages/Overview.jsx'
import Settings from './pages/Settings.jsx'

export default function App() {
  const initialNav = useMemo(() => {
    try {
      const raw = localStorage.getItem('nexusops_nav')
      if (!raw) return null
      const obj = JSON.parse(raw)
      if (!obj || typeof obj !== 'object') return null
      if (!obj.page) return null
      if (obj.page === 'detail' && !obj.detailId) return { ...obj, page: 'dashboard' }
      return obj
    } catch {
      return null
    }
  }, [])

  const [page, setPage] = useState(initialNav?.page || 'overview')
  const [detailId, setDetailId] = useState(initialNav?.detailId || null)
  const [detailHistoryId, setDetailHistoryId] = useState(initialNav?.detailHistoryId || null)
  const [returnPage, setReturnPage] = useState(initialNav?.returnPage || 'dashboard')
  const [settingsTab, setSettingsTab] = useState(initialNav?.settingsTab || null)
  const [historyPreset, setHistoryPreset] = useState(null)

  useEffect(() => {
    if (page !== 'history' && historyPreset) setHistoryPreset(null)
  }, [page, historyPreset])

  useEffect(() => {
    try {
      localStorage.setItem(
        'nexusops_nav',
        JSON.stringify({
          page,
          detailId,
          detailHistoryId,
          returnPage,
          settingsTab
        })
      )
    } catch {
    }
  }, [page, detailId, detailHistoryId, returnPage, settingsTab])

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
    if (p === 'history') {
      const date = opts?.date ? String(opts.date) : null
      const status = opts?.status ? String(opts.status) : null
      setHistoryPreset(date || status ? { date, status } : null)
    } else {
      setHistoryPreset(null)
    }
    setPage(p)
    if (id) setDetailId(id)
  }

  const content =
    page === 'settings' ? (
      <Settings initialTab={settingsTab} />
    ) : page === 'history' ? (
      <History onNavigate={navigate} initialPreset={historyPreset} />
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
