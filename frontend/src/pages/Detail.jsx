import { useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import Icon from '../components/Icon.jsx'
import Modal from '../components/Modal.jsx'
import XTerm from '../components/XTerm.jsx'
import { api } from '../services/api.js'
import { toast } from '../services/toast.js'

export default function Detail({ taskId, historyId, onBack }) {
  const [task, setTask] = useState(null)
  const [server, setServer] = useState(null)
  const [repo, setRepo] = useState(null)
  const [deploying, setDeploying] = useState(false)
  const [logs, setLogs] = useState([])
  const [activeHistoryId, setActiveHistoryId] = useState(historyId || null)
  const [pipelineStatus, setPipelineStatus] = useState('unknown')
  const [terminalFull, setTerminalFull] = useState(false)
  const [triggerOpen, setTriggerOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [pendingTrigger, setPendingTrigger] = useState(false)
  const [rightTab, setRightTab] = useState('terminal')
  const [configList, setConfigList] = useState([])
  const [activeConfigId, setActiveConfigId] = useState(null)
  const [activeConfigPath, setActiveConfigPath] = useState(null)
  const [savedById, setSavedById] = useState({})
  const [draftById, setDraftById] = useState({})
  const [dirtyById, setDirtyById] = useState({})
  const [savingConfig, setSavingConfig] = useState(false)
  const [addConfigOpen, setAddConfigOpen] = useState(false)
  const [newRelPath, setNewRelPath] = useState('')
  const [mountedFiles, setMountedFiles] = useState([])
  const sseRef = useRef(null)
  const termApiRef = useRef(null)
  const viewHistory = !!historyId

  const addLog = (msg) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])
  }

  useEffect(() => {
    async function init() {
      const tasks = await api.get('/api/deployments')
      const list = Array.isArray(tasks) ? tasks : []
      const t = list.find((x) => x.id === taskId)
      if (!t) return
      setTask(t)

      const servers = await api.get('/api/servers')
      const sv = Array.isArray(servers) ? servers : []
      setServer(sv.find((x) => x.id === t.server_id) || null)

      const repos = await api.get('/api/repos')
      const rp = Array.isArray(repos) ? repos : []
      setRepo(rp.find((x) => x.id === t.repo_id) || null)
    }
    init()
  }, [taskId])

  useEffect(() => {
    if (!activeHistoryId) return
    if (sseRef.current) {
      try {
        sseRef.current.close()
      } catch (_) {}
      sseRef.current = null
    }
    const es = new EventSource(`/api/history/${activeHistoryId}/events`)
    sseRef.current = es
    es.addEventListener('init', (ev) => {
      try {
        const d = JSON.parse(ev.data || '{}')
        const files = Array.isArray(d.config_files) ? d.config_files : []
        if (files.length) setMountedFiles(files)
      } catch (_) {}
    })
    es.addEventListener('status', (ev) => {
      try {
        const d = JSON.parse(ev.data || '{}')
        const st = d.status || 'unknown'
        setPipelineStatus(st)
        if (['success', 'failed', 'canceled'].includes(st) && !viewHistory) {
          setDeploying(false)
        }
      } catch (_) {}
    })
    es.addEventListener('log', (ev) => {
      try {
        const d = JSON.parse(ev.data || '{}')
        if (d.line) addLog(d.line)
      } catch (_) {}
    })
    es.onerror = () => {
      addLog('!! SSE disconnected')
    }
    return () => {
      try {
        es.close()
      } catch (_) {}
      if (sseRef.current === es) sseRef.current = null
    }
  }, [activeHistoryId])

  const copyText = async (text) => {
    const t = text || ''
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(t)
        return true
      }
    } catch (_) {}
    try {
      const ta = document.createElement('textarea')
      ta.value = t
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch (_) {
      return false
    }
  }

  const handleCopyLogs = async () => {
    const ok = await copyText(logs.join('\n'))
    addLog(ok ? '>> Copied logs to clipboard' : '!! Copy failed')
  }

  const handleClearLogs = () => setLogs([])

  const handleTrigger = async () => {
    if (viewHistory) return
    const hasDirty = Object.values(dirtyById || {}).some(Boolean)
    if (hasDirty) {
      setDiscardOpen(true)
      setPendingTrigger(true)
      return
    }
    setDeploying(true)
    setLogs(['>> Initializing deployment sequence...', '>> Connecting to GitLab API...'])
    setPipelineStatus('pending')
    try {
      const res = await api.post(`/api/deployments/${taskId}/trigger`, {})
      if (res.ok) {
        addLog(`>> Trigger successful! Pipeline ID: ${res.pipeline?.id}`)
        addLog(`>> Web URL: ${res.pipeline?.web_url}`)
        setActiveHistoryId(res.history_id)
        setMountedFiles(Array.isArray(res.config_files) ? res.config_files : [])
      } else {
        addLog(`!! Trigger failed: ${JSON.stringify(res)}`)
        setDeploying(false)
      }
    } catch (e) {
      addLog('!! Exception during trigger')
      setDeploying(false)
    }
  }

  const busy = deploying || pipelineStatus === 'running' || pipelineStatus === 'pending'

  const loadConfigs = async () => {
    if (viewHistory) {
      const res = await api.get(`/api/history/${historyId}/configs`)
      const arr = Array.isArray(res?.files) ? res.files : []
      setConfigList(arr)
      if (!activeConfigId && arr.length) {
        await openConfig(arr[0].id)
      }
      return
    }
    const list = await api.get(`/api/deployments/${taskId}/configs`)
    const arr = Array.isArray(list) ? list : []
    setConfigList(arr)
    if (!activeConfigId && arr.length) {
      await openConfig(arr[0].id)
    }
  }

  const openConfig = async (id) => {
    setActiveConfigId(id)
    const existing = draftById[id]
    if (existing !== undefined) {
      const item = configList.find((x) => x.id === id)
      setActiveConfigPath(item?.rel_path || activeConfigPath)
      return
    }
    const res = viewHistory
      ? await api.get(`/api/history/${historyId}/configs/${id}`)
      : await api.get(`/api/deployments/${taskId}/configs/${id}`)
    const content = typeof res?.content === 'string' ? res.content : ''
    setActiveConfigPath(res?.rel_path || null)
    setSavedById((p) => ({ ...p, [id]: content }))
    setDraftById((p) => ({ ...p, [id]: content }))
    setDirtyById((p) => ({ ...p, [id]: false }))
  }

  const langByPath = (p) => {
    const s = (p || '').toLowerCase()
    if (s.endsWith('.json')) return 'json'
    if (s.endsWith('.toml')) return 'toml'
    if (s.endsWith('.env')) return 'shell'
    return 'plaintext'
  }

  const monacoBeforeMount = (monaco) => {
    if (monaco.languages.getLanguages().some((l) => l.id === 'toml')) return
    monaco.languages.register({ id: 'toml' })
    monaco.languages.setMonarchTokensProvider('toml', {
      tokenizer: {
        root: [
          [/^\s*\[[^\]]+\]\s*$/, 'type.identifier'],
          [/^\s*#.*$/, 'comment'],
          [/".*?"/, 'string'],
          [/'[^']*'/, 'string'],
          [/\b(true|false)\b/, 'keyword'],
          [/\b\d+(\.\d+)?\b/, 'number'],
          [/^[A-Za-z0-9_.-]+\s*(?==)/, 'identifier'],
          [/=/, 'delimiter']
        ]
      }
    })
  }

  useEffect(() => {
    if (rightTab !== 'config') return
    loadConfigs()
  }, [rightTab, taskId])

  const saveActiveConfig = async () => {
    if (!activeConfigId) return
    if (viewHistory) return
    if (!dirtyById[activeConfigId]) return
    setSavingConfig(true)
    try {
      const content = draftById[activeConfigId] ?? ''
      const res = await api.put(`/api/deployments/${taskId}/configs/${activeConfigId}`, { content })
      if (res?.ok) {
        setSavedById((p) => ({ ...p, [activeConfigId]: content }))
        setDirtyById((p) => ({ ...p, [activeConfigId]: false }))
        await loadConfigs()
        toast.success('配置已同步')
      } else {
        toast.error('保存失败')
      }
    } finally {
      setSavingConfig(false)
    }
  }

  const downloadConfigZip = async () => {
    const url = viewHistory ? `/api/history/${historyId}/configs.zip` : `/api/deployments/${taskId}/configs.zip`
    const res = await fetch(url)
    if (!res.ok) return toast.error('下载失败')
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = viewHistory ? `history-${historyId}-configs.zip` : `deployment-${taskId}-configs.zip`
    document.body.appendChild(a)
    a.click()
    URL.revokeObjectURL(a.href)
    document.body.removeChild(a)
  }

  const createConfigFile = async () => {
    if (viewHistory) return
    const rel_path = (newRelPath || '').trim()
    if (!rel_path) return
    const res = await api.post(`/api/deployments/${taskId}/configs`, { rel_path })
    if (res?.id) {
      setAddConfigOpen(false)
      setNewRelPath('')
      await loadConfigs()
      await openConfig(res.id)
      toast.success('配置文件已创建')
    } else {
      toast.error(typeof res?.detail === 'string' ? res.detail : '创建失败')
    }
  }

  const renderTerminal = () => (
    <div className={`terminal-shell ${terminalFull ? 'terminal-fullscreen' : ''}`} style={terminalFull ? undefined : { flex: 1, minHeight: 0 }}>
      <div className="term-header">
        <span>TERMINAL - {activeHistoryId ? `history #${activeHistoryId}` : 'ssh output stream'}</span>
        <div className="term-actions">
          <div className="term-action-btn" title={terminalFull ? '退出全屏' : '全屏查看'} onClick={() => setTerminalFull((v) => !v)}>
            <Icon name={terminalFull ? 'compress' : 'expand'} />
          </div>
          <div className="term-action-btn" title="复制日志" onClick={handleCopyLogs}>
            <Icon name="copy" />
          </div>
          <div className="term-action-btn" title="清空面板" onClick={handleClearLogs}>
            <Icon name="trash" />
          </div>
        </div>
      </div>
      <div className="term-body">
        <XTerm
          lines={logs}
          onReady={({ term, fit }) => {
            termApiRef.current = { term, fit }
          }}
        />
      </div>
    </div>
  )

  if (!task) return <div className="empty-state">Loading...</div>

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 0 20px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button className="btn btn-ghost" onClick={onBack}>
            <Icon name="arrow-left" /> 返回
          </button>
          <h2 style={{ margin: 0 }}>{task.name}</h2>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            if (viewHistory) return
            const hasDirty = Object.values(dirtyById || {}).some(Boolean)
            if (hasDirty) {
              setPendingTrigger(true)
              setDiscardOpen(true)
            } else {
              setTriggerOpen(true)
            }
          }}
          disabled={deploying || viewHistory}
        >
          <Icon name={deploying ? 'spinner fa-spin' : 'rocket'} /> {deploying ? '部署中...' : '触发部署'}
        </button>
      </div>

      <div className="cockpit-grid">
        <div className="card status-panel">
          <div className={`status-node ${busy ? 'flow' : ''}`}>
            <div className="node-icon active">
              <Icon name="code-branch" />
            </div>
            <div className="node-content">
              <h4>仓库连通性</h4>
              <p>{repo?.name}</p>
              <p>{`Branch: ${repo?.branch}`}</p>
              <div style={{ marginTop: 4, color: 'var(--success)', fontSize: 12 }}>
                <Icon name="check" /> Connected
              </div>
            </div>
          </div>
          <div className={`status-node ${busy ? 'flow' : ''}`}>
            <div className={`node-icon ${busy ? 'active pulsing spin' : ''}`}>
              <Icon name="gears" />
            </div>
            <div className="node-content">
              <h4>CI/CD 流水线</h4>
              <p>{pipelineStatus === 'unknown' ? 'Ready' : `Status: ${pipelineStatus}`}</p>
              {activeHistoryId ? <p>Monitoring...</p> : null}
            </div>
          </div>
          <div className="status-node">
            <div className="node-icon active">
              <Icon name="server" />
            </div>
            <div className="node-content">
              <h4>目标服务器</h4>
              <p>{server?.name}</p>
              <p>{server?.address}</p>
              <div style={{ marginTop: 4, color: 'var(--success)', fontSize: 12 }}>
                <Icon name="check" /> Online
              </div>
            </div>
          </div>

          <div className="deploy-meta">
            <div>
              Branch: <code>{repo?.branch || '-'}</code>
            </div>
            <div>
              SERVER_HOST: <code>{server?.address || '-'}</code>
            </div>
            <div>
              SERVER_USER: <code>{server?.ssh_user || 'metalm'}</code>
            </div>
            <div>
              Deploy Path: <code>{server?.deploy_path || '-'}</code>
            </div>
          </div>

          <div className="mounted-card">
            <div className="mounted-title">
              <span>🗂️ 本次部署挂载配置 ({mountedFiles.length})</span>
              <span style={{ color: 'var(--text-sub)', fontSize: 12 }}>{viewHistory ? '只读快照' : '当前配置'}</span>
            </div>
            <div className="mounted-files">
              {mountedFiles.length ? mountedFiles.map((p) => <div key={p}>{p}</div>) : <div style={{ color: 'rgba(15,23,42,0.55)' }}>暂无</div>}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', minHeight: 0 }}>
          <div className="tabs">
            <button className={`tab ${rightTab === 'terminal' ? 'active' : ''}`} onClick={() => setRightTab('terminal')}>
              运行状态与日志
            </button>
            <button className={`tab ${rightTab === 'config' ? 'active' : ''}`} onClick={() => setRightTab('config')}>
              配置文件管理
            </button>
          </div>

          {rightTab === 'terminal' ? (
            renderTerminal()
          ) : (
            <div className="config-split">
              <div className="config-tree">
                <div className="config-tree-head">
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-main)' }}>配置文件</div>
                  <button className="icon-btn" onClick={() => setAddConfigOpen(true)} disabled={viewHistory} title="新增配置文件">
                    <Icon name="plus" />
                  </button>
                </div>
                <div className="config-tree-list">
                  {configList.length === 0 ? (
                    <div style={{ color: 'rgba(148,163,184,0.9)', padding: 12, fontSize: 13 }}>
                      {viewHistory ? '该历史记录暂无配置快照' : '暂无配置文件'}
                    </div>
                  ) : (
                    configList.map((f) => {
                      const dirty = !!dirtyById[f.id]
                      return (
                        <div
                          key={f.id}
                          className={`config-item ${activeConfigId === f.id ? 'active' : ''}`}
                          onClick={() => openConfig(f.id)}
                        >
                          <div className="config-item-name">
                            <Icon name="file-lines" />
                            <span title={f.rel_path}>{f.rel_path}</span>
                          </div>
                          {dirty ? <span className="config-dirty">*</span> : null}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              <div className="config-editor">
                <div className="config-editor-head">
                  <div className="config-editor-title">
                    <Icon name="code" />
                    <span>{activeConfigPath || '未选择文件'}</span>
                    {activeConfigId && dirtyById[activeConfigId] ? <span className="config-dirty">*</span> : null}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button className="btn btn-outline btn-sm" onClick={downloadConfigZip} disabled={!activeConfigId && configList.length === 0}>
                      <Icon name="download" /> 下载 ZIP
                    </button>
                    <button
                      className={`btn btn-primary btn-sm ${activeConfigId && dirtyById[activeConfigId] ? 'btn-flash' : ''}`}
                      onClick={saveActiveConfig}
                      disabled={viewHistory || !activeConfigId || savingConfig || !dirtyById[activeConfigId]}
                    >
                      <Icon name={savingConfig ? 'spinner fa-spin' : 'floppy-disk'} /> 保存配置
                    </button>
                  </div>
                </div>
                {activeConfigId ? (
                  <div className="monaco-wrap">
                    <Editor
                      beforeMount={monacoBeforeMount}
                      theme="vs-dark"
                      language={langByPath(activeConfigPath)}
                      value={draftById[activeConfigId] ?? ''}
                      onChange={(v) => {
                        if (!activeConfigId) return
                        if (viewHistory) return
                        const next = v ?? ''
                        setDraftById((p) => ({ ...p, [activeConfigId]: next }))
                        const saved = savedById[activeConfigId] ?? ''
                        setDirtyById((p) => ({ ...p, [activeConfigId]: next !== saved }))
                      }}
                      options={{
                        readOnly: viewHistory || !activeConfigId,
                        fontSize: 13,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        lineNumbers: 'on',
                        wordWrap: 'off',
                        automaticLayout: true
                      }}
                    />
                  </div>
                ) : (
                  <div className="config-placeholder">
                    <div className="config-placeholder-inner">
                      <Icon name="file-circle-plus" />
                      <span>请在左侧选择文件进行预览或编辑</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {terminalFull ? (
        <div className="terminal-overlay" onClick={() => setTerminalFull(false)} />
      ) : null}

      {triggerOpen ? (
        <Modal
          title="触发部署"
          onClose={() => setTriggerOpen(false)}
          footer={[
            <button key="c" className="btn btn-outline" onClick={() => setTriggerOpen(false)}>
              取消
            </button>,
            <button
              key="ok"
              className="btn btn-primary"
              onClick={async () => {
                setTriggerOpen(false)
                await handleTrigger()
              }}
              disabled={deploying}
            >
              <Icon name="rocket" /> 确认触发
            </button>
          ]}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
            <div style={{ color: 'var(--text-sub)' }}>将触发一次新的流水线部署，请确认目标信息无误。</div>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, marginTop: 8 }}>
              <div style={{ color: 'var(--text-sub)' }}>任务</div>
              <div style={{ fontWeight: 600 }}>{task?.name}</div>
              <div style={{ color: 'var(--text-sub)' }}>仓库</div>
              <div>{repo?.name || '-'}</div>
              <div style={{ color: 'var(--text-sub)' }}>分支</div>
              <div>
                <span className="badge badge-gray" style={{ fontFamily: 'inherit' }}>
                  {repo?.branch || 'master'}
                </span>
              </div>
              <div style={{ color: 'var(--text-sub)' }}>服务器</div>
              <div>{server?.name || '-'}</div>
              <div style={{ color: 'var(--text-sub)' }}>地址</div>
              <div style={{ fontFamily: 'monospace' }}>{server?.address || '-'}</div>
            </div>
          </div>
        </Modal>
      ) : null}

      {discardOpen ? (
        <Modal
          danger
          title="未保存配置拦截"
          onClose={() => {
            setDiscardOpen(false)
            setPendingTrigger(false)
          }}
          footer={[
            <button
              key="c"
              className="btn btn-outline"
              onClick={() => {
                setDiscardOpen(false)
                setPendingTrigger(false)
              }}
            >
              取消
            </button>,
            <button
              key="ok"
              className="btn btn-danger"
              onClick={async () => {
                const nextDraft = { ...draftById }
                for (const k of Object.keys(dirtyById || {})) {
                  if (dirtyById[k]) nextDraft[k] = savedById[k] ?? ''
                }
                setDraftById(nextDraft)
                const cleared = {}
                for (const k of Object.keys(dirtyById || {})) cleared[k] = false
                setDirtyById((p) => ({ ...p, ...cleared }))
                setDiscardOpen(false)
                if (pendingTrigger) {
                  setPendingTrigger(false)
                  await handleTrigger()
                }
              }}
              disabled={deploying}
            >
              放弃变更并部署
            </button>
          ]}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
            <div style={{ color: 'var(--text-sub)' }}>检测到有未保存的配置变更，是否放弃变更直接部署？</div>
          </div>
        </Modal>
      ) : null}

      {addConfigOpen ? (
        <Modal
          title="新增配置文件"
          onClose={() => setAddConfigOpen(false)}
          footer={[
            <button key="c" className="btn btn-outline" onClick={() => setAddConfigOpen(false)}>
              取消
            </button>,
            <button key="ok" className="btn btn-primary" onClick={createConfigFile}>
              创建
            </button>
          ]}
        >
          <div className="form-item">
            <label className="form-label">请输入相对路径（如 agents/backend/config.toml）</label>
            <input className="form-input" value={newRelPath} onChange={(e) => setNewRelPath(e.target.value)} />
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
