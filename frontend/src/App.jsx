import { useEffect, useMemo, useState } from 'react'
import BaseLayout from './layouts/BaseLayout.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Detail from './pages/Detail.jsx'
import History from './pages/History.jsx'
import Overview from './pages/Overview.jsx'
import Settings from './pages/Settings.jsx'
import Login from './pages/Login.jsx'
import NoAccess from './pages/NoAccess.jsx'
import { useAuth } from './contexts/AuthContext.jsx'

export default function App() {
  const auth = useAuth()

  const parseRouteFromLocation = () => {
    let path = '/'
    let search = ''
    let hash = ''
    try {
      path = window.location.pathname || '/'
      search = window.location.search || ''
      hash = window.location.hash || ''
    } catch {
      path = '/'
      search = ''
      hash = ''
    }

    const normalize = (p) => {
      const s = String(p || '/')
      return s.length > 1 ? s.replace(/\/+$/, '') : s
    }

    const oldHash = (() => {
      const h = String(hash || '')
      if (!h.startsWith('#/')) return null
      const raw = h.slice(1)
      const idx = raw.indexOf('?')
      const p = idx >= 0 ? raw.slice(0, idx) : raw
      const qs = idx >= 0 ? raw.slice(idx + 1) : ''
      return { path: normalize(p), qs }
    })()

    const params = new URLSearchParams((search || '').replace(/^\?/, ''))

    const p = normalize(path)
    if (p === '/' || p === '') return { page: 'overview' }
    if (p === '/cockpit/overview') return { page: 'overview' }
    if (p === '/deployManage/instanceManage') return { page: 'dashboard' }
    if (p === '/auditManage/auditLog')
      return {
        page: 'history',
        historyPreset: params.get('date') || params.get('status') ? { date: params.get('date'), status: params.get('status') } : null
      }
    if (p === '/systemManage' || p === '/systemManage/serverManage') return { page: 'settings', settingsTab: 'servers' }
    if (p === '/systemManage/repoManage') return { page: 'settings', settingsTab: 'repos' }
    if (p === '/systemManage/accountManage') return { page: 'settings', settingsTab: 'rbac' }
    if (p.startsWith('/deployManage/instanceManage/')) {
      const id = decodeURIComponent(p.slice('/deployManage/instanceManage/'.length))
      if (!id) return { page: 'dashboard' }
      return {
        page: 'detail',
        detailId: id,
        detailHistoryId: params.get('history') || null,
        returnPage: params.get('return') || 'dashboard'
      }
    }

    if (oldHash) {
      const qsParams = new URLSearchParams(oldHash.qs || '')
      const tab = qsParams.get('tab') || null
      const date = qsParams.get('date') || null
      const status = qsParams.get('status') || null
      const historyId = qsParams.get('history') || null
      const ret = qsParams.get('return') || null
      if (oldHash.path === '/overview') return { page: 'overview', _legacyHash: true }
      if (oldHash.path === '/dashboard') return { page: 'dashboard', _legacyHash: true }
      if (oldHash.path === '/settings') return { page: 'settings', settingsTab: tab, _legacyHash: true }
      if (oldHash.path === '/history')
        return { page: 'history', historyPreset: date || status ? { date, status } : null, _legacyHash: true }
      if (oldHash.path.startsWith('/deployments/')) {
        const id = oldHash.path.slice('/deployments/'.length).trim()
        if (!id) return { page: 'dashboard', _legacyHash: true }
        return { page: 'detail', detailId: id, detailHistoryId: historyId, returnPage: ret || 'dashboard', _legacyHash: true }
      }
    }

    return null
  }

  const buildPathFromState = (st) => {
    const p = st?.page || 'overview'
    if (p === 'overview') return { path: '/cockpit/overview', search: '' }
    if (p === 'dashboard') return { path: '/deployManage/instanceManage', search: '' }
    if (p === 'settings') {
      const tab = st?.settingsTab ? String(st.settingsTab) : 'servers'
      if (tab === 'repos') return { path: '/systemManage/repoManage', search: '' }
      if (tab === 'rbac') return { path: '/systemManage/accountManage', search: '' }
      return { path: '/systemManage/serverManage', search: '' }
    }
    if (p === 'history') {
      const q = new URLSearchParams()
      if (st?.historyPreset?.date) q.set('date', String(st.historyPreset.date))
      if (st?.historyPreset?.status) q.set('status', String(st.historyPreset.status))
      const s = q.toString()
      return { path: '/auditManage/auditLog', search: s ? `?${s}` : '' }
    }
    if (p === 'detail') {
      const id = st?.detailId ? String(st.detailId) : ''
      const q = new URLSearchParams()
      if (st?.detailHistoryId) q.set('history', String(st.detailHistoryId))
      if (st?.returnPage) q.set('return', String(st.returnPage))
      const s = q.toString()
      return { path: `/deployManage/instanceManage/${encodeURIComponent(id)}`, search: s ? `?${s}` : '' }
    }
    return { path: '/cockpit/overview', search: '' }
  }

  const initialNav = useMemo(() => {
    const fromLoc = parseRouteFromLocation()
    if (fromLoc) return fromLoc
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
  const [historyPreset, setHistoryPreset] = useState(initialNav?.historyPreset || null)

  useEffect(() => {
    const sync = () => {
      const r = parseRouteFromLocation()
      if (!r) return
      setPage(r.page)
      setDetailId(r.detailId || null)
      setDetailHistoryId(r.detailHistoryId || null)
      setReturnPage(r.returnPage || 'dashboard')
      setSettingsTab(r.settingsTab || null)
      setHistoryPreset(r.historyPreset || null)
      try {
        const cur = window.location.pathname || '/'
        if ((cur === '/' || cur === '') && r.page === 'overview') {
          const next = buildPathFromState({ page: 'overview' })
          window.history.replaceState({}, '', `${next.path}${next.search}`)
        }
        if (cur === '/systemManage' && r.page === 'settings') {
          const next = buildPathFromState({ page: 'settings', settingsTab: r.settingsTab || 'servers' })
          window.history.replaceState({}, '', `${next.path}${next.search}`)
        }
      } catch {
      }
      if (r._legacyHash) {
        const next = buildPathFromState(r)
        try {
          window.history.replaceState({}, '', `${next.path}${next.search}`)
        } catch {
        }
        try {
          if (window.location.hash) window.location.hash = ''
        } catch {
        }
      }
    }

    sync()
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

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

  if (auth?.loading) return null
  if (!auth?.token || !auth?.user) return <Login />

  const navigate = (p, id, opts = {}) => {
    const next = { page: p }
    if (p === 'detail') {
      next.detailId = id || detailId
      next.detailHistoryId = opts?.historyId || null
      next.returnPage = page || 'dashboard'
    } else if (p === 'settings') {
      next.settingsTab = opts?.tab || null
    } else if (p === 'history') {
      const date = opts?.date ? String(opts.date) : null
      const status = opts?.status ? String(opts.status) : null
      next.historyPreset = date || status ? { date, status } : null
    }
    const dst = buildPathFromState(next)
    try {
      window.history.pushState({}, '', `${dst.path}${dst.search}`)
    } catch {
    }
    setPage(next.page)
    setDetailId(next.detailId || null)
    setDetailHistoryId(next.detailHistoryId || null)
    setReturnPage(next.returnPage || 'dashboard')
    setSettingsTab(next.settingsTab || null)
    setHistoryPreset(next.historyPreset || null)
  }

  const content =
    page === 'settings' ? (
      auth.hasPerm('settings:access') ? (
        <Settings initialTab={settingsTab} />
      ) : (
        <NoAccess detail="无权访问系统设置" />
      )
    ) : page === 'history' ? (
      auth.hasPerm('audit:read') ? <History onNavigate={navigate} initialPreset={historyPreset} /> : <NoAccess detail="无权访问审计日志" />
    ) : page === 'overview' ? (
      auth.hasPerm('overview:read') ? <Overview onNavigate={navigate} /> : <NoAccess detail="无权访问概览大屏" />
    ) : page === 'detail' ? (
      auth.hasPerm('deploy:manage') ? (
        <Detail taskId={detailId} historyId={detailHistoryId} onBack={() => navigate(returnPage)} onNavigate={navigate} />
      ) : (
        <NoAccess detail="无权访问部署详情" />
      )
    ) : (
      auth.hasPerm('deploy:manage') ? <Dashboard onNavigate={navigate} /> : <NoAccess detail="无权访问部署大盘" />
    )

  return (
    <BaseLayout
      page={page}
      setPage={(p) => {
        navigate(p)
      }}
      breadcrumb={breadcrumb}
    >
      {content}
    </BaseLayout>
  )
}
