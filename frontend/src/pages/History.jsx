import { useEffect, useState } from 'react'
import Drawer from '../components/Drawer.jsx'
import Icon from '../components/Icon.jsx'
import Modal from '../components/Modal.jsx'
import Select from '../components/Select.jsx'
import Tooltip from '../components/Tooltip.jsx'
import Can from '../components/Can.jsx'
import { api } from '../services/api.js'

export default function History({ onNavigate, initialPreset }) {
  const [history, setHistory] = useState([])
  const [servers, setServers] = useState([])
  const [statusOptions, setStatusOptions] = useState(['pending', 'running', 'success', 'failed', 'canceled'])
  const [selectedServerId, setSelectedServerId] = useState('all')
  const [selectedStatus, setSelectedStatus] = useState('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [varsView, setVarsView] = useState(null)
  const [redeployTarget, setRedeployTarget] = useState(null)
  const [redeploying, setRedeploying] = useState(false)
  const [redeployError, setRedeployError] = useState(null)
  const [cancelTarget, setCancelTarget] = useState(null)
  const [canceling, setCanceling] = useState(false)
  const [cancelError, setCancelError] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  useEffect(() => {
    if (!initialPreset) return
    if (initialPreset?.status) setSelectedStatus(String(initialPreset.status))
    if (initialPreset?.date) setQuery(String(initialPreset.date))
  }, [initialPreset])

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

  const parseTs = (v) => {
    const s = String(v || '').trim()
    if (!s) return NaN
    const hasTz = /([zZ]|[+-]\d\d:\d\d)$/.test(s)
    return Date.parse(hasTz ? s : `${s}Z`)
  }

  const tzParts = (d) => {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).formatToParts(d)
    const out = {}
    for (const p of parts) {
      if (p.type !== 'literal') out[p.type] = p.value
    }
    return out
  }

  const fmtTs = (v) => {
    const t = parseTs(v)
    if (!Number.isFinite(t)) return '-'
    const d = new Date(t)
    const p = tzParts(d)
    const ymd = `${p.year}/${p.month}/${p.day}`
    const hms = `${p.hour}:${p.minute}:${p.second}`
    return `${ymd} ${hms}`
  }

  const fmtTsCompact = (v) => {
    const t = parseTs(v)
    if (!Number.isFinite(t)) return '-'
    const d = new Date(t)
    const p = tzParts(d)
    return `${p.month}/${p.day} ${p.hour}:${p.minute}`
  }

  const filteredHistory = history.filter((h) => {
    const q = (query || '').trim().toLowerCase()
    if (!q) return true
    const sName = String(h.server_snapshot?.name || '').toLowerCase()
    const rName = String(h.repo_snapshot?.name || '').toLowerCase()
    const ref = String(h.ref || h.repo_snapshot?.branch || '').toLowerCase()
    const pid = h.pipeline_id ? String(h.pipeline_id) : ''
    const st = String(h.status || '').toLowerCase()
    const created = String(h.created_at || '').slice(0, 10).toLowerCase()
    return sName.includes(q) || rName.includes(q) || ref.includes(q) || pid.includes(q) || st.includes(q) || created.includes(q)
  })

  const pageSize = 10
  const total = filteredHistory.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  useEffect(() => {
    setPage(1)
  }, [query, selectedServerId, selectedStatus, history.length])
  const safePage = Math.min(totalPages, Math.max(1, page))
  const pagedHistory = filteredHistory.slice((safePage - 1) * pageSize, safePage * pageSize)

  return (
    <div className="panel-canvas">
      <div className="panel-frame">
        <div className="action-bar" style={{ margin: 0 }}>
          <div className="action-left">
            <div className="search-box">
              <Icon name="magnifying-glass" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索仓库 / 主机 / 分支 / Pipeline / 状态" />
            </div>
          </div>
          <div className="action-right">
            <Select
              className="action-select"
              value={selectedServerId}
              onChange={(v) => setSelectedServerId(v)}
              align="right"
              options={[{ value: 'all', label: '全部服务器' }, ...servers.map((s) => ({ value: s.id, label: s.name }))]}
            />
            <Select
              className="action-select"
              value={selectedStatus}
              onChange={(v) => setSelectedStatus(v)}
              align="right"
              options={[{ value: 'all', label: '全部状态' }, ...statusOptions.map((s) => ({ value: s, label: statusLabel(s) }))]}
            />
          </div>
        </div>

        <div className="panel-body">
          <div className="card">
            <div className="table-scroll">
              <table className="repo-table history-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th className="history-col-status">状态</th>
              <th className="history-col-task">任务说明</th>
              <th className="history-col-ci">CI 信息</th>
              <th className="history-col-vars">变量参数</th>
              <th className="history-col-time">触发时间</th>
              <th className="history-col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            {pagedHistory.map((h) => {
              const sName = h.server_snapshot?.name || 'Unknown Server'
              const rName = h.repo_snapshot?.name || 'Unknown Repo'
              const pipelineText = h.pipeline_id ? `Pipeline #${h.pipeline_id}` : '手动触发'
              const stLower = String(h.status || '').toLowerCase()
              const canCancel = (stLower === 'pending' || stLower === 'running') && !!h.pipeline_id
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
                  <td className="history-col-status">{getStatusIcon(h.status)}</td>
                  <td className="history-col-task">
                    <div style={{ fontWeight: 500 }}>{`Deploy ${rName}`}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>{`To: ${sName}`}</div>
                  </td>
                  <td>
                    <div className="history-ci">
                      <span className="history-ci-pill">{pipelineText.replace('Pipeline ', '')}</span>
                      {h.web_url ? (
                        <Tooltip content="在 GitLab 打开">
                          <a className="history-ci-link" href={h.web_url} target="_blank" onClick={(ev) => ev.stopPropagation()}>
                            <Icon name="arrow-up-right-from-square" />
                          </a>
                        </Tooltip>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    {!h.variables ? (
                      '-'
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <Tooltip content="点击查看详情">
                          <span
                            className="vars-pill"
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
                        </Tooltip>
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
                  <td className="history-time history-col-time">
                    <Tooltip content={fmtTs(h.created_at)}>
                      <span className="history-time-pill">{fmtTsCompact(h.created_at)}</span>
                    </Tooltip>
                  </td>
                  <td className="history-col-actions">
                    <div className="history-actions" style={{ justifyContent: 'center' }}>
                      <Tooltip content="查看详情">
                        <button
                          className="icon-btn history-action-btn primary"
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation()
                            onNavigate ? onNavigate('detail', h.deployment_id, { historyId: h.id }) : null
                          }}
                        >
                          <Icon name="circle-info" />
                        </button>
                      </Tooltip>
                      <Can perm="deploy:manage">
                        {canCancel ? (
                          <Tooltip content="停止部署">
                            <button
                              className="icon-btn history-action-btn warning"
                              type="button"
                              onClick={(ev) => {
                                ev.stopPropagation()
                                setCancelError(null)
                                setCancelTarget({
                                  id: h.id,
                                  deployment_id: h.deployment_id,
                                  pipeline_id: h.pipeline_id,
                                  web_url: h.web_url,
                                  status: h.status,
                                  server_name: h.server_snapshot?.name,
                                  repo_name: h.repo_snapshot?.name,
                                  ref: h.ref,
                                  created_at: h.created_at
                                })
                              }}
                            >
                              <Icon name="ban" />
                            </button>
                          </Tooltip>
                        ) : null}
                        <Tooltip content="重新部署">
                          <button
                            className="icon-btn history-action-btn primary"
                            type="button"
                            onClick={async (ev) => {
                              ev.stopPropagation()
                              setRedeployError(null)
                              setRedeployTarget({
                                history_id: h.id,
                                deployment_id: h.deployment_id,
                                deployment_name: h.deployment_name,
                                server_name: h.server_snapshot?.name,
                                repo_name: h.repo_snapshot?.name,
                                ref: h.ref,
                                created_at: h.created_at
                              })
                            }}
                          >
                            <Icon name="rocket" />
                          </button>
                        </Tooltip>
                      </Can>
                      <Can perm="audit:manage">
                        <Tooltip content="删除">
                          <button
                            className="icon-btn history-action-btn danger"
                            type="button"
                            onClick={(ev) => {
                              ev.stopPropagation()
                              setDeleteError(null)
                              setDeleteTarget({ id: h.id, deployment_id: h.deployment_id, status: h.status, created_at: h.created_at })
                            }}
                          >
                            <Icon name="trash" />
                          </button>
                        </Tooltip>
                      </Can>
                    </div>
                  </td>
                </tr>
              )
            })}
            {pagedHistory.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 24, color: 'var(--text-sub)', textAlign: 'center' }}>
                  {query ? '暂无匹配记录' : '暂无记录'}
                </td>
              </tr>
            ) : null}
          </tbody>
              </table>
            </div>
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

      {redeployTarget ? (
        <Modal
          title="重新部署"
          onClose={() => (redeploying ? null : setRedeployTarget(null))}
          footer={[
            <button key="c" className="btn btn-outline" onClick={() => setRedeployTarget(null)} disabled={redeploying}>
              取消
            </button>,
            <button
              key="ok"
              className="btn btn-primary"
              onClick={async () => {
                setRedeploying(true)
                setRedeployError(null)
                try {
                  const res = await api.post(`/api/deployments/${redeployTarget.deployment_id}/trigger`, {})
                  if (res?.ok && res?.history_id) {
                    setRedeployTarget(null)
                    onNavigate ? onNavigate('detail', redeployTarget.deployment_id, { historyId: res.history_id }) : null
                  } else {
                    const d = res?.detail
                    setRedeployError(typeof d === 'string' ? d : d ? JSON.stringify(d) : '触发失败')
                  }
                } finally {
                  setRedeploying(false)
                }
              }}
              disabled={redeploying}
            >
              <Icon name={redeploying ? 'spinner fa-spin' : 'rocket'} /> {redeploying ? '触发中...' : '确认触发'}
            </button>
          ]}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
            <div style={{ color: 'var(--text-sub)' }}>将基于该实例配置触发一次新的部署流水线。</div>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, marginTop: 8 }}>
              <div style={{ color: 'var(--text-sub)' }}>实例</div>
              <div style={{ fontWeight: 600 }}>{redeployTarget.deployment_name || redeployTarget.deployment_id}</div>
              <div style={{ color: 'var(--text-sub)' }}>仓库</div>
              <div>{redeployTarget.repo_name || '-'}</div>
              <div style={{ color: 'var(--text-sub)' }}>分支</div>
              <div>
                <span className="badge badge-gray" style={{ fontFamily: 'inherit' }}>
                  {redeployTarget.ref || '-'}
                </span>
              </div>
              <div style={{ color: 'var(--text-sub)' }}>服务器</div>
              <div>{redeployTarget.server_name || '-'}</div>
              <div style={{ color: 'var(--text-sub)' }}>参考记录</div>
              <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 12 }}>
                {String(redeployTarget.history_id).slice(0, 8)}
              </div>
            </div>
            {redeployError ? (
              <div
                style={{
                  marginTop: 6,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(239,68,68,0.25)',
                  background: 'rgba(239,68,68,0.06)',
                  color: '#b91c1c',
                  fontSize: 13
                }}
              >
                {redeployError}
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {cancelTarget ? (
        <Modal
          danger
          title="停止部署"
          onClose={() => (canceling ? null : setCancelTarget(null))}
          footer={[
            <button key="c" className="btn btn-outline" onClick={() => setCancelTarget(null)} disabled={canceling}>
              取消
            </button>,
            <button
              key="ok"
              className="btn btn-danger"
              onClick={async () => {
                setCanceling(true)
                setCancelError(null)
                try {
                  const res = await api.post(`/api/history/${cancelTarget.id}/cancel`, {})
                  if (res?.ok) {
                    setCancelTarget(null)
                    const qs = new URLSearchParams()
                    if (selectedServerId && selectedServerId !== 'all') qs.set('server_id', selectedServerId)
                    if (selectedStatus && selectedStatus !== 'all') qs.set('status', selectedStatus)
                    const url = qs.toString() ? `/api/history?${qs.toString()}` : '/api/history'
                    const h = await api.get(url)
                    setHistory(Array.isArray(h?.history) ? h.history : [])
                  } else {
                    const d = res?.detail
                    setCancelError(typeof d === 'string' ? d : d ? JSON.stringify(d) : '取消失败')
                  }
                } finally {
                  setCanceling(false)
                }
              }}
              disabled={canceling}
            >
              <Icon name={canceling ? 'spinner fa-spin' : 'ban'} /> {canceling ? '取消中...' : '确认停止'}
            </button>
          ]}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
            <div style={{ color: 'var(--text-sub)' }}>将请求 GitLab 取消该条 CI Pipeline（排队中/运行中均会被终止）。</div>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, marginTop: 8 }}>
              <div style={{ color: 'var(--text-sub)' }}>Pipeline</div>
              <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 12 }}>
                #{cancelTarget.pipeline_id}
              </div>
              <div style={{ color: 'var(--text-sub)' }}>仓库</div>
              <div>{cancelTarget.repo_name || '-'}</div>
              <div style={{ color: 'var(--text-sub)' }}>分支</div>
              <div>
                <span className="badge badge-gray" style={{ fontFamily: 'inherit' }}>
                  {cancelTarget.ref || '-'}
                </span>
              </div>
              <div style={{ color: 'var(--text-sub)' }}>服务器</div>
              <div>{cancelTarget.server_name || '-'}</div>
              {cancelTarget.web_url ? (
                <>
                  <div style={{ color: 'var(--text-sub)' }}>GitLab</div>
                  <a
                    href={cancelTarget.web_url}
                    target="_blank"
                    onClick={(ev) => ev.stopPropagation()}
                    style={{ color: 'var(--primary-dark)', textDecoration: 'none' }}
                  >
                    打开链接 <Icon name="arrow-up-right-from-square" />
                  </a>
                </>
              ) : null}
            </div>
            {cancelError ? (
              <div
                style={{
                  marginTop: 6,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(239,68,68,0.25)',
                  background: 'rgba(239,68,68,0.06)',
                  color: '#b91c1c',
                  fontSize: 13
                }}
              >
                {cancelError}
              </div>
            ) : null}
          </div>
        </Modal>
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
