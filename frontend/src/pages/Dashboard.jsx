import { useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import Drawer from '../components/Drawer.jsx'
import Modal from '../components/Modal.jsx'
import Select from '../components/Select.jsx'
import Tooltip from '../components/Tooltip.jsx'
import Can from '../components/Can.jsx'
import { api } from '../services/api.js'
import { toast } from '../services/toast.js'

const monitorStorageKey = 'nexusops_monitor_summary_v1'

export default function Dashboard({ onNavigate }) {
  const [tasks, setTasks] = useState([])
  const [servers, setServers] = useState([])
  const [repos, setRepos] = useState([])
  const [lastByDeployment, setLastByDeployment] = useState({})
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [newTask, setNewTask] = useState({})
  const [editingTaskId, setEditingTaskId] = useState(null)
  const [openMenuId, setOpenMenuId] = useState(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [scriptHelpOpen, setScriptHelpOpen] = useState(false)
  const [monitoringById, setMonitoringById] = useState({})
  const [monitorSummaryById, setMonitorSummaryById] = useState(() => {
    try {
      const raw = localStorage.getItem(monitorStorageKey)
      if (!raw) return {}
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (_) {
      return {}
    }
  })
  const monitorIntervalsRef = useRef({})
  const monitorTimeoutsRef = useRef({})

  const normPosix = (p) => {
    const s = String(p || '').trim().replace(/\\/g, '/')
    if (!s) return ''
    const abs = s.startsWith('/')
    const parts = s.split('/').filter((x) => x && x !== '.')
    const stack = []
    for (const part of parts) {
      if (part === '..') {
        if (stack.length) stack.pop()
        else return ''
      } else {
        stack.push(part)
      }
    }
    return (abs ? '/' : '') + stack.join('/')
  }

  const validateDestDir = (destDir, deployPath) => {
    const baseRaw = String(deployPath || '').trim()
    if (!baseRaw) return { ok: false, message: '该服务器未配置部署路径，请先在系统设置-服务器管理中设置。' }
    const base = normPosix(baseRaw)
    if (!base || !base.startsWith('/')) return { ok: false, message: '服务器部署路径必须为绝对路径（以 / 开头）。' }

    const raw = String(destDir || '').trim()
    if (!raw) return { ok: false, message: `服务器目标路径不能为空，且必须位于：${base} 下。` }
    const cand = normPosix(raw)
    if (!cand || !cand.startsWith('/')) return { ok: false, message: '服务器目标路径必须为绝对路径（以 / 开头）。' }

    const prefix = base.endsWith('/') ? base : `${base}/`
    if (cand === base || cand.startsWith(prefix)) return { ok: true, base, cand }
    return { ok: false, message: `服务器目标路径必须位于服务器部署路径下：${base}` }
  }

  const load = async () => {
    const ts = await api.get('/api/deployments')
    const sv = await api.get('/api/servers')
    const rp = await api.get('/api/repos')
    const h = await api.get('/api/history')
    setTasks(Array.isArray(ts) ? ts : [])
    setServers(Array.isArray(sv) ? sv : [])
    setRepos(Array.isArray(rp) ? rp : [])

    const items = Array.isArray(h?.history) ? h.history : []
    const next = {}
    for (const item of items) {
      const depId = item?.deployment_id
      const createdAt = item?.created_at
      if (!depId || !createdAt) continue
      const prev = next[depId]
      if (!prev || String(createdAt) > String(prev.created_at)) {
        next[depId] = { created_at: createdAt, status: item?.status || 'unknown', pipeline_id: item?.pipeline_id }
      }
    }
    setLastByDeployment(next)
  }

  const stopMonitor = (id) => {
    const t = monitorIntervalsRef.current[id]
    if (t) clearInterval(t)
    delete monitorIntervalsRef.current[id]
    const k = monitorTimeoutsRef.current[id]
    if (k) clearTimeout(k)
    delete monitorTimeoutsRef.current[id]
    setMonitoringById((p) => {
      const n = { ...p }
      delete n[id]
      return n
    })
  }

  const startMonitor = async (id) => {
    stopMonitor(id)
    setMonitoringById((p) => ({ ...p, [id]: true }))

    const fetchOnce = async () => {
      try {
        const res = await api.get(`/api/deployments/${id}/monitor`)
        if (res?.ok) {
          const groups = Array.isArray(res.groups) ? res.groups : []
          const containers = groups.flatMap((g) => (Array.isArray(g?.containers) ? g.containers : []))
          const total = containers.length
          const running = containers.filter((c) => String(c?.State || '').toLowerCase() === 'running').length
          setMonitorSummaryById((p) => ({ ...p, [id]: { total, running, failed: Math.max(0, total - running), ts: Date.now() } }))
        } else {
          const d = res?.detail
          toast.error(typeof d === 'string' ? d : '监控失败')
          stopMonitor(id)
        }
      } catch (_) {
        toast.error('监控失败')
        stopMonitor(id)
      }
    }

    await fetchOnce()
    monitorIntervalsRef.current[id] = setInterval(fetchOnce, 12000)
    monitorTimeoutsRef.current[id] = setTimeout(() => {
      stopMonitor(id)
      toast.success('为节省资源，已自动暂停监控')
    }, 5 * 60 * 1000)
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 9000)
    return () => {
      clearInterval(t)
      for (const id of Object.keys(monitorIntervalsRef.current)) stopMonitor(id)
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(monitorStorageKey, JSON.stringify(monitorSummaryById || {}))
    } catch (_) {}
  }, [monitorSummaryById])

  useEffect(() => {
    const onDoc = () => setOpenMenuId(null)
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [])

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

  const statusDotClass = (status) => {
    const s = String(status || '').toLowerCase()
    if (s === 'running' || s === 'pending') return 'busy'
    if (s === 'success') return 'online'
    if (s === 'failed') return 'offline'
    if (s === 'canceled') return 'canceled'
    return 'idle'
  }

  const statusLabel = (status) => {
    const s = String(status || '').toLowerCase()
    if (s === 'running') return '运行中'
    if (s === 'pending') return '排队中'
    if (s === 'success') return '就绪'
    if (s === 'failed') return '失败'
    if (s === 'canceled') return '已取消'
    return '就绪'
  }

  const handleCreate = async () => {
    const selectedServer = servers.find((s) => s.id === newTask.server_id) || null
    const destCheck = validateDestDir(newTask.dest_dir, selectedServer?.deploy_path || '')
    if (!newTask.name || !newTask.server_id || !newTask.repo_id) {
      toast.error('请完善必填项')
      return
    }
    if (!newTask.input_dir) {
      toast.error('请填写同步源目录')
      return
    }
    if (!destCheck.ok) {
      toast.error(destCheck.message || '服务器目标路径不合法')
      return
    }
    const res = editingTaskId ? await api.put(`/api/deployments/${editingTaskId}`, newTask) : await api.post('/api/deployments', newTask)
    if (!(res?.ok || res?.id)) {
      const d = res?.detail
      toast.error(typeof d === 'string' ? d : '保存失败')
      return
    }
    setDrawerOpen(false)
    setNewTask({})
    setEditingTaskId(null)
    load()
  }

  const openCreate = () => {
    setEditingTaskId(null)
    setNewTask({})
    setDrawerOpen(true)
  }

  const openEdit = (t) => {
    setEditingTaskId(t.id)
    setNewTask({
      name: t.name,
      server_id: t.server_id,
      repo_id: t.repo_id,
      input_dir: t.input_dir || './',
      dest_dir: t.dest_dir || '',
      deploy_script: t.deploy_script || ''
    })
    setDrawerOpen(true)
  }

  const handleDelete = async (id) => {
    if (!confirm('删除任务?')) return
    await api.del(`/api/deployments/${id}`)
    load()
  }

  const filteredTasks = tasks.filter((t) => {
    const q = (query || '').trim().toLowerCase()
    const last = lastByDeployment?.[t.id]
    const st = String(last?.status || 'unknown').toLowerCase()
    if (statusFilter !== 'all' && st !== statusFilter) return false
    if (!q) return true
    const s = servers.find((x) => x.id === t.server_id) || {}
    const r = repos.find((x) => x.id === t.repo_id) || {}
    return (
      String(t?.name || '').toLowerCase().includes(q) ||
      String(s?.name || '').toLowerCase().includes(q) ||
      String(s?.address || '').toLowerCase().includes(q) ||
      String(r?.name || '').toLowerCase().includes(q) ||
      String(r?.branch || '').toLowerCase().includes(q)
    )
  })

  const pageSize = 8
  const total = filteredTasks.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  useEffect(() => {
    setPage(1)
  }, [query, statusFilter, tasks.length])
  const safePage = Math.min(totalPages, Math.max(1, page))
  const pagedTasks = filteredTasks.slice((safePage - 1) * pageSize, safePage * pageSize)

  return (
    <div className="panel-canvas">
      <div className="panel-frame">
        <div className="action-bar" style={{ margin: 0 }}>
          <div className="action-left">
            <div className="search-box">
              <Icon name="magnifying-glass" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索任务 / 目标主机 / 仓库 / 分支" />
            </div>
            <Select
              className="action-select"
              value={statusFilter}
              onChange={(v) => setStatusFilter(v)}
              options={[
                { value: 'all', label: '全部状态' },
                { value: 'success', label: '就绪' },
                { value: 'failed', label: '失败' },
                { value: 'running', label: '运行中' },
                { value: 'pending', label: '排队中' },
                { value: 'canceled', label: '已取消' }
              ]}
            />
          </div>
          <div>
            <Can perm="deploy:manage">
              <button className="btn btn-primary" onClick={openCreate}>
                <Icon name="plus" /> 创建新实例
              </button>
            </Can>
          </div>
        </div>

        <div className="panel-body">
          <div className="deploy-grid">
            {pagedTasks.map((t) => {
          const s = servers.find((x) => x.id === t.server_id) || {}
          const r = repos.find((x) => x.id === t.repo_id) || {}
          const last = lastByDeployment?.[t.id]
          return (
            <div key={t.id} className="card task-card" onClick={() => onNavigate('detail', t.id)}>
              <div className="task-header">
                <Tooltip content={statusLabel(last?.status)}>
                  <span className={`task-dot ${statusDotClass(last?.status)}`} />
                </Tooltip>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>{t.name}</div>
                  </div>
                  <div className="task-actions">
                    <Tooltip content="更多操作">
                      <div
                        className="icon-btn"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          setOpenMenuId(openMenuId === t.id ? null : t.id)
                        }}
                      >
                        <Icon name="ellipsis" />
                      </div>
                    </Tooltip>
                    {openMenuId === t.id ? (
                      <div className="menu-pop" onClick={(ev) => ev.stopPropagation()}>
                        <Can perm="deploy:manage">
                          <button
                            className="menu-item-btn"
                            onClick={(ev) => {
                              ev.stopPropagation()
                              setOpenMenuId(null)
                              openEdit(t)
                            }}
                          >
                            实例配置 <Icon name="gear" />
                          </button>
                        </Can>
                        <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />
                        <Can perm="deploy:manage">
                          <button
                            className="menu-item-btn menu-item-danger"
                            onClick={async (ev) => {
                              ev.stopPropagation()
                              setOpenMenuId(null)
                              await handleDelete(t.id)
                            }}
                          >
                            删除实例 <Icon name="trash" />
                          </button>
                        </Can>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="task-body">
                <div className="info-row">
                  <Icon name="server" />
                  <span className="info-key">目标</span>
                  <span className="info-value">{s.name || 'Unknown'}</span>
                  {envBadge(s.environment, s.name)}
                </div>
                <div className="info-row">
                  <Icon name="code-branch" />
                  <span className="info-key">来源</span>
                  <span className="info-value">{r.name || 'Unknown'}</span>
                  <span className="badge badge-gray">{r.branch || 'master'}</span>
                </div>
                <div className="info-row">
                  <Icon name="clock" />
                  <span className="info-key">上次部署</span>
                  {last?.created_at ? (
                    <>
                      <span className="info-time">{new Date(last.created_at).toLocaleString()}</span>
                      {last?.status ? (
                        <Tooltip content={last.pipeline_id ? `Pipeline #${last.pipeline_id}` : ''}>
                          <span
                            className="badge badge-gray"
                            style={{
                              background:
                                last.status === 'success'
                                  ? 'rgba(16,185,129,0.12)'
                                  : last.status === 'failed'
                                    ? 'rgba(239,68,68,0.12)'
                                    : last.status === 'canceled'
                                      ? 'rgba(245,158,11,0.12)'
                                      : 'rgba(59,130,246,0.12)',
                              color:
                                last.status === 'success'
                                  ? 'var(--success)'
                                  : last.status === 'failed'
                                    ? 'var(--danger)'
                                    : last.status === 'canceled'
                                      ? 'var(--warning)'
                                      : 'var(--info)',
                              fontFamily: 'inherit'
                            }}
                          >
                            {String(last.status).toUpperCase()}
                          </span>
                        </Tooltip>
                      ) : null}
                    </>
                  ) : (
                    <span className="info-empty">暂无数据</span>
                  )}
                </div>
                <div className="info-row info-row-split">
                  <div className="info-left info-left-tight">
                    <Icon name="tower-broadcast" />
                    <span className="info-key">容器状态</span>
                    {!last?.created_at ? (
                      <span className="info-empty">请先完成首次部署</span>
                    ) : monitorSummaryById[t.id] ? (
                      <>
                        <span
                          className="badge badge-gray"
                          style={{ background: 'rgba(16,185,129,0.12)', color: 'var(--success)', fontFamily: 'inherit' }}
                        >
                          正常 {monitorSummaryById[t.id].running}
                        </span>
                        <span
                          className="badge badge-gray"
                          style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--danger)', fontFamily: 'inherit' }}
                        >
                          异常 {monitorSummaryById[t.id].failed}
                        </span>
                        {monitorSummaryById[t.id].ts ? (
                          <Tooltip content={new Date(monitorSummaryById[t.id].ts).toLocaleString()}>
                            <span className="info-hint">{new Date(monitorSummaryById[t.id].ts).toLocaleTimeString()}</span>
                          </Tooltip>
                        ) : null}
                      </>
                    ) : (
                      <span className="info-empty">尚未查询</span>
                    )}
                  </div>
                  <div className="info-right">
                    <Tooltip content={!last?.created_at ? '请先完成首次部署' : monitoringById[t.id] ? '暂停监控' : '开始监控'}>
                      <button
                        className="icon-btn"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          if (!last?.created_at) return
                          if (monitoringById[t.id]) stopMonitor(t.id)
                          else startMonitor(t.id)
                        }}
                        disabled={!last?.created_at}
                      >
                        <Icon name={monitoringById[t.id] ? 'circle-pause' : 'circle-play'} />
                      </button>
                    </Tooltip>
                  </div>
                </div>
              </div>

              <div className="task-footer">
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`status-dot ${statusDotClass(last?.status)}`} />
                  <span>{statusLabel(last?.status)}</span>
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={(ev) => {
                      ev.stopPropagation()
                      openEdit(t)
                    }}
                  >
                    <Icon name="gear" /> 实例配置
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={(ev) => {
                      ev.stopPropagation()
                      onNavigate('detail', t.id)
                    }}
                  >
                    <Icon name="rocket" /> 进入控制台
                  </button>
                </div>
              </div>
            </div>
          )
            })}
            {pagedTasks.length === 0 ? (
              <div className="empty-state" style={{ gridColumn: '1/-1' }}>
                <div className="empty-icon">
                  <Icon name="cubes" />
                </div>
                <div>{query || statusFilter !== 'all' ? '暂无匹配实例' : '暂无部署实例，请点击右上角创建'}</div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="panel-pager">
          <div className="panel-pager-left">
            共 {total} 条
          </div>
          <div className="panel-pager-right">
            <button className="btn btn-ghost btn-sm" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <Icon name="chevron-left" />
            </button>
            <span className="panel-page-num">
              {safePage} / {totalPages}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <Icon name="chevron-right" />
            </button>
          </div>
        </div>
      </div>

      {drawerOpen ? (
        <Drawer
          title={editingTaskId ? '实例配置' : '创建部署实例'}
          onClose={() => { setDrawerOpen(false); setEditingTaskId(null) }}
          footer={[
            <button key="c" className="btn btn-outline" onClick={() => { setDrawerOpen(false); setEditingTaskId(null) }}>
              取消
            </button>,
            <button key="ok" className="btn btn-primary" onClick={handleCreate}>
              {editingTaskId ? '保存' : '创建'}
            </button>
          ]}
        >
          <div className="form-item">
            <label className="form-label">
              实例名称 <span className="req-star">*</span>
            </label>
            <input
              className="form-input"
              placeholder="Nexus 智能体部署"
              value={newTask.name || ''}
              onChange={(e) => setNewTask({ ...newTask, name: e.target.value })}
            />
          </div>
          <div className="form-item">
            <label className="form-label">
              选择目标服务器 <span className="req-star">*</span>
            </label>
            <Select
              className="form-input"
              value={newTask.server_id || ''}
              placeholder="请选择..."
              onChange={(v) => setNewTask({ ...newTask, server_id: v })}
              options={[
                { value: '', label: '请选择...' },
                ...servers.map((s) => ({ value: s.id, label: `${s.name} (${s.address})` }))
              ]}
              popWidth={360}
            />
          </div>
          <div className="form-item">
            <label className="form-label">
              选择来源仓库 <span className="req-star">*</span>
            </label>
            <Select
              className="form-input"
              value={newTask.repo_id || ''}
              placeholder="请选择..."
              onChange={(v) => setNewTask({ ...newTask, repo_id: v })}
              options={[
                { value: '', label: '请选择...' },
                ...repos.map((r) => ({ value: r.id, label: `${r.name} [${r.branch || 'master'}]` }))
              ]}
              popWidth={360}
            />
          </div>

          <div className="form-item">
            <label className="form-label">
              同步源目录 <span className="req-star">*</span>
            </label>
            <input
              className="form-input"
              placeholder="./develop/backend_frontend/"
              value={newTask.input_dir || ''}
              onChange={(e) => setNewTask({ ...newTask, input_dir: e.target.value })}
            />
          </div>
          <div className="form-item">
            <label className="form-label">
              服务器目标路径 <span className="req-star">*</span>
            </label>
            <input
              className="form-input"
              placeholder="/home/metalm/deploy/App_A/"
              value={newTask.dest_dir || ''}
              onChange={(e) => setNewTask({ ...newTask, dest_dir: e.target.value })}
            />
            {newTask.server_id ? (
              (() => {
                const selectedServer = servers.find((s) => s.id === newTask.server_id) || null
                const check = validateDestDir(newTask.dest_dir, selectedServer?.deploy_path || '')
                if (check.ok) {
                  return (
                    <div style={{ marginTop: 8, color: 'var(--text-sub)', fontSize: 12 }}>
                      需位于服务器部署路径下：<span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>{check.base}</span>
                    </div>
                  )
                }
                return (
                  <div
                    style={{
                      marginTop: 10,
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(239,68,68,0.22)',
                      background: 'rgba(239,68,68,0.06)',
                      color: '#991b1b',
                      fontSize: 12,
                      lineHeight: 1.5
                    }}
                  >
                    {check.message}
                  </div>
                )
              })()
            ) : (
              <div style={{ marginTop: 8, color: 'var(--text-sub)', fontSize: 12 }}>先选择目标服务器以获取可用路径范围</div>
            )}
          </div>
          <div className="form-item">
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              自定义执行脚本
              <Tooltip content="部署时在目标服务器执行，用于启动/重启服务">
                <button type="button" className="icon-btn" onClick={() => setScriptHelpOpen(true)}>
                  <Icon name="circle-question" />
                </button>
              </Tooltip>
            </label>
            <textarea
              className="form-input"
              style={{ minHeight: 140, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
              placeholder={'chmod +x down.sh up.sh\nsh down.sh\ndocker-compose up -d'}
              value={newTask.deploy_script || ''}
              onChange={(e) => setNewTask({ ...newTask, deploy_script: e.target.value })}
            />
          </div>
        </Drawer>
      ) : null}

      {scriptHelpOpen ? (
        <Modal
          title="自定义执行脚本"
          onClose={() => setScriptHelpOpen(false)}
          footer={[
            <button key="c" className="btn btn-outline" onClick={() => setScriptHelpOpen(false)}>
              关闭
            </button>
          ]}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
            <div style={{ color: 'var(--text-sub)' }}>
              触发部署后，该脚本会在目标服务器执行（工作目录为服务器目标路径），用于启动/重启服务等部署收尾动作。
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ color: 'var(--text-sub)' }}>注意事项</div>
              <div style={{ color: 'var(--text-main)', fontSize: 13, lineHeight: 1.7 }}>
                <div>1. 脚本里引用的文件需存在于“同步源目录”中，部署时会被同步到目标路径。</div>
                <div>2. 远端会先同步代码，再挂载配置文件，然后执行此脚本。</div>
                <div>3. 推荐使用相对路径：如 ./down.sh、./up.sh、docker-compose.yml。</div>
              </div>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
