import { useEffect, useMemo, useRef, useState } from 'react'
import Drawer from '../components/Drawer.jsx'
import Icon from '../components/Icon.jsx'
import Modal from '../components/Modal.jsx'
import Select from '../components/Select.jsx'
import Tooltip from '../components/Tooltip.jsx'
import Can from '../components/Can.jsx'
import { api } from '../services/api.js'

export default function Settings({ initialTab }) {
  const [servers, setServers] = useState([])
  const [repos, setRepos] = useState([])
  const [drawerType, setDrawerType] = useState(null)
  const [activeTab, setActiveTab] = useState('servers')
  const [serverQuery, setServerQuery] = useState('')
  const [serverEnv, setServerEnv] = useState('ALL')
  const [repoQuery, setRepoQuery] = useState('')
  const [rbacQuery, setRbacQuery] = useState('')
  const [showTriggerToken, setShowTriggerToken] = useState(false)
  const [showPrivateToken, setShowPrivateToken] = useState(false)
  const [formServer, setFormServer] = useState({ ssh_user: 'metalm', environment: 'OTHER' })
  const [formRepo, setFormRepo] = useState({ branch: 'master' })
  const [editingId, setEditingId] = useState(null)
  const [repoAuth, setRepoAuth] = useState({ trigger: false, private: false })
  const [repoTokens, setRepoTokens] = useState({ trigger_token: '', private_token: '' })
  const [serverKeyConfigured, setServerKeyConfigured] = useState(false)
  const [serverKey, setServerKey] = useState('')
  const [showServerKey, setShowServerKey] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteError, setDeleteError] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [metricsTarget, setMetricsTarget] = useState(null)
  const [metricsLoading, setMetricsLoading] = useState(false)
  const [metricsError, setMetricsError] = useState(null)
  const [metricsData, setMetricsData] = useState(null)
  const [metricsAuto, setMetricsAuto] = useState(true)
  const metricsTimerRef = useRef(null)
  const [rbacUsers, setRbacUsers] = useState([])
  const [rbacRoles, setRbacRoles] = useState([])
  const [rbacPerms, setRbacPerms] = useState([])
  const [rbacLoading, setRbacLoading] = useState(false)
  const [rbacError, setRbacError] = useState(null)
  const [rbacCreateOpen, setRbacCreateOpen] = useState(false)
  const [rbacCreateForm, setRbacCreateForm] = useState({ username: '', password: '', display_name: '', is_active: true })
  const [rbacCreateRoleOpen, setRbacCreateRoleOpen] = useState(false)
  const [rbacCreateRoleForm, setRbacCreateRoleForm] = useState({ name: '', code: '' })
  const [rbacRolesOpen, setRbacRolesOpen] = useState(null)
  const [rbacRolePick, setRbacRolePick] = useState([])
  const [rbacPermsOpen, setRbacPermsOpen] = useState(null)
  const [rbacPermPick, setRbacPermPick] = useState([])
  const [rbacSaving, setRbacSaving] = useState(false)

  const refresh = async () => {
    const sv = await api.get('/api/servers')
    const rp = await api.get('/api/repos')
    setServers(Array.isArray(sv) ? sv : [])
    setRepos(Array.isArray(rp) ? rp : [])
  }

  const loadRbac = async () => {
    setRbacLoading(true)
    setRbacError(null)
    try {
      const [u, r, p] = await Promise.all([
        api.get('/api/admin/users'),
        api.get('/api/admin/roles'),
        api.get('/api/admin/permissions')
      ])
      setRbacUsers(Array.isArray(u?.users) ? u.users : [])
      setRbacRoles(Array.isArray(r?.roles) ? r.roles : [])
      setRbacPerms(Array.isArray(p?.permissions) ? p.permissions : [])
    } catch (e) {
      setRbacError(e?.message || '加载失败')
    } finally {
      setRbacLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  useEffect(() => {
    if (activeTab !== 'rbac') return
    loadRbac()
  }, [activeTab])

  useEffect(() => {
    if (!rbacRolesOpen) return
    setRbacRolePick(Array.isArray(rbacRolesOpen.role_ids) ? [...rbacRolesOpen.role_ids] : [])
  }, [rbacRolesOpen])

  useEffect(() => {
    if (!rbacPermsOpen) return
    setRbacPermPick(Array.isArray(rbacPermsOpen.permission_ids) ? [...rbacPermsOpen.permission_ids] : [])
  }, [rbacPermsOpen])

  useEffect(() => {
    if (!initialTab) return
    if (initialTab === 'repos' || initialTab === 'servers' || initialTab === 'rbac') setActiveTab(initialTab)
  }, [initialTab])

  const isValidHost = (v) => {
    const s = (v || '').trim()
    if (!s) return false
    const ip = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/
    const host = /^(?=.{1,253}$)(?!-)([a-zA-Z0-9-]{1,63}(?<!-)\.)+[a-zA-Z]{2,63}$|^[a-zA-Z0-9-]{1,63}$/
    return ip.test(s) || host.test(s)
  }

  const isValidGitUrl = (v) => {
    const s = (v || '').trim()
    if (!s) return false
    if (/^https?:\/\//i.test(s)) return true
    if (/^ssh:\/\//i.test(s)) return true
    if (/^git@[^:\s]+:[^\s]+$/i.test(s)) return true
    return false
  }

  const envBadge = (env, serverName) => {
    const e = String(env || '').toUpperCase()
    if (e === 'PROD') return <span className="badge badge-prod">PROD</span>
    if (e === 'TEST') return <span className="badge badge-test">TEST</span>
    if (e === 'DEV') return <span className="badge badge-dev">DEV</span>
    const name = serverName || ''
    const low = name.toLowerCase()
    if (name.includes('生产') || low.includes('prod')) return <span className="badge badge-prod">PROD</span>
    if (name.includes('测试') || low.includes('test')) return <span className="badge badge-test">TEST</span>
    if (name.includes('开发') || low.includes('dev')) return <span className="badge badge-dev">DEV</span>
    return null
  }

  const fmtBytes = (n) => {
    const v = Number(n || 0)
    if (!Number.isFinite(v) || v <= 0) return '0B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let x = v
    let i = 0
    while (x >= 1024 && i < units.length - 1) {
      x /= 1024
      i++
    }
    return `${x.toFixed(i === 0 ? 0 : 1)}${units[i]}`
  }

  const toBytesFromDf = (v) => {
    const n = Number(v)
    if (!Number.isFinite(n) || n <= 0) return 0
    return n * 1024
  }

  const fmtDiskPart = (v) => {
    if (v == null) return '-'
    if (typeof v === 'string' && /[a-zA-Z]/.test(v)) return v
    const n = Number(v)
    if (!Number.isFinite(n) || n <= 0) return '-'
    const bytes = toBytesFromDf(n)
    const tb = Math.floor(bytes / 1024 / 1024 / 1024 / 1024)
    const gb = Math.floor((bytes - tb * 1024 * 1024 * 1024 * 1024) / 1024 / 1024 / 1024)
    if (tb > 0) return `${tb}TB ${gb}GB`
    const g = Math.max(0, Math.round(bytes / 1024 / 1024 / 1024))
    return `${g}GB`
  }

  const clampPct = (v) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return 0
    return Math.max(0, Math.min(100, n))
  }

  const MetricRing = ({ label, percent, value }) => {
    const p = clampPct(percent)
    const color = p >= 90 ? 'var(--danger)' : p >= 70 ? 'var(--warning)' : 'var(--primary)'
    return (
      <div className="metric-ring">
        <div className="metric-ring-circle" style={{ background: `conic-gradient(${color} ${p}%, rgba(148,163,184,0.18) 0)` }}>
          <div className="metric-ring-inner">
            <div className="metric-ring-value">{value}</div>
            <div className="metric-ring-sub">{label}</div>
          </div>
        </div>
      </div>
    )
  }

  const fetchMetrics = async (serverId) => {
    setMetricsLoading(true)
    setMetricsError(null)
    try {
      const res = await api.get(`/api/servers/${serverId}/metrics`)
      if (res?.ok) {
        setMetricsData(res)
      } else {
        const d = res?.detail
        setMetricsError(typeof d === 'string' ? d : d ? JSON.stringify(d) : '获取失败')
      }
    } catch (_) {
      setMetricsError('获取失败')
    } finally {
      setMetricsLoading(false)
    }
  }

  useEffect(() => {
    if (!metricsTarget) return
    fetchMetrics(metricsTarget.id)
  }, [metricsTarget])

  useEffect(() => {
    if (metricsTimerRef.current) {
      clearInterval(metricsTimerRef.current)
      metricsTimerRef.current = null
    }
    if (!metricsTarget) return
    if (!metricsAuto) return
    metricsTimerRef.current = setInterval(() => fetchMetrics(metricsTarget.id), 10000)
    return () => {
      if (metricsTimerRef.current) clearInterval(metricsTimerRef.current)
      metricsTimerRef.current = null
    }
  }, [metricsTarget, metricsAuto])

  const addr = (formServer.address || '').trim()
  const addrOk = addr ? isValidHost(addr) : null
  const gitUrl = (formRepo.url || '').trim()
  const gitOk = gitUrl ? isValidGitUrl(gitUrl) : null

  const handleSubmit = async () => {
    if (drawerType === 'server' && !editingId) await api.post('/api/servers', formServer)
    else if (drawerType === 'server' && editingId) await api.put(`/api/servers/${editingId}`, formServer)
    else if (drawerType === 'repo' && !editingId) {
      const payload = { ...formRepo }
      if ((repoTokens.trigger_token || '').trim() !== '') payload.trigger_token = repoTokens.trigger_token
      if ((repoTokens.private_token || '').trim() !== '') payload.private_token = repoTokens.private_token
      await api.post('/api/repos', payload)
    } else {
      const payload = { ...formRepo }
      if ((repoTokens.trigger_token || '').trim() !== '') payload.trigger_token = repoTokens.trigger_token
      if ((repoTokens.private_token || '').trim() !== '') payload.private_token = repoTokens.private_token
      await api.put(`/api/repos/${editingId}`, payload)
    }
    setDrawerType(null)
    setEditingId(null)
    setShowTriggerToken(false)
    setShowPrivateToken(false)
    setRepoTokens({ trigger_token: '', private_token: '' })
    setRepoAuth({ trigger: false, private: false })
    setServerKey('')
    setServerKeyConfigured(false)
    setShowServerKey(false)
    setFormServer({ ssh_user: 'metalm', environment: 'OTHER' })
    setFormRepo({ branch: 'master' })
    refresh()
  }

  const openCreate = (type) => {
    setEditingId(null)
    setShowTriggerToken(false)
    setShowPrivateToken(false)
    setRepoTokens({ trigger_token: '', private_token: '' })
    setRepoAuth({ trigger: false, private: false })
    setServerKey('')
    setServerKeyConfigured(false)
    setShowServerKey(false)
    setFormServer({ ssh_user: 'metalm', environment: 'OTHER' })
    setFormRepo({ branch: 'master' })
    setDrawerType(type)
  }

  const openEditServer = (s) => {
    setEditingId(s.id)
    setFormServer({
      name: s.name,
      environment: s.environment || 'OTHER',
      address: s.address,
      ssh_user: s.ssh_user || 'metalm',
      deploy_path: s.deploy_path,
      description: s.description || ''
    })
    setServerKey('')
    setServerKeyConfigured(!!s.ssh_key_configured)
    setShowServerKey(false)
    setDrawerType('server')
  }

  const openEditRepo = async (r) => {
    setEditingId(r.id)
    const detail = await api.get(`/api/repos/${r.id}`)
    setRepoAuth(detail?.auth || { trigger: false, private: false })
    setRepoTokens({ trigger_token: '', private_token: '' })
    setShowTriggerToken(false)
    setShowPrivateToken(false)
    setFormRepo({
      name: detail?.name || r.name,
      url: detail?.url || r.url,
      branch: detail?.branch || r.branch || 'master',
      project_id: detail?.project_id || r.project_id || '',
      description: detail?.description || ''
    })
    setDrawerType('repo')
  }

  const openDelete = (type, item) => {
    setDeleteError(null)
    setDeleteTarget({ type, id: item.id, name: item.name })
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await api.del(`/api/${deleteTarget.type}s/${deleteTarget.id}`)
      if (res?.ok) {
        setDeleteTarget(null)
        refresh()
      } else {
        const d = res?.detail
        setDeleteError(typeof d === 'string' ? d : d ? JSON.stringify(d) : '删除失败')
      }
    } finally {
      setDeleting(false)
    }
  }

  const filteredServers = servers.filter((s) => {
    const q = (serverQuery || '').trim().toLowerCase()
    const env = String(serverEnv || '').toUpperCase()
    const envVal = String(s?.environment || 'OTHER').toUpperCase()
    if (env !== 'ALL' && envVal !== env) return false
    if (!q) return true
    return String(s?.name || '').toLowerCase().includes(q) || String(s?.address || '').toLowerCase().includes(q)
  })

  const filteredRepos = repos.filter((r) => {
    const q = (repoQuery || '').trim().toLowerCase()
    if (!q) return true
    return (
      String(r?.name || '').toLowerCase().includes(q) ||
      String(r?.url || '').toLowerCase().includes(q) ||
      String(r?.branch || '').toLowerCase().includes(q)
    )
  })

  const filteredRbacUsers = rbacUsers.filter((u) => {
    const q = (rbacQuery || '').trim().toLowerCase()
    if (!q) return true
    return String(u?.username || '').toLowerCase().includes(q) || String(u?.display_name || '').toLowerCase().includes(q)
  })

  const roleById = useMemo(() => {
    const m = {}
    ;(rbacRoles || []).forEach((r) => {
      if (r?.id) m[r.id] = r
    })
    return m
  }, [rbacRoles])

  return (
    <div className="settings-canvas">
      <div className="settings-frame">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div className="page-head-left">
            <div className="tabs">
              <button className={`tab ${activeTab === 'servers' ? 'active' : ''}`} onClick={() => setActiveTab('servers')}>
                服务器管理
              </button>
              <button className={`tab ${activeTab === 'repos' ? 'active' : ''}`} onClick={() => setActiveTab('repos')}>
                仓库配置
              </button>
              <Can perm="rbac:manage">
                <button className={`tab ${activeTab === 'rbac' ? 'active' : ''}`} onClick={() => setActiveTab('rbac')}>
                  账号权限
                </button>
              </Can>
            </div>
          </div>
        </div>

        <div className="action-bar">
          <div className="action-left">
            <div className="search-box">
              <Icon name="magnifying-glass" />
              <input
                value={activeTab === 'servers' ? serverQuery : activeTab === 'repos' ? repoQuery : rbacQuery}
                onChange={(e) => (activeTab === 'servers' ? setServerQuery(e.target.value) : activeTab === 'repos' ? setRepoQuery(e.target.value) : setRbacQuery(e.target.value))}
                placeholder={activeTab === 'servers' ? '请输入 IP 或名称搜索' : activeTab === 'repos' ? '请输入名称 / URL / 分支搜索' : '请输入账号 / 昵称搜索'}
              />
            </div>
            {activeTab === 'servers' ? (
              <Select
                className="action-select"
                value={serverEnv}
                onChange={(v) => setServerEnv(v)}
                options={[
                  { value: 'ALL', label: '全部环境' },
                  { value: 'PROD', label: 'PROD' },
                  { value: 'TEST', label: 'TEST' },
                  { value: 'DEV', label: 'DEV' },
                  { value: 'OTHER', label: 'OTHER' }
                ]}
              />
            ) : null}
          </div>
          <div>
            {activeTab === 'servers' ? (
              <Can perm="servers:manage">
                <button className="btn btn-primary" onClick={() => openCreate('server')}>
                  <Icon name="plus" /> 新增服务器
                </button>
              </Can>
            ) : activeTab === 'repos' ? (
              <Can perm="repos:manage">
                <button className="btn btn-primary" onClick={() => openCreate('repo')}>
                  <Icon name="plus" /> 新增仓库
                </button>
              </Can>
            ) : activeTab === 'rbac' ? (
              <Can perm="rbac:manage">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button className="btn btn-primary" onClick={() => setRbacCreateOpen(true)}>
                    <Icon name="plus" /> 新增账号
                  </button>
                  <button className="btn btn-outline" onClick={() => setRbacCreateRoleOpen(true)}>
                    <Icon name="plus" /> 新增角色
                  </button>
                </div>
              </Can>
            ) : null}
          </div>
        </div>

        <div className="settings-body">
          {activeTab === 'servers' ? (
            <div className="settings-grid">
              {filteredServers.map((s) => (
                <div key={s.id} className="card">
                  <div className="settings-card-header">
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
                      <span className="status-dot online" style={{ marginTop: 6 }} />
                      <div className="settings-card-title">{s.name}</div>
                      <span className="settings-card-id">{String(s.id || '').slice(0, 6)}</span>
                      {envBadge(s.environment, s.name)}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Can perm="servers:metrics">
                        <Tooltip content="资源监控">
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => {
                              setMetricsAuto(true)
                              setMetricsData(null)
                              setMetricsError(null)
                              setMetricsTarget(s)
                            }}
                          >
                            <Icon name="gauge-high" />
                          </button>
                        </Tooltip>
                      </Can>
                      <Can perm="servers:manage">
                        <Tooltip content="编辑">
                          <button type="button" className="icon-btn" onClick={() => openEditServer(s)}>
                            <Icon name="pen-to-square" />
                          </button>
                        </Tooltip>
                      </Can>
                      <Can perm="servers:manage">
                        <Tooltip content="删除">
                          <button type="button" className="icon-btn" style={{ color: 'var(--danger)' }} onClick={() => openDelete('server', s)}>
                            <Icon name="trash" />
                          </button>
                        </Tooltip>
                      </Can>
                    </div>
                  </div>
                  <div className="settings-card-body">
                    <div className="info-row" style={{ marginBottom: 0 }}>
                      <Icon name="computer" />
                      <span className="info-key">地址</span>
                      <span className="info-value" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                        {s.address || '-'}
                      </span>
                    </div>
                    <div className="info-row" style={{ marginBottom: 0 }}>
                      <Icon name="user" />
                      <span className="info-key">用户</span>
                      <span className="info-value">{s.ssh_user || 'metalm'}</span>
                      {s.ssh_key_configured ? (
                        <span className="badge badge-gray" style={{ fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <Icon name="key" /> SSH Key
                        </span>
                      ) : (
                        <span
                          className="badge badge-gray"
                          style={{ fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(239,68,68,0.10)', color: 'var(--danger)' }}
                        >
                          <Icon name="triangle-exclamation" /> 未配置
                        </span>
                      )}
                    </div>
                    <div className="info-row" style={{ marginBottom: 0 }}>
                      <Icon name="folder-open" />
                      <span className="info-key">目录</span>
                      <span className="info-value" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 12, fontWeight: 700 }}>
                        {s.deploy_path || '-'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
              {filteredServers.length === 0 ? <div className="empty-state" style={{ gridColumn: '1/-1' }}>暂无服务器</div> : null}
            </div>
          ) : activeTab === 'repos' ? (
            <div className="card">
              <table className="repo-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>仓库名称</th>
                    <th>分支</th>
                    <th>Git URL</th>
                    <th>鉴权</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRepos.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <strong>{r.name}</strong>
                          <span style={{ color: 'var(--text-sub)', fontSize: 12, fontFamily: 'monospace' }}>{String(r.id || '').slice(0, 6)}</span>
                        </div>
                      </td>
                      <td>
                        <span className="badge badge-blue">{r.branch}</span>
                      </td>
                      <td>
                        <span style={{ color: '#94a3b8', fontSize: 12 }}>{r.url}</span>
                      </td>
                      <td>
                        {r?.auth?.trigger || r?.auth?.private ? (
                          <Tooltip content="Token已配置">
                            <span style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                              <Icon name="shield-halved" /> 已绑定
                            </span>
                          </Tooltip>
                        ) : (
                          <span style={{ color: '#cbd5e1' }}>未配置</span>
                        )}
                      </td>
                      <td>
                        <Can perm="repos:manage">
                          <Tooltip content="编辑">
                            <button className="btn btn-ghost btn-sm" onClick={() => openEditRepo(r)}>
                              <Icon name="pen-to-square" />
                            </button>
                          </Tooltip>
                        </Can>
                        <Can perm="repos:manage">
                          <Tooltip content="删除">
                            <button className="btn btn-ghost btn-sm" onClick={() => openDelete('repo', r)}>
                              <Icon name="trash" />
                            </button>
                          </Tooltip>
                        </Can>
                      </td>
                    </tr>
                  ))}
                  {filteredRepos.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: 24, color: 'var(--text-sub)', textAlign: 'center' }}>
                        暂无仓库
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : activeTab === 'rbac' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="card">
                <div style={{ padding: '14px 16px', fontWeight: 900 }}>用户</div>
                <table className="repo-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>账号</th>
                      <th>昵称</th>
                      <th>状态</th>
                      <th>角色</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rbacLoading ? (
                      <tr>
                        <td colSpan={5} style={{ padding: 24, color: 'var(--text-sub)', textAlign: 'center' }}>
                          加载中...
                        </td>
                      </tr>
                    ) : rbacError ? (
                      <tr>
                        <td colSpan={5} style={{ padding: 24, color: 'var(--danger)', textAlign: 'center' }}>
                          {rbacError}
                        </td>
                      </tr>
                    ) : (
                      <>
                        {filteredRbacUsers.map((u) => (
                          <tr key={u.id}>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                                <strong>{u.username}</strong>
                                <span style={{ color: 'var(--text-sub)', fontSize: 12, fontFamily: 'monospace' }}>{String(u.id || '').slice(0, 6)}</span>
                              </div>
                            </td>
                            <td>{u.display_name || '-'}</td>
                            <td>
                              <span style={{ color: u.is_active ? 'var(--success)' : 'var(--text-sub)', fontWeight: 700 }}>{u.is_active ? '启用' : '禁用'}</span>
                            </td>
                            <td>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {(u.role_ids || []).map((rid) => (
                                  <span key={rid} className="badge badge-gray" style={{ fontFamily: 'inherit' }}>
                                    {roleById[rid]?.name || '角色'}
                                  </span>
                                ))}
                                {!u.role_ids || u.role_ids.length === 0 ? <span style={{ color: 'var(--text-sub)' }}>-</span> : null}
                              </div>
                            </td>
                            <td>
                              <Tooltip content="分配角色">
                                <button className="btn btn-ghost btn-sm" onClick={() => setRbacRolesOpen(u)}>
                                  <Icon name="user-shield" />
                                </button>
                              </Tooltip>
                              <Tooltip content={u.is_active ? '禁用账号' : '启用账号'}>
                                <button
                                  className="btn btn-ghost btn-sm"
                                  onClick={async () => {
                                    await api.put(`/api/admin/users/${u.id}`, { is_active: !u.is_active })
                                    loadRbac()
                                  }}
                                >
                                  <Icon name={u.is_active ? 'ban' : 'check'} />
                                </button>
                              </Tooltip>
                              <Tooltip content="强制下线">
                                <button
                                  className="btn btn-ghost btn-sm"
                                  onClick={async () => {
                                    await api.post(`/api/admin/users/${u.id}/kick`, {})
                                  }}
                                >
                                  <Icon name="right-from-bracket" />
                                </button>
                              </Tooltip>
                            </td>
                          </tr>
                        ))}
                        {filteredRbacUsers.length === 0 ? (
                          <tr>
                            <td colSpan={5} style={{ padding: 24, color: 'var(--text-sub)', textAlign: 'center' }}>
                              暂无账号
                            </td>
                          </tr>
                        ) : null}
                      </>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="card">
                <div style={{ padding: '14px 16px', fontWeight: 900 }}>角色</div>
                <table className="repo-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>名称</th>
                      <th>编码</th>
                      <th>权限数</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rbacLoading ? (
                      <tr>
                        <td colSpan={4} style={{ padding: 24, color: 'var(--text-sub)', textAlign: 'center' }}>
                          加载中...
                        </td>
                      </tr>
                    ) : rbacError ? (
                      <tr>
                        <td colSpan={4} style={{ padding: 24, color: 'var(--danger)', textAlign: 'center' }}>
                          {rbacError}
                        </td>
                      </tr>
                    ) : (
                      <>
                        {(rbacRoles || []).map((r) => (
                          <tr key={r.id}>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                                <strong>{r.name}</strong>
                                <span style={{ color: 'var(--text-sub)', fontSize: 12, fontFamily: 'monospace' }}>{String(r.id || '').slice(0, 6)}</span>
                              </div>
                            </td>
                            <td>
                              <span className="badge badge-gray" style={{ fontFamily: 'inherit' }}>
                                {r.code}
                              </span>
                            </td>
                            <td style={{ color: 'var(--text-sub)' }}>{Array.isArray(r.permission_ids) ? r.permission_ids.length : 0}</td>
                            <td>
                              <Tooltip content="配置权限">
                                <button className="btn btn-ghost btn-sm" onClick={() => setRbacPermsOpen(r)}>
                                  <Icon name="sliders" />
                                </button>
                              </Tooltip>
                            </td>
                          </tr>
                        ))}
                        {!rbacRoles || rbacRoles.length === 0 ? (
                          <tr>
                            <td colSpan={4} style={{ padding: 24, color: 'var(--text-sub)', textAlign: 'center' }}>
                              暂无角色
                            </td>
                          </tr>
                        ) : null}
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>

        <div className="settings-pager">
          <div className="settings-pager-left">
            共 {activeTab === 'servers' ? filteredServers.length : activeTab === 'repos' ? filteredRepos.length : filteredRbacUsers.length} 条
          </div>
          <div className="settings-pager-right">
            <button className="btn btn-ghost btn-sm" disabled>
              <Icon name="chevron-left" />
            </button>
            <span className="settings-page-num">1</span>
            <button className="btn btn-ghost btn-sm" disabled>
              <Icon name="chevron-right" />
            </button>
          </div>
        </div>
      </div>

      {drawerType ? (
        <Drawer
          title={
            drawerType === 'server'
              ? editingId
                ? '编辑服务器'
                : '接入服务器'
              : editingId
                ? '编辑仓库'
                : '关联 GitLab 仓库'
          }
          onClose={() => {
            setDrawerType(null)
            setEditingId(null)
          }}
          footer={[
            <button key="c" className="btn btn-outline" onClick={() => { setDrawerType(null); setEditingId(null) }}>
              取消
            </button>,
            <button key="ok" className="btn btn-primary" onClick={handleSubmit}>
              {editingId ? '保存修改' : '确认添加'}
            </button>
          ]}
        >
          {drawerType === 'server' ? (
            <>
              <div className="form-item">
                <label className="form-label">
                  服务器名称 <span className="req-star">*</span>
                </label>
                <input
                  className="form-input"
                  placeholder="如: 生产环境-01"
                  value={formServer.name || ''}
                  onChange={(e) => setFormServer({ ...formServer, name: e.target.value })}
                />
              </div>
              <div className="form-item">
                <label className="form-label">
                  主机地址 <span className="req-star">*</span>
                </label>
                <div className="input-wrap">
                  <input
                    className="form-input"
                    placeholder="IP 或域名，如 192.168.1.10"
                    value={formServer.address || ''}
                    onChange={(e) => setFormServer({ ...formServer, address: e.target.value })}
                  />
                  {addrOk === null ? (
                    <i className="fa-solid fa-circle input-icon neutral" style={{ fontSize: 9 }} />
                  ) : (
                    <i className={`fa-solid fa-${addrOk ? 'circle-check' : 'circle-xmark'} input-icon ${addrOk ? 'ok' : 'bad'}`} />
                  )}
                </div>
              </div>
              <div className="form-item">
                <label className="form-label">
                  部署路径 <span className="req-star">*</span>
                </label>
                <input
                  className="form-input"
                  placeholder="/home/metalm/deploy/NexusOps/"
                  value={formServer.deploy_path || ''}
                  onChange={(e) => setFormServer({ ...formServer, deploy_path: e.target.value })}
                />
              </div>
              <div className="form-item">
                <label className="form-label">环境标识</label>
                <Select
                  className="form-input"
                  value={formServer.environment || 'OTHER'}
                  onChange={(v) => setFormServer({ ...formServer, environment: v })}
                  options={[
                    { value: 'PROD', label: 'PROD（生产）' },
                    { value: 'TEST', label: 'TEST（测试）' },
                    { value: 'DEV', label: 'DEV（开发）' },
                    { value: 'OTHER', label: 'OTHER（其他）' }
                  ]}
                />
              </div>
              <div className="form-item">
                <label className="form-label">
                  SSH 登录用户 <span className="req-star">*</span>
                </label>
                <input
                  className="form-input"
                  placeholder="如: metalm"
                  value={formServer.ssh_user || 'metalm'}
                  onChange={(e) => setFormServer({ ...formServer, ssh_user: e.target.value })}
                />
              </div>
              <div className="form-item">
                <label className="form-label">
                  SSH 私钥 <span className="req-star">*</span>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ color: 'var(--text-sub)', fontSize: 12 }}>
                    {editingId && serverKeyConfigured ? '已配置（留空不变，输入新值覆盖）' : '可选'}
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowServerKey((v) => !v)}>
                    <Icon name={showServerKey ? 'eye-slash' : 'eye'} /> {showServerKey ? '隐藏' : '显示'}
                  </button>
                </div>
                <textarea
                  className="form-input"
                  style={{
                    minHeight: 140,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    filter: showServerKey ? 'none' : 'blur(6px)'
                  }}
                  placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----'}
                  value={serverKey}
                  onChange={(e) => {
                    const v = e.target.value
                    setServerKey(v)
                    setFormServer((p) => ({ ...p, ssh_key: v }))
                  }}
                />
              </div>
            </>
          ) : (
            <>
              <div className="form-item">
                <label className="form-label">
                  仓库名称 <span className="req-star">*</span>
                </label>
                <input
                  className="form-input"
                  placeholder="如: Backend API"
                  value={formRepo.name || ''}
                  onChange={(e) => setFormRepo({ ...formRepo, name: e.target.value })}
                />
              </div>
              <div className="form-item">
                <label className="form-label">
                  Git URL <span className="req-star">*</span>
                </label>
                <div className="input-wrap">
                  <input
                    className="form-input"
                    placeholder="https://gitlab.com/... 或 git@host:group/repo.git"
                    value={formRepo.url || ''}
                    onChange={(e) => setFormRepo({ ...formRepo, url: e.target.value })}
                  />
                  {gitOk === null ? (
                    <i className="fa-solid fa-circle input-icon neutral" style={{ fontSize: 9 }} />
                  ) : (
                    <i className={`fa-solid fa-${gitOk ? 'circle-check' : 'circle-xmark'} input-icon ${gitOk ? 'ok' : 'bad'}`} />
                  )}
                </div>
              </div>
              <div className="form-item">
                <label className="form-label">
                  分支 <span className="req-star">*</span>
                </label>
                <input
                  className="form-input"
                  value={formRepo.branch || 'master'}
                  onChange={(e) => setFormRepo({ ...formRepo, branch: e.target.value })}
                />
              </div>
              <div className="form-item">
                <label className="form-label">Trigger Token (CI)</label>
                <div className="input-wrap">
                  <input
                    className="form-input"
                    type={showTriggerToken ? 'text' : 'password'}
                    placeholder={editingId && repoAuth?.trigger ? '已配置（留空不变，输入新值覆盖）' : '可选'}
                    value={repoTokens.trigger_token}
                    onChange={(e) => setRepoTokens({ ...repoTokens, trigger_token: e.target.value })}
                  />
                  <Tooltip content={showTriggerToken ? '隐藏' : '显示'}>
                    <div className="input-toggle" onClick={() => setShowTriggerToken((v) => !v)}>
                      <Icon name={showTriggerToken ? 'eye-slash' : 'eye'} />
                    </div>
                  </Tooltip>
                </div>
              </div>
              <div className="form-item">
                <label className="form-label">Private Token (API)</label>
                <div className="input-wrap">
                  <input
                    className="form-input"
                    type={showPrivateToken ? 'text' : 'password'}
                    placeholder={editingId && repoAuth?.private ? '已配置（留空不变，输入新值覆盖）' : '可选'}
                    value={repoTokens.private_token}
                    onChange={(e) => setRepoTokens({ ...repoTokens, private_token: e.target.value })}
                  />
                  <Tooltip content={showPrivateToken ? '隐藏' : '显示'}>
                    <div className="input-toggle" onClick={() => setShowPrivateToken((v) => !v)}>
                      <Icon name={showPrivateToken ? 'eye-slash' : 'eye'} />
                    </div>
                  </Tooltip>
                </div>
              </div>
            </>
          )}
        </Drawer>
      ) : null}

      {metricsTarget ? (
        <Drawer
          title={`${metricsTarget.name} 资源监控`}
          onClose={() => {
            if (metricsTimerRef.current) clearInterval(metricsTimerRef.current)
            metricsTimerRef.current = null
            setMetricsTarget(null)
            setMetricsData(null)
            setMetricsError(null)
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-sub)', fontSize: 13 }}>
              <span className="badge badge-gray" style={{ fontFamily: 'inherit' }}>
                {metricsAuto ? '自动刷新 10s' : '已暂停'}
              </span>
              {metricsData?.ts ? <span>更新于 {new Date(metricsData.ts).toLocaleTimeString()}</span> : <span>未更新</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="btn btn-outline btn-sm" onClick={() => setMetricsAuto((v) => !v)}>
                <Icon name={metricsAuto ? 'circle-pause' : 'circle-play'} /> {metricsAuto ? '暂停' : '开启'}
              </button>
              <button className="btn btn-outline btn-sm" disabled={metricsLoading} onClick={() => fetchMetrics(metricsTarget.id)}>
                <Icon name={metricsLoading ? 'spinner fa-spin' : 'arrows-rotate'} /> 刷新
              </button>
            </div>
          </div>

          {metricsError ? (
            <div
              style={{
                marginBottom: 14,
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid rgba(239,68,68,0.25)',
                background: 'rgba(239,68,68,0.06)',
                color: '#b91c1c',
                fontSize: 13
              }}
            >
              {metricsError}
            </div>
          ) : null}

          <div className="metric-grid">
            <MetricRing
              label="CPU"
              percent={clampPct(metricsData?.metrics?.cpu_usage)}
              value={`${clampPct(metricsData?.metrics?.cpu_usage).toFixed(1)}%`}
            />
            <MetricRing
              label="内存"
              percent={clampPct(metricsData?.metrics?.memory?.percent)}
              value={`${clampPct(metricsData?.metrics?.memory?.percent).toFixed(1)}%`}
            />
            <MetricRing
              label="磁盘 /"
              percent={clampPct(String(metricsData?.metrics?.disk?.percent || '').replace('%', ''))}
              value={`${clampPct(String(metricsData?.metrics?.disk?.percent || '').replace('%', '')).toFixed(0)}%`}
            />
          </div>

          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="card" style={{ padding: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 10 }}>详细信息</div>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, fontSize: 13 }}>
                <div style={{ color: 'var(--text-sub)' }}>Uptime</div>
                <div>{metricsData?.metrics?.uptime || '-'}</div>
                <div style={{ color: 'var(--text-sub)' }}>Load</div>
                <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>{metricsData?.metrics?.load || '-'}</div>
                <div style={{ color: 'var(--text-sub)' }}>内存</div>
                <div>
                  {Number.isFinite(Number(metricsData?.metrics?.memory?.used)) ? `${fmtBytes(Number(metricsData.metrics.memory.used) * 1024)} / ${fmtBytes(Number(metricsData.metrics.memory.total) * 1024)}` : '-'}
                </div>
                <div style={{ color: 'var(--text-sub)' }}>磁盘</div>
                <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                  {metricsData?.metrics?.disk?.used && metricsData?.metrics?.disk?.total
                    ? `${fmtDiskPart(metricsData.metrics.disk.used)} / ${fmtDiskPart(metricsData.metrics.disk.total)}`
                    : '-'}
                </div>
                <div style={{ color: 'var(--text-sub)' }}>网络</div>
                <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                  {metricsData?.metrics?.network ? `RX ${fmtBytes(metricsData.metrics.network.rx)} · TX ${fmtBytes(metricsData.metrics.network.tx)}` : '-'}
                </div>
              </div>
            </div>
          </div>
        </Drawer>
      ) : null}

      {deleteTarget ? (
        <Modal
          danger
          title={deleteTarget.type === 'server' ? '删除服务器' : '删除仓库'}
          onClose={() => (deleting ? null : setDeleteTarget(null))}
          footer={[
            <button key="c" className="btn btn-outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              取消
            </button>,
            <button key="ok" className="btn btn-danger" onClick={confirmDelete} disabled={deleting}>
              <Icon name={deleting ? 'spinner fa-spin' : 'trash'} /> {deleting ? '删除中...' : '确认删除'}
            </button>
          ]}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
            <div style={{ color: 'var(--text-sub)' }}>
              {deleteTarget.type === 'server'
                ? '该服务器可能被部署任务引用，删除后相关任务将无法正常工作。'
                : '该仓库可能被部署任务引用，删除后相关任务将无法触发部署。'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8 }}>
              <div style={{ color: 'var(--text-sub)' }}>名称</div>
              <div style={{ fontWeight: 600 }}>{deleteTarget.name}</div>
              <div style={{ color: 'var(--text-sub)' }}>ID</div>
              <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{deleteTarget.id}</div>
            </div>
            {deleteError ? (
              <div
                style={{
                  marginTop: 4,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(239,68,68,0.25)',
                  background: 'rgba(239,68,68,0.06)',
                  color: '#b91c1c',
                  fontSize: 13
                }}
              >
                {deleteError}
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {rbacCreateOpen ? (
        <Modal
          title="新增账号"
          onClose={() => (rbacSaving ? null : setRbacCreateOpen(false))}
          footer={[
            <button key="c" className="btn btn-outline" onClick={() => setRbacCreateOpen(false)} disabled={rbacSaving}>
              取消
            </button>,
            <button
              key="ok"
              className="btn btn-primary"
              onClick={async () => {
                setRbacSaving(true)
                try {
                  const res = await api.post('/api/admin/users', rbacCreateForm)
                  if (res?.ok) {
                    setRbacCreateOpen(false)
                    setRbacCreateForm({ username: '', password: '', display_name: '', is_active: true })
                    loadRbac()
                  }
                } finally {
                  setRbacSaving(false)
                }
              }}
              disabled={rbacSaving}
            >
              <Icon name={rbacSaving ? 'spinner fa-spin' : 'plus'} /> {rbacSaving ? '创建中...' : '创建'}
            </button>
          ]}
        >
          <div className="form-item">
            <label className="form-label">
              账号 <span className="req-star">*</span>
            </label>
            <input className="form-input" value={rbacCreateForm.username} onChange={(e) => setRbacCreateForm({ ...rbacCreateForm, username: e.target.value })} />
          </div>
          <div className="form-item">
            <label className="form-label">
              密码 <span className="req-star">*</span>
            </label>
            <input
              className="form-input"
              type="password"
              value={rbacCreateForm.password}
              onChange={(e) => setRbacCreateForm({ ...rbacCreateForm, password: e.target.value })}
            />
          </div>
          <div className="form-item">
            <label className="form-label">昵称</label>
            <input className="form-input" value={rbacCreateForm.display_name} onChange={(e) => setRbacCreateForm({ ...rbacCreateForm, display_name: e.target.value })} />
          </div>
          <div className="form-item" style={{ marginBottom: 0 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}>
              <input type="checkbox" checked={!!rbacCreateForm.is_active} onChange={(e) => setRbacCreateForm({ ...rbacCreateForm, is_active: e.target.checked })} />
              启用账号
            </label>
          </div>
        </Modal>
      ) : null}

      {rbacCreateRoleOpen ? (
        <Modal
          title="新增角色"
          onClose={() => (rbacSaving ? null : setRbacCreateRoleOpen(false))}
          footer={[
            <button key="c" className="btn btn-outline" onClick={() => setRbacCreateRoleOpen(false)} disabled={rbacSaving}>
              取消
            </button>,
            <button
              key="ok"
              className="btn btn-primary"
              onClick={async () => {
                setRbacSaving(true)
                try {
                  const res = await api.post('/api/admin/roles', rbacCreateRoleForm)
                  if (res?.ok) {
                    setRbacCreateRoleOpen(false)
                    setRbacCreateRoleForm({ name: '', code: '' })
                    loadRbac()
                  }
                } finally {
                  setRbacSaving(false)
                }
              }}
              disabled={rbacSaving}
            >
              <Icon name={rbacSaving ? 'spinner fa-spin' : 'plus'} /> {rbacSaving ? '创建中...' : '创建'}
            </button>
          ]}
        >
          <div className="form-item">
            <label className="form-label">
              角色名称 <span className="req-star">*</span>
            </label>
            <input className="form-input" value={rbacCreateRoleForm.name} onChange={(e) => setRbacCreateRoleForm({ ...rbacCreateRoleForm, name: e.target.value })} />
          </div>
          <div className="form-item" style={{ marginBottom: 0 }}>
            <label className="form-label">
              角色编码 <span className="req-star">*</span>
            </label>
            <input className="form-input" value={rbacCreateRoleForm.code} onChange={(e) => setRbacCreateRoleForm({ ...rbacCreateRoleForm, code: e.target.value })} placeholder="例如：admin / ops / viewer" />
          </div>
        </Modal>
      ) : null}

      {rbacRolesOpen ? (
        <Modal
          title={`分配角色 - ${rbacRolesOpen.username}`}
          onClose={() => (rbacSaving ? null : setRbacRolesOpen(null))}
          footer={[
            <button key="c" className="btn btn-outline" onClick={() => setRbacRolesOpen(null)} disabled={rbacSaving}>
              取消
            </button>,
            <button
              key="ok"
              className="btn btn-primary"
              onClick={async () => {
                setRbacSaving(true)
                try {
                  const res = await api.post(`/api/admin/users/${rbacRolesOpen.id}/roles`, { role_ids: rbacRolePick })
                  if (res?.ok) {
                    setRbacRolesOpen(null)
                    loadRbac()
                  }
                } finally {
                  setRbacSaving(false)
                }
              }}
              disabled={rbacSaving}
            >
              <Icon name={rbacSaving ? 'spinner fa-spin' : 'check'} /> {rbacSaving ? '保存中...' : '保存'}
            </button>
          ]}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(rbacRoles || []).map((r) => {
              const checked = rbacRolePick.includes(r.id)
              return (
                <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? Array.from(new Set([...rbacRolePick, r.id]))
                        : rbacRolePick.filter((x) => x !== r.id)
                      setRbacRolePick(next)
                    }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontWeight: 700 }}>{r.name}</div>
                    <div style={{ color: 'var(--text-sub)', fontSize: 12 }}>{r.code}</div>
                  </div>
                </label>
              )
            })}
          </div>
        </Modal>
      ) : null}

      {rbacPermsOpen ? (
        <Modal
          title={`配置权限 - ${rbacPermsOpen.name}`}
          onClose={() => (rbacSaving ? null : setRbacPermsOpen(null))}
          footer={[
            <button key="c" className="btn btn-outline" onClick={() => setRbacPermsOpen(null)} disabled={rbacSaving}>
              取消
            </button>,
            <button
              key="ok"
              className="btn btn-primary"
              onClick={async () => {
                setRbacSaving(true)
                try {
                  const res = await api.post(`/api/admin/roles/${rbacPermsOpen.id}/permissions`, { permission_ids: rbacPermPick })
                  if (res?.ok) {
                    setRbacPermsOpen(null)
                    loadRbac()
                  }
                } finally {
                  setRbacSaving(false)
                }
              }}
              disabled={rbacSaving}
            >
              <Icon name={rbacSaving ? 'spinner fa-spin' : 'check'} /> {rbacSaving ? '保存中...' : '保存'}
            </button>
          ]}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 420, overflow: 'auto', paddingRight: 4 }}>
            {(rbacPerms || []).map((p) => {
              const checked = rbacPermPick.includes(p.id)
              return (
                <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked ? Array.from(new Set([...rbacPermPick, p.id])) : rbacPermPick.filter((x) => x !== p.id)
                      setRbacPermPick(next)
                    }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                      <span className="badge badge-gray" style={{ fontFamily: 'inherit' }}>
                        {p.type}
                      </span>
                    </div>
                    <div style={{ color: 'var(--text-sub)', fontSize: 12, fontFamily: 'monospace' }}>{p.code}</div>
                  </div>
                </label>
              )
            })}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
