import { useEffect, useState } from 'react'
import Icon from '../components/Icon.jsx'
import Drawer from '../components/Drawer.jsx'
import { api } from '../services/api.js'

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

  useEffect(() => {
    load()
  }, [])

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
    if (!newTask.name || !newTask.server_id || !newTask.repo_id) return alert('请完善必填项')
    if (!newTask.input_dir || !newTask.dest_dir) return alert('请填写同步源目录与目标路径')
    if (editingTaskId) await api.put(`/api/deployments/${editingTaskId}`, newTask)
    else await api.post('/api/deployments', newTask)
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

  const pageSize = 12
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
            <select className="action-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">全部状态</option>
              <option value="success">就绪</option>
              <option value="failed">失败</option>
              <option value="running">运行中</option>
              <option value="pending">排队中</option>
              <option value="canceled">已取消</option>
            </select>
          </div>
          <div>
            <button className="btn btn-primary" onClick={openCreate}>
              <Icon name="plus" /> 创建新任务
            </button>
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
                <span className={`task-dot ${statusDotClass(last?.status)}`} title={statusLabel(last?.status)} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>{t.name}</div>
                    <span style={{ color: 'var(--text-sub)', fontSize: 12, fontFamily: 'monospace' }}>{String(t.id || '').slice(0, 6)}</span>
                  </div>
                  <div className="task-actions">
                    <div
                      className="icon-btn"
                      title="更多操作"
                      onClick={(ev) => {
                        ev.stopPropagation()
                        setOpenMenuId(openMenuId === t.id ? null : t.id)
                      }}
                    >
                      <Icon name="ellipsis" />
                    </div>
                    {openMenuId === t.id ? (
                      <div className="menu-pop" onClick={(ev) => ev.stopPropagation()}>
                        <button
                          className="menu-item-btn"
                          onClick={(ev) => {
                            ev.stopPropagation()
                            setOpenMenuId(null)
                            openEdit(t)
                          }}
                        >
                          任务配置 <Icon name="gear" />
                        </button>
                        <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />
                        <button
                          className="menu-item-btn menu-item-danger"
                          onClick={async (ev) => {
                            ev.stopPropagation()
                            setOpenMenuId(null)
                            await handleDelete(t.id)
                          }}
                        >
                          删除任务 <Icon name="trash" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="task-body">
                <div className="info-row">
                  <Icon name="server" />
                  <span>目标: </span>
                  <span className="info-val">{s.name || 'Unknown'}</span>
                  {envBadge(s.environment, s.name)}
                </div>
                <div className="info-row">
                  <Icon name="code-branch" />
                  <span>来源: </span>
                  <span className="info-val">{r.name || 'Unknown'}</span>
                  <span className="badge badge-gray">{r.branch || 'master'}</span>
                </div>
                <div className="info-row" style={{ marginTop: 16 }}>
                  <Icon name="clock" />
                  上次部署:{' '}
                  {last?.created_at ? (
                    <>
                      <span className="info-val">{new Date(last.created_at).toLocaleString()}</span>
                      {last?.status ? (
                        <span
                          className="badge badge-gray"
                          style={{
                            marginLeft: 8,
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
                          title={last.pipeline_id ? `Pipeline #${last.pipeline_id}` : undefined}
                        >
                          {String(last.status).toUpperCase()}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span>暂无数据</span>
                  )}
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
                    <Icon name="gear" /> 任务配置
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
                <div>{query || statusFilter !== 'all' ? '暂无匹配任务' : '暂无部署任务，请点击右上角创建'}</div>
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
          title={editingTaskId ? '任务配置' : '创建部署任务'}
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
            <label className="form-label">任务名称</label>
            <input
              className="form-input"
              placeholder="Nexus 智能体部署"
              value={newTask.name || ''}
              onChange={(e) => setNewTask({ ...newTask, name: e.target.value })}
            />
          </div>
          <div className="form-item">
            <label className="form-label">选择目标服务器</label>
            <select
              className="form-input"
              value={newTask.server_id || ''}
              onChange={(e) => setNewTask({ ...newTask, server_id: e.target.value })}
            >
              <option value="">请选择...</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {`${s.name} (${s.address})`}
                </option>
              ))}
            </select>
          </div>
          <div className="form-item">
            <label className="form-label">选择来源仓库</label>
            <select
              className="form-input"
              value={newTask.repo_id || ''}
              onChange={(e) => setNewTask({ ...newTask, repo_id: e.target.value })}
            >
              <option value="">请选择...</option>
              {repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {`${r.name} [${r.branch || 'master'}]`}
                </option>
              ))}
            </select>
          </div>

          <div className="form-item">
            <label className="form-label">同步源目录</label>
            <input
              className="form-input"
              placeholder="./develop/backend_frontend/"
              value={newTask.input_dir || ''}
              onChange={(e) => setNewTask({ ...newTask, input_dir: e.target.value })}
            />
          </div>
          <div className="form-item">
            <label className="form-label">服务器目标路径</label>
            <input
              className="form-input"
              placeholder="/home/metalm/deploy/App_A/"
              value={newTask.dest_dir || ''}
              onChange={(e) => setNewTask({ ...newTask, dest_dir: e.target.value })}
            />
          </div>
          <div className="form-item">
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              自定义执行脚本
              <span title="此脚本将在目标服务器拉取代码及配置后执行" style={{ color: 'var(--text-sub)' }}>
                <Icon name="circle-question" />
              </span>
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
    </div>
  )
}
