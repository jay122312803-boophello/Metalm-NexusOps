import { useEffect, useState } from 'react'
import Drawer from '../components/Drawer.jsx'
import Icon from '../components/Icon.jsx'
import Modal from '../components/Modal.jsx'
import { api } from '../services/api.js'

export default function Settings() {
  const [servers, setServers] = useState([])
  const [repos, setRepos] = useState([])
  const [drawerType, setDrawerType] = useState(null)
  const [activeTab, setActiveTab] = useState('servers')
  const [showTriggerToken, setShowTriggerToken] = useState(false)
  const [showPrivateToken, setShowPrivateToken] = useState(false)
  const [formServer, setFormServer] = useState({ ssh_user: 'metalm' })
  const [formRepo, setFormRepo] = useState({ branch: 'master' })
  const [editingId, setEditingId] = useState(null)
  const [repoAuth, setRepoAuth] = useState({ trigger: false, private: false })
  const [repoTokens, setRepoTokens] = useState({ trigger_token: '', private_token: '' })
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteError, setDeleteError] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const refresh = async () => {
    const sv = await api.get('/api/servers')
    const rp = await api.get('/api/repos')
    setServers(Array.isArray(sv) ? sv : [])
    setRepos(Array.isArray(rp) ? rp : [])
  }

  useEffect(() => {
    refresh()
  }, [])

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
    setFormServer({ ssh_user: 'metalm' })
    setFormRepo({ branch: 'master' })
    refresh()
  }

  const openCreate = (type) => {
    setEditingId(null)
    setShowTriggerToken(false)
    setShowPrivateToken(false)
    setRepoTokens({ trigger_token: '', private_token: '' })
    setRepoAuth({ trigger: false, private: false })
    setFormServer({ ssh_user: 'metalm' })
    setFormRepo({ branch: 'master' })
    setDrawerType(type)
  }

  const openEditServer = (s) => {
    setEditingId(s.id)
    setFormServer({ name: s.name, address: s.address, ssh_user: s.ssh_user || 'metalm', deploy_path: s.deploy_path, description: s.description || '' })
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

  return (
    <div>
      <div className="page-head">
        <div className="tabs">
          <button className={`tab ${activeTab === 'servers' ? 'active' : ''}`} onClick={() => setActiveTab('servers')}>
            服务器管理
          </button>
          <button className={`tab ${activeTab === 'repos' ? 'active' : ''}`} onClick={() => setActiveTab('repos')}>
            仓库配置
          </button>
        </div>
        <div className="page-actions">
          {activeTab === 'servers' ? (
            <button className="btn btn-primary" onClick={() => openCreate('server')}>
              <Icon name="plus" /> 接入新服务器
            </button>
          ) : (
            <button className="btn btn-outline" onClick={() => openCreate('repo')}>
              <Icon name="plus" /> 关联仓库
            </button>
          )}
        </div>
      </div>

      {activeTab === 'servers' ? (
        <div className="grid-servers">
          {servers.map((s) => (
            <div key={s.id} className="card server-card">
              <div className="server-status">
                <span className="status-dot online" />
              </div>
              <div className="server-icon">
                <Icon name="server" />
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{s.name}</div>
              <div style={{ color: 'var(--text-sub)', fontSize: 13 }}>{s.address}</div>
              <div style={{ color: 'var(--text-sub)', fontSize: 12, marginTop: 8, fontFamily: 'monospace' }}>{s.deploy_path}</div>
              <button
                className="btn btn-ghost btn-sm"
                style={{ position: 'absolute', bottom: 16, right: 52 }}
                onClick={() => openEditServer(s)}
                title="编辑"
              >
                <Icon name="pen-to-square" />
              </button>
              <button
                className="btn btn-ghost btn-sm"
                style={{ position: 'absolute', bottom: 16, right: 16, color: '#ef4444' }}
                onClick={() => openDelete('server', s)}
              >
                <Icon name="trash" />
              </button>
            </div>
          ))}
          {servers.length === 0 ? <div className="empty-state" style={{ gridColumn: '1/-1' }}>暂无服务器，请添加</div> : null}
        </div>
      ) : (
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
              {repos.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.name}</strong>
                  </td>
                  <td>
                    <span className="badge badge-blue">{r.branch}</span>
                  </td>
                  <td>
                    <span style={{ color: '#94a3b8', fontSize: 12 }}>{r.url}</span>
                  </td>
                  <td>
                    {r?.auth?.trigger || r?.auth?.private ? (
                      <span style={{ color: 'var(--success)' }} title="Token已配置">
                        <Icon name="shield-halved" /> 已绑定
                      </span>
                    ) : (
                      <span style={{ color: '#cbd5e1' }}>未配置</span>
                    )}
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={() => openEditRepo(r)} title="编辑">
                      <Icon name="pen-to-square" />
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => openDelete('repo', r)} title="删除">
                      <Icon name="trash" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
                <label className="form-label">服务器别名</label>
                <input
                  className="form-input"
                  placeholder="如: 生产环境-01"
                  value={formServer.name || ''}
                  onChange={(e) => setFormServer({ ...formServer, name: e.target.value })}
                />
              </div>
              <div className="form-item">
                <label className="form-label">IP 地址 / 域名</label>
                <div className="input-wrap">
                  <input
                    className="form-input"
                    placeholder="192.168.x.x"
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
                <label className="form-label">部署路径</label>
                <input
                  className="form-input"
                  placeholder="/home/metalm/deploy/NexusOps/"
                  value={formServer.deploy_path || ''}
                  onChange={(e) => setFormServer({ ...formServer, deploy_path: e.target.value })}
                />
              </div>
              <div className="form-item">
                <label className="form-label">SSH 用户 (SERVER_USER)</label>
                <input
                  className="form-input"
                  placeholder="如: metalm"
                  value={formServer.ssh_user || 'metalm'}
                  onChange={(e) => setFormServer({ ...formServer, ssh_user: e.target.value })}
                />
              </div>
            </>
          ) : (
            <>
              <div className="form-item">
                <label className="form-label">仓库名称</label>
                <input
                  className="form-input"
                  placeholder="如: Backend API"
                  value={formRepo.name || ''}
                  onChange={(e) => setFormRepo({ ...formRepo, name: e.target.value })}
                />
              </div>
              <div className="form-item">
                <label className="form-label">Git URL</label>
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
                <label className="form-label">分支</label>
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
                  <div className="input-toggle" onClick={() => setShowTriggerToken((v) => !v)} title={showTriggerToken ? '隐藏' : '显示'}>
                    <Icon name={showTriggerToken ? 'eye-slash' : 'eye'} />
                  </div>
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
                  <div className="input-toggle" onClick={() => setShowPrivateToken((v) => !v)} title={showPrivateToken ? '隐藏' : '显示'}>
                    <Icon name={showPrivateToken ? 'eye-slash' : 'eye'} />
                  </div>
                </div>
              </div>
            </>
          )}
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
    </div>
  )
}
