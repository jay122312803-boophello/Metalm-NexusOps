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
  const [openMenuId, setOpenMenuId] = useState(null)

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

  const envBadge = (serverName) => {
    const name = serverName || ''
    const low = name.toLowerCase()
    if (name.includes('生产') || low.includes('prod')) return <span className="badge badge-prod">PROD</span>
    if (name.includes('测试') || low.includes('test')) return <span className="badge badge-test">TEST</span>
    if (name.includes('开发') || low.includes('dev')) return <span className="badge badge-dev">DEV</span>
    return null
  }

  const handleCreate = async () => {
    if (!newTask.name || !newTask.server_id || !newTask.repo_id) return alert('请完善必填项')
    if (!newTask.input_dir || !newTask.dest_dir) return alert('请填写同步源目录与目标路径')
    await api.post('/api/deployments', newTask)
    setDrawerOpen(false)
    setNewTask({})
    load()
  }

  const handleDelete = async (id) => {
    if (!confirm('删除任务?')) return
    await api.del(`/api/deployments/${id}`)
    load()
  }

  return (
    <div>
      <div className="page-head">
        <h2 className="page-title">部署任务大盘</h2>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setDrawerOpen(true)}>
            <Icon name="plus" /> 创建新任务
          </button>
        </div>
      </div>

      <div className="deploy-grid">
        {tasks.map((t) => {
          const s = servers.find((x) => x.id === t.server_id) || {}
          const r = repos.find((x) => x.id === t.repo_id) || {}
          const last = lastByDeployment?.[t.id]
          return (
            <div key={t.id} className="card task-card" onClick={() => onNavigate('detail', t.id)}>
              <div className="task-header">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 600, fontSize: 16 }}>{t.name}</div>
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
                  {envBadge(s.name)}
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
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="status-dot online" /> 就绪
                </span>
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
          )
        })}
        {tasks.length === 0 ? (
          <div className="empty-state" style={{ gridColumn: '1/-1' }}>
            <div className="empty-icon">
              <Icon name="cubes" />
            </div>
            <div>暂无部署任务，请点击右上角创建</div>
          </div>
        ) : null}
      </div>

      {drawerOpen ? (
        <Drawer
          title="创建部署任务"
          onClose={() => setDrawerOpen(false)}
          footer={[
            <button key="c" className="btn btn-outline" onClick={() => setDrawerOpen(false)}>
              取消
            </button>,
            <button key="ok" className="btn btn-primary" onClick={handleCreate}>
              创建
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
                  {s.name}
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
                  {r.name}
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
