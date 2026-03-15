import { useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import Icon from '../components/Icon.jsx'
import Modal from '../components/Modal.jsx'
import Tooltip from '../components/Tooltip.jsx'
import Can from '../components/Can.jsx'
import XTerm from '../components/XTerm.jsx'
import { api } from '../services/api.js'
import { toast } from '../services/toast.js'

export default function Detail({ taskId, historyId, onBack, onNavigate }) {
  const [task, setTask] = useState(null)
  const [server, setServer] = useState(null)
  const [repo, setRepo] = useState(null)
  const [deploying, setDeploying] = useState(false)
  const [logs, setLogs] = useState([])
  const [activeHistoryId, setActiveHistoryId] = useState(historyId || null)
  const [pipelineStatus, setPipelineStatus] = useState('unknown')
  const [mode, setMode] = useState('ready')
  const [monitorOk, setMonitorOk] = useState(false)
  const [monitorLoading, setMonitorLoading] = useState(false)
  const [monitorError, setMonitorError] = useState(null)
  const [monitorGroups, setMonitorGroups] = useState([])
  const [monitorReload, setMonitorReload] = useState(0)
  const [monitorEnabled, setMonitorEnabled] = useState(false)
  const [showDraftTip, setShowDraftTip] = useState(true)
  const [draftAction, setDraftAction] = useState(null)
  const [terminalFull, setTerminalFull] = useState(false)
  const [triggerOpen, setTriggerOpen] = useState(false)
  const [historyNavOpen, setHistoryNavOpen] = useState(false)
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
  const [renameOpen, setRenameOpen] = useState(null)
  const [renamePath, setRenamePath] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(null)
  const [deletingConfig, setDeletingConfig] = useState(false)
  const [renamingConfig, setRenamingConfig] = useState(false)
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

      if (!historyId) {
        try {
          const h = await api.get(`/api/history?deployment_id=${encodeURIComponent(taskId)}`)
          const items = Array.isArray(h?.history) ? h.history : []
          setMonitorOk(items.some((x) => String(x?.status || '').toLowerCase() === 'success'))
          if (items.length) {
            const latest = items[0]
            if (latest?.id) {
              setActiveHistoryId(latest.id)
              if (latest?.status) setPipelineStatus(latest.status)
              const tail = latest?.server_snapshot?.log_tail
              if (typeof tail === 'string' && tail.trim() !== '') {
                setLogs(tail.split('\n').slice(-2000))
              }
              const st = String(latest?.status || '').toLowerCase()
              if (st === 'running' || st === 'pending') {
                setMode('monitor')
                setRightTab('terminal')
              } else if (st === 'failed') {
                setMode('diagnose')
                setRightTab('terminal')
              } else {
                setMode('ready')
                setShowDraftTip(false)
                setRightTab('config')
              }
            }
          }
        } catch (_) {}
      }
    }
    init()
  }, [taskId])

  useEffect(() => {
    if (viewHistory) return
    if (rightTab !== 'monitor') return
    if (!monitorOk) return
    if (!monitorEnabled) return
    let alive = true
    let timer = null
    const load = async () => {
      setMonitorLoading(true)
      setMonitorError(null)
      try {
        const res = await api.get(`/api/deployments/${taskId}/monitor`)
        if (!alive) return
        if (res?.ok) {
          setMonitorGroups(Array.isArray(res.groups) ? res.groups : [])
        } else {
          const d = res?.detail
          setMonitorError(typeof d === 'string' ? d : d ? JSON.stringify(d) : '监控失败')
        }
      } catch (e) {
        if (!alive) return
        setMonitorError('监控失败')
      } finally {
        if (alive) setMonitorLoading(false)
      }
    }
    load()
    timer = setInterval(load, 12000)
    return () => {
      alive = false
      if (timer) clearInterval(timer)
    }
  }, [rightTab, monitorOk, monitorEnabled, taskId, viewHistory, monitorReload])

  useEffect(() => {
    if (rightTab === 'monitor') return
    if (!monitorEnabled) return
    setMonitorEnabled(false)
  }, [rightTab, monitorEnabled])

  useEffect(() => {
    if (historyId) {
      setMode('history')
      return
    }
    const st = String(pipelineStatus || '').toLowerCase()
    if (st === 'running' || st === 'pending') setMode('monitor')
    else if (st === 'failed') setMode('diagnose')
    else if (st === 'success' || st === 'canceled') {
      setMode('ready')
      setShowDraftTip(true)
    }
  }, [historyId, pipelineStatus])

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
    let finished = false
    let warned = false
    es.addEventListener('init', (ev) => {
      try {
        const d = JSON.parse(ev.data || '{}')
        const files = Array.isArray(d.config_files) ? d.config_files : []
        setMountedFiles(files)
      } catch (_) {}
    })
    es.addEventListener('status', (ev) => {
      try {
        const d = JSON.parse(ev.data || '{}')
        const st = d.status || 'unknown'
        setPipelineStatus(st)
        if (st === 'success' && !viewHistory) {
          setMonitorOk(true)
          setMode('ready')
          setShowDraftTip(false)
        }
        if (['success', 'failed', 'canceled'].includes(st) && !viewHistory) {
          setDeploying(false)
        }
        if (['success', 'failed', 'canceled'].includes(st)) {
          finished = true
          if (!viewHistory && mode !== 'diagnose') {
            try {
              es.close()
            } catch (_) {}
          }
        }
      } catch (_) {}
    })
    es.addEventListener('log', (ev) => {
      try {
        const d = JSON.parse(ev.data || '{}')
        if (d.line) addLog(d.line)
      } catch (_) {}
    })
    es.addEventListener('done', () => {
      finished = true
      try {
        es.close()
      } catch (_) {}
    })
    es.onerror = () => {
      if (finished) return
      if (es.readyState === EventSource.CLOSED) return
      if (warned) return
      warned = true
      addLog('!! SSE disconnected')
    }
    return () => {
      try {
        es.close()
      } catch (_) {}
      if (sseRef.current === es) sseRef.current = null
    }
  }, [activeHistoryId, mode, viewHistory])

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
    setRightTab('terminal')
    setMode('monitor')
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

  const mountPaths =
    viewHistory
      ? mountedFiles
      : configList.length
        ? configList.map((x) => x?.rel_path).filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)))
        : mountedFiles

  const loadConfigs = async (opts = {}) => {
    const forceOpenFirst = !!opts.forceOpenFirst
    const forceReload = !!opts.forceReload
    if (viewHistory) {
      const res = await api.get(`/api/history/${historyId}/configs`)
      const arr = Array.isArray(res?.files) ? res.files : []
      setConfigList(arr)
      if ((forceOpenFirst || !activeConfigId) && arr.length) {
        await openConfig(arr[0].id, { forceReload })
      }
      return
    }
    const list = await api.get(`/api/deployments/${taskId}/configs`)
    const arr = Array.isArray(list) ? list : []
    setConfigList(arr)
    if ((forceOpenFirst || !activeConfigId) && arr.length) {
      await openConfig(arr[0].id, { forceReload })
    }
  }

  const openConfig = async (id, opts = {}) => {
    const forceReload = !!opts.forceReload
    setActiveConfigId(id)
    if (!forceReload) {
      const existing = draftById[id]
      if (existing !== undefined) {
        const item = configList.find((x) => x.id === id)
        setActiveConfigPath(item?.rel_path || activeConfigPath)
        return
      }
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

  const reloadWorkspace = async () => {
    setSavedById({})
    setDraftById({})
    setDirtyById({})
    setActiveConfigId(null)
    setActiveConfigPath(null)
    await loadConfigs({ forceOpenFirst: true, forceReload: true })
  }

  const clearWorkspace = async () => {
    if (viewHistory) return
    const res = await api.post(`/api/deployments/${taskId}/configs/clear`, {})
    if (res?.ok) {
      toast.success('草稿已清空')
      setShowDraftTip(false)
      await reloadWorkspace()
    } else {
      toast.error(typeof res?.detail === 'string' ? res.detail : '清空失败')
    }
  }

  const restoreDefaultTemplate = async () => {
    if (viewHistory) return
    const cleared = await api.post(`/api/deployments/${taskId}/configs/clear`, {})
    if (!cleared?.ok) {
      toast.error(typeof cleared?.detail === 'string' ? cleared.detail : '恢复失败')
      return
    }
    const created = await api.post(`/api/deployments/${taskId}/configs`, { rel_path: 'config.toml' })
    if (!created?.id) {
      toast.error(typeof created?.detail === 'string' ? created.detail : '恢复失败')
      await reloadWorkspace()
      return
    }
    const put = await api.put(`/api/deployments/${taskId}/configs/${created.id}`, { content: '' })
    if (!put?.ok) {
      toast.error('恢复失败')
      await reloadWorkspace()
      return
    }
    toast.success('已恢复默认模板')
    setShowDraftTip(false)
    await reloadWorkspace()
  }

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

  const openRename = (f) => {
    setRenameOpen({ id: f.id, rel_path: f.rel_path })
    setRenamePath(f.rel_path || '')
  }

  const submitRename = async () => {
    if (viewHistory) return
    if (!renameOpen) return
    const next = (renamePath || '').trim()
    if (!next) return toast.error('请输入文件路径')
    setRenamingConfig(true)
    try {
      const res = await api.put(`/api/deployments/${taskId}/configs/${renameOpen.id}/rename`, { rel_path: next })
      if (res?.ok) {
        await loadConfigs()
        if (activeConfigId === renameOpen.id) setActiveConfigPath(res.rel_path || next)
        setRenameOpen(null)
        toast.success('已更新文件路径')
      } else {
        toast.error(typeof res?.detail === 'string' ? res.detail : '更新失败')
      }
    } finally {
      setRenamingConfig(false)
    }
  }

  const openDeleteConfig = (f) => {
    setDeleteOpen({ id: f.id, rel_path: f.rel_path })
  }

  const submitDeleteConfig = async () => {
    if (viewHistory) return
    if (!deleteOpen) return
    setDeletingConfig(true)
    try {
      const res = await api.del(`/api/deployments/${taskId}/configs/${deleteOpen.id}`)
      if (res?.ok) {
        const deletedId = deleteOpen.id
        setDeleteOpen(null)
        if (activeConfigId === deletedId) {
          setActiveConfigId(null)
          setActiveConfigPath(null)
        }
        setSavedById((p) => {
          const n = { ...p }
          delete n[deletedId]
          return n
        })
        setDraftById((p) => {
          const n = { ...p }
          delete n[deletedId]
          return n
        })
        setDirtyById((p) => {
          const n = { ...p }
          delete n[deletedId]
          return n
        })
        await loadConfigs()
        toast.success('已删除')
      } else {
        toast.error(typeof res?.detail === 'string' ? res.detail : '删除失败')
      }
    } finally {
      setDeletingConfig(false)
    }
  }

  const renderTerminal = () => (
    <div className={`terminal-shell ${terminalFull ? 'terminal-fullscreen' : ''}`} style={terminalFull ? undefined : { flex: 1, minHeight: 0 }}>
      <div className="term-header">
        <span>TERMINAL - {activeHistoryId ? `history #${activeHistoryId}` : 'ssh output stream'}</span>
        <div className="term-actions">
          <Tooltip content={terminalFull ? '退出全屏' : '全屏查看'}>
            <div className="term-action-btn" onClick={() => setTerminalFull((v) => !v)}>
              <Icon name={terminalFull ? 'compress' : 'expand'} />
            </div>
          </Tooltip>
          <Tooltip content="复制日志">
            <div className="term-action-btn" onClick={handleCopyLogs}>
              <Icon name="copy" />
            </div>
          </Tooltip>
          <Tooltip content="清空面板">
            <div className="term-action-btn" onClick={handleClearLogs}>
              <Icon name="trash" />
            </div>
          </Tooltip>
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

  const hasDirty = Object.values(dirtyById || {}).some(Boolean)
  const modeLabel = viewHistory ? '历史' : mode === 'monitor' ? '监控' : mode === 'diagnose' ? '诊断' : '就绪'
  const modeDotClass = viewHistory ? 'idle' : mode === 'monitor' ? 'busy' : mode === 'diagnose' ? 'offline' : 'online'

  return (
    <div className="panel-canvas">
      <div className="panel-frame">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tooltip content="返回">
              <button className="icon-btn back-btn" onClick={onBack}>
                <Icon name="arrow-left" />
              </button>
            </Tooltip>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: 0.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {task.name}
              </h2>
              <span className="mode-pill">
                <span className={`status-dot ${modeDotClass}`} />
                {modeLabel}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tooltip content="进入审计日志">
              <button className="icon-btn" onClick={() => setHistoryNavOpen(true)} disabled={deploying}>
                <Icon name="clock-rotate-left" />
              </button>
            </Tooltip>
            <Can perm="deploy:manage">
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (viewHistory) return
                  if (hasDirty) {
                    setPendingTrigger(true)
                    setDiscardOpen(true)
                  } else {
                    setTriggerOpen(true)
                  }
                }}
                disabled={busy || viewHistory}
              >
                <Icon name={deploying ? 'spinner fa-spin' : 'rocket'} /> {deploying ? '部署中...' : '触发部署'}
              </button>
            </Can>
          </div>
        </div>

      {mode === 'diagnose' && !viewHistory ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
          <div style={{ color: 'var(--text-sub)', fontSize: 13 }}>
            最近一次执行失败，优先查看现场日志再决定是否重新部署。
          </div>
        </div>
      ) : null}

        <div style={{ marginTop: 16, marginBottom: 14 }}>
        <div className="tabs">
          <button className={`tab ${rightTab === 'terminal' ? 'active' : ''}`} onClick={() => setRightTab('terminal')}>
            运行状态与日志
          </button>
          <button className={`tab ${rightTab === 'config' ? 'active' : ''}`} onClick={() => setRightTab('config')}>
            配置文件管理
          </button>
          <Tooltip content={!monitorOk ? '请先完成首次部署' : viewHistory ? '历史记录不支持实时监控' : ''}>
            <button
              className={`tab ${rightTab === 'monitor' ? 'active' : ''}`}
              onClick={() => setRightTab('monitor')}
              disabled={!monitorOk || viewHistory}
            >
              服务实时监控
            </button>
          </Tooltip>
        </div>
      </div>

        <div className="panel-body">
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
              {activeHistoryId ? <p>{busy ? 'Monitoring...' : `Latest: history #${String(activeHistoryId).slice(0, 6)}`}</p> : null}
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
            <div className="meta-item">
              <div className="meta-label">枝干 (Branch)</div>
              <div className="meta-value">{repo?.branch || '-'}</div>
            </div>
            <div className="meta-item">
              <div className="meta-label">目标主机 (Server)</div>
              <div className="meta-value meta-mono">{`${server?.ssh_user || 'metalm'} @ ${server?.address || '-'}`}</div>
            </div>
            <div className="meta-item">
              <div className="meta-label">部署路径 (Deploy Path)</div>
              <div className="meta-value meta-mono">{server?.deploy_path || '-'}</div>
            </div>
            <div className="meta-item">
              <div className="meta-label">挂载配置</div>
              <div className="meta-value">{`${mountPaths.length} 项`}</div>
              {mountPaths.length ? (
                <div className="meta-files">
                  {mountPaths.map((p) => (
                    <div key={p}>{p}</div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%', minHeight: 0 }}>
          {rightTab === 'terminal' ? (
            renderTerminal()
          ) : rightTab === 'monitor' ? (
            <div className="config-pane" style={{ gap: 12 }}>
              <div className="card" style={{ padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--text-main)' }}>实时容器状态</div>
                    <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>
                      {monitorOk ? (monitorEnabled ? '监听中（每 12 秒刷新一次）' : '点击开始后才会查询远端状态（离开本页签自动断开）') : '请先完成首次部署后启用监控'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Tooltip content={!monitorEnabled ? '开始监听并发起首次查询' : '立即刷新一次'}>
                      <button
                        className="btn btn-outline btn-sm"
                        disabled={!monitorOk || monitorLoading}
                        onClick={() => {
                          if (!monitorEnabled) setMonitorEnabled(true)
                          else setMonitorReload((v) => v + 1)
                        }}
                      >
                        <Icon name={monitorLoading ? 'spinner fa-spin' : !monitorEnabled ? 'play' : 'arrows-rotate'} /> {!monitorEnabled ? '开始' : '刷新'}
                      </button>
                    </Tooltip>
                    {monitorEnabled ? (
                      <button className="btn btn-outline btn-sm" disabled={monitorLoading} onClick={() => setMonitorEnabled(false)}>
                        <Icon name="stop" /> 停止
                      </button>
                    ) : null}
                  </div>
                </div>
                {monitorError ? (
                  <div
                    style={{
                      marginTop: 10,
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(239,68,68,0.25)',
                      background: 'rgba(239,68,68,0.06)',
                      color: '#b91c1c',
                      fontSize: 13
                    }}
                  >
                    {monitorError}
                  </div>
                ) : null}
              </div>

              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {monitorLoading && monitorGroups.length === 0 ? (
                  <div style={{ padding: 16, color: 'var(--text-sub)' }}>加载中...</div>
                ) : monitorGroups.length ? (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {monitorGroups.map((g) => {
                      const list = Array.isArray(g?.containers) ? g.containers : []
                      const running = list.filter((c) => String(c?.State || '').toLowerCase() === 'running').length
                      const total = list.length
                      return (
                        <details key={g.compose_path} open>
                          <summary
                            style={{
                              listStyle: 'none',
                              cursor: 'pointer',
                              padding: '12px 14px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              borderBottom: '1px solid var(--border)',
                              background: 'linear-gradient(to right, #ffffff, #f8fafc)'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                              <Icon name="layer-group" style={{ color: 'rgba(100,116,139,0.9)' }} />
                              <span style={{ fontWeight: 700, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {g.compose_path}
                              </span>
                            </div>
                            <span style={{ color: 'var(--text-sub)', fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                              {running}/{total} running
                            </span>
                          </summary>
                          <div style={{ padding: 0 }}>
                            <table className="repo-table" style={{ width: '100%' }}>
                              <thead>
                                <tr>
                                  <th>容器</th>
                                  <th>状态</th>
                                  <th>镜像</th>
                                  <th>端口</th>
                                </tr>
                              </thead>
                              <tbody>
                                {list.length ? (
                                  list.map((c, idx) => (
                                    <tr key={c?.Name || `${g.compose_path}-${idx}`}>
                                      <td style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>{c?.Name || '-'}</td>
                                      <td>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                          <span className={`status-dot ${String(c?.State || '').toLowerCase() === 'running' ? 'online' : 'offline'}`} />
                                          {String(c?.State || 'unknown')}
                                        </span>
                                      </td>
                                      <td style={{ color: 'var(--text-sub)', fontSize: 13 }}>{c?.Image || '-'}</td>
                                      <td style={{ color: 'var(--text-sub)', fontSize: 13 }}>{c?.Ports || '-'}</td>
                                    </tr>
                                  ))
                                ) : (
                                  <tr>
                                    <td colSpan={4} style={{ padding: 14, color: 'var(--text-sub)' }}>
                                      未发现容器或 compose 命令不可用
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      )
                    })}
                  </div>
                ) : (
                  <div style={{ padding: 16, color: 'var(--text-sub)' }}>暂无监控数据</div>
                )}
              </div>
            </div>
          ) : (
            <div className="config-pane">
              {!viewHistory && mode === 'ready' && showDraftTip ? (
                <div
                  className="card"
                  style={{
                    padding: 12,
                    border: '1px solid rgba(59,130,246,0.22)',
                    background: 'rgba(59,130,246,0.06)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Icon name="pen-to-square" style={{ color: 'var(--info)' }} />
                        实例配置
                        <Tooltip content="隐藏提示">
                          <button className="icon-btn" onClick={() => setShowDraftTip(false)}>
                            <Icon name="xmark" />
                          </button>
                        </Tooltip>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-sub)' }}>
                        此处为该实例的固定配置文件，将在每次部署时自动挂载到目标路径。
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button className="btn btn-outline btn-sm" onClick={() => setDraftAction('restore')}>
                        <Icon name="arrow-rotate-left" /> 重置配置
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => setDraftAction('clear')}>
                        <Icon name="trash" /> 清空全部
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="config-split">
              <div className="config-tree">
                <div className="config-tree-head">
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-main)' }}>配置文件</div>
                  <Tooltip content="新增配置文件">
                    <button className="icon-btn" onClick={() => setAddConfigOpen(true)} disabled={viewHistory}>
                      <Icon name="plus" />
                    </button>
                  </Tooltip>
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
                            <Tooltip content={f.rel_path}>
                              <span>{f.rel_path}</span>
                            </Tooltip>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {dirty ? <span className="config-dirty">*</span> : null}
                            {!viewHistory ? (
                              <>
                                <Tooltip content="修改路径">
                                  <button
                                    className="icon-btn"
                                    style={{ width: 26, height: 26 }}
                                    onClick={(ev) => {
                                      ev.stopPropagation()
                                      openRename(f)
                                    }}
                                  >
                                    <Icon name="pen-to-square" />
                                  </button>
                                </Tooltip>
                                <Tooltip content="删除">
                                  <button
                                    className="icon-btn"
                                    style={{ width: 26, height: 26, color: 'var(--danger)' }}
                                    onClick={(ev) => {
                                      ev.stopPropagation()
                                      openDeleteConfig(f)
                                    }}
                                  >
                                    <Icon name="trash" />
                                  </button>
                                </Tooltip>
                              </>
                            ) : null}
                          </div>
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
                      <Icon name="file-lines" />
                      <span>请在左侧选择文件进行预览或编辑</span>
                    </div>
                  </div>
                )}
              </div>
              </div>
            </div>
          )}
        </div>
      </div>
        </div>
      </div>

      {draftAction ? (
        <Modal
          danger={draftAction === 'clear'}
          title={draftAction === 'clear' ? '清空全部' : '恢复默认模板'}
          onClose={() => setDraftAction(null)}
          footer={[
            <button key="c" className="btn btn-outline" onClick={() => setDraftAction(null)}>
              取消
            </button>,
            <button
              key="ok"
              className={draftAction === 'clear' ? 'btn btn-danger' : 'btn btn-primary'}
              onClick={async () => {
                const a = draftAction
                setDraftAction(null)
                if (a === 'clear') await clearWorkspace()
                else await restoreDefaultTemplate()
              }}
            >
              <Icon name={draftAction === 'clear' ? 'trash' : 'arrow-rotate-left'} /> 确认
            </button>
          ]}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
            <div style={{ color: 'var(--text-sub)' }}>
              {draftAction === 'clear'
                ? '将删除当前任务下所有草稿配置文件。'
                : '将清空当前草稿并创建默认模板文件 config.toml。'}
            </div>
          </div>
        </Modal>
      ) : null}

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

      {historyNavOpen ? (
        <Modal
          title="查看审计日志"
          onClose={() => setHistoryNavOpen(false)}
          footer={[
            <button key="c" className="btn btn-outline" onClick={() => setHistoryNavOpen(false)}>
              取消
            </button>,
            <button
              key="ok"
              className="btn btn-primary"
              onClick={() => {
                setHistoryNavOpen(false)
                if (onNavigate) onNavigate('history')
              }}
            >
              <Icon name="clock-rotate-left" /> 确认进入
            </button>
          ]}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
            <div style={{ color: 'var(--text-sub)' }}>将跳转到审计日志页面，查看该实例的部署记录。</div>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, marginTop: 8 }}>
              <div style={{ color: 'var(--text-sub)' }}>实例</div>
              <div style={{ fontWeight: 600 }}>{task?.name}</div>
              <div style={{ color: 'var(--text-sub)' }}>服务器</div>
              <div>{server?.name || '-'}</div>
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

      {renameOpen ? (
        <Modal
          title="修改文件路径"
          onClose={() => (renamingConfig ? null : setRenameOpen(null))}
          footer={[
            <button key="c" className="btn btn-outline" onClick={() => setRenameOpen(null)} disabled={renamingConfig}>
              取消
            </button>,
            <button key="ok" className="btn btn-primary" onClick={submitRename} disabled={renamingConfig}>
              <Icon name={renamingConfig ? 'spinner fa-spin' : 'floppy-disk'} /> {renamingConfig ? '保存中...' : '保存'}
            </button>
          ]}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ color: 'var(--text-sub)', fontSize: 13 }}>填写相对路径（会落在 DEST_DIR 下），例如 agents/backend/config.toml</div>
            <input className="form-input" value={renamePath} onChange={(e) => setRenamePath(e.target.value)} />
          </div>
        </Modal>
      ) : null}

      {deleteOpen ? (
        <Modal
          danger
          title="删除配置文件"
          onClose={() => (deletingConfig ? null : setDeleteOpen(null))}
          footer={[
            <button key="c" className="btn btn-outline" onClick={() => setDeleteOpen(null)} disabled={deletingConfig}>
              取消
            </button>,
            <button key="ok" className="btn btn-danger" onClick={submitDeleteConfig} disabled={deletingConfig}>
              <Icon name={deletingConfig ? 'spinner fa-spin' : 'trash'} /> {deletingConfig ? '删除中...' : '确认删除'}
            </button>
          ]}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
            <div style={{ color: 'var(--text-sub)' }}>删除后无法恢复，且会从配置 ZIP 中移除。</div>
            <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 12 }}>
              {deleteOpen.rel_path}
            </div>
            {deleteOpen.id === activeConfigId && dirtyById[activeConfigId] ? (
              <div style={{ color: 'var(--danger)', fontSize: 13 }}>当前文件有未保存修改，删除会丢失这些改动。</div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
