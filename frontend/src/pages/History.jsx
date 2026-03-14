import { useEffect, useState } from 'react'
import Drawer from '../components/Drawer.jsx'
import Icon from '../components/Icon.jsx'
import Modal from '../components/Modal.jsx'
import { api } from '../services/api.js'

export default function History({ onNavigate }) {
  const [history, setHistory] = useState([])
  const [servers, setServers] = useState([])
  const [statusOptions, setStatusOptions] = useState(['pending', 'running', 'success', 'failed', 'canceled'])
  const [selectedServerId, setSelectedServerId] = useState('all')
  const [selectedStatus, setSelectedStatus] = useState('all')
  const [varsView, setVarsView] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  useEffect(() => {
    const loadHistory = async () => {
      const qs = new URLSearchParams()
      if (selectedServerId && selectedServerId !== 'all') qs.set('server_id', selectedServerId)
      if (selectedStatus && selectedStatus !== 'all') qs.set('status', selectedStatus)
      const url = qs.toString() ? `/api/history?${qs.toString()}` : '/api/history'
      const h = await api.get(url)
      setHistory(Array.isArray(h?.history) ? h.history : [])
      const sv = Array.isArray(h?.filters?.servers) ? h.filters.servers : null
      if (sv) setServers(sv)
      const st = Array.isArray(h?.filters?.statuses) ? h.filters.statuses : null
      if (st && st.length) setStatusOptions(st)
    }
    loadHistory()
    const t = setInterval(loadHistory, 8000)
    return () => clearInterval(t)
  }, [selectedServerId, selectedStatus])

  const getStatusIcon = (status) => {
    if (status === 'success') return <Icon name="circle-check" style={{ color: 'var(--success)', fontSize: 20 }} />
    if (status === 'failed') return <Icon name="circle-xmark" style={{ color: 'var(--danger)', fontSize: 20 }} />
    if (status === 'canceled') return <Icon name="ban" style={{ color: 'var(--warning)', fontSize: 20 }} />
    if (status === 'running' || status === 'pending')
      return <Icon name="spinner fa-spin" style={{ color: 'var(--info)', fontSize: 20 }} />
    return <Icon name="circle-question" style={{ color: '#cbd5e1', fontSize: 20 }} />
  }

  const statusLabel = (s) => {
    const v = String(s || '').toLowerCase()
    if (v === 'success') return '成功'
    if (v === 'failed') return '失败'
    if (v === 'running') return '运行中'
    if (v === 'pending') return '排队中'
    if (v === 'canceled') return '已取消'
    return v || '未知'
  }

  return (
    <div>
      <div className="page-head">
        <div className="page-head-left">
          <div className="page-title-row">
            <Icon name="clock-rotate-left" style={{ color: 'var(--text-sub)' }} />
            <h2 className="page-title">审计日志</h2>
          </div>
        </div>
        <div className="page-actions">
          <select
            className="form-input"
            style={{ width: 180 }}
            value={selectedServerId}
            onChange={(e) => setSelectedServerId(e.target.value)}
          >
            <option value="all">全部服务器</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            className="form-input"
            style={{ width: 180 }}
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
          >
            <option value="all">全部状态</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card">
        <table className="repo-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ width: 60 }}>状态</th>
              <th style={{ width: 320 }}>任务说明</th>
              <th style={{ width: 220 }}>CI 信息</th>
              <th>变量参数</th>
              <th style={{ width: 190 }}>触发时间</th>
              <th style={{ width: 170 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => {
              const sName = h.server_snapshot?.name || 'Unknown Server'
              const rName = h.repo_snapshot?.name || 'Unknown Repo'
              const pipelineText = h.pipeline_id ? `Pipeline #${h.pipeline_id}` : '手动触发'
              const varKeys = Object.keys(h.variables || {})
              const hintVars = []
              const pick = (k) => {
                if (h.variables && h.variables[k]) hintVars.push([k, String(h.variables[k])])
              }
              pick('SERVER_HOST')
              pick('DEST_DIR')
              return (
                <tr
                  key={h.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => (onNavigate ? onNavigate('detail', h.deployment_id, { historyId: h.id }) : null)}
                >
                  <td>{getStatusIcon(h.status)}</td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{`Deploy ${rName}`}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>{`To: ${sName}`}</div>
                  </td>
                  <td>
                    <div>{pipelineText}</div>
                    {h.web_url ? (
                      <a href={h.web_url} target="_blank" style={{ fontSize: 12, color: 'var(--info)' }}>
                        View in GitLab
                      </a>
                    ) : null}
                  </td>
                  <td>
                    {!h.variables ? (
                      '-'
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <span
                          className="vars-pill"
                          title="点击查看详情"
                          onClick={(ev) => {
                            ev.stopPropagation()
                            setVarsView({
                              title: `${pipelineText} 变量参数`,
                              text: JSON.stringify(h.variables, null, 2)
                            })
                          }}
                        >
                          <Icon name="code" style={{ fontSize: 12 }} />
                          {`${varKeys.length} 个变量`}
                        </span>
                        {hintVars.length ? (
                          <div style={{ fontSize: 12, color: 'var(--text-sub)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                            {hintVars.map(([k, v]) => (
                              <span key={k} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                                {k}={v}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </td>
                  <td>{new Date(h.created_at).toLocaleString()}</td>
                  <td>
                    <div className="history-actions">
                      <button
                        className="btn btn-primary btn-action"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          onNavigate ? onNavigate('detail', h.deployment_id, { historyId: h.id }) : null
                        }}
                      >
                        <Icon name="circle-info" /> 查看详情
                      </button>
                      <button
                        className="btn btn-primary btn-action"
                        onClick={async (ev) => {
                          ev.stopPropagation()
                          if (!confirm('重新触发该任务部署？')) return
                          const res = await api.post(`/api/deployments/${h.deployment_id}/trigger`, {})
                          if (res?.ok && res?.history_id) {
                            onNavigate ? onNavigate('detail', h.deployment_id, { historyId: res.history_id }) : null
                          } else {
                            alert('触发失败')
                          }
                        }}
                      >
                        <Icon name="rocket" /> 重新部署
                      </button>
                      <button
                        className="btn btn-danger btn-action"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          setDeleteError(null)
                          setDeleteTarget({ id: h.id, deployment_id: h.deployment_id, status: h.status, created_at: h.created_at })
                        }}
                      >
                        <Icon name="trash" /> 删除
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {varsView ? (
        <Drawer
          title={varsView.title}
          onClose={() => setVarsView(null)}
          footer={[
            <button key="c" className="btn btn-outline" onClick={() => setVarsView(null)}>
              关闭
            </button>
          ]}
        >
          <pre className="code-pre">{varsView.text}</pre>
        </Drawer>
      ) : null}

      {deleteTarget ? (
        <Modal
          danger
          title="删除审计日志"
          onClose={() => (deleting ? null : setDeleteTarget(null))}
          footer={[
            <button key="c" className="btn btn-outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              取消
            </button>,
            <button
              key="ok"
              className="btn btn-danger"
              disabled={deleting}
              onClick={async () => {
                setDeleting(true)
                setDeleteError(null)
                try {
                  const res = await api.del(`/api/history/${deleteTarget.id}`)
                  if (res?.ok) {
                    setDeleteTarget(null)
                    const qs = new URLSearchParams()
                    if (selectedServerId && selectedServerId !== 'all') qs.set('server_id', selectedServerId)
                    if (selectedStatus && selectedStatus !== 'all') qs.set('status', selectedStatus)
                    const url = qs.toString() ? `/api/history?${qs.toString()}` : '/api/history'
                    const h = await api.get(url)
                    setHistory(Array.isArray(h?.history) ? h.history : [])
                  } else {
                    const d = res?.detail
                    setDeleteError(typeof d === 'string' ? d : d ? JSON.stringify(d) : '删除失败')
                  }
                } finally {
                  setDeleting(false)
                }
              }}
            >
              <Icon name={deleting ? 'spinner fa-spin' : 'trash'} /> {deleting ? '删除中...' : '确认删除'}
            </button>
          ]}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
            <div style={{ color: 'var(--text-sub)' }}>删除后该条记录及其快照会被移除，无法恢复。</div>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8 }}>
              <div style={{ color: 'var(--text-sub)' }}>History ID</div>
              <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{deleteTarget.id}</div>
              <div style={{ color: 'var(--text-sub)' }}>任务</div>
              <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{deleteTarget.deployment_id}</div>
              <div style={{ color: 'var(--text-sub)' }}>状态</div>
              <div>{String(deleteTarget.status || 'unknown')}</div>
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
