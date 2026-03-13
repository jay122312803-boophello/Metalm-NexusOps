import { useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import Modal from '../components/Modal.jsx'
import { api } from '../services/api.js'

export default function Detail({ taskId, onBack }) {
  const [task, setTask] = useState(null)
  const [server, setServer] = useState(null)
  const [repo, setRepo] = useState(null)
  const [deploying, setDeploying] = useState(false)
  const [logs, setLogs] = useState([])
  const [activeHistoryId, setActiveHistoryId] = useState(null)
  const [pipelineStatus, setPipelineStatus] = useState('unknown')
  const [terminalFull, setTerminalFull] = useState(false)
  const [triggerOpen, setTriggerOpen] = useState(false)
  const termRef = useRef(null)

  const addLog = (msg) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])
  }

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
  }, [logs, terminalFull])

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
    const interval = setInterval(async () => {
      try {
        const res = await api.get(`/api/history/${activeHistoryId}/status`)
        const status = res.status
        setPipelineStatus(status || 'unknown')
        addLog(`>> Pipeline status check: ${status || 'unknown'}`)
        if (['success', 'failed', 'canceled'].includes(status)) {
          addLog(`>> Pipeline finished with status: ${status}`)
          setDeploying(false)
          setActiveHistoryId(null)
        }
      } catch (e) {
        addLog(`!! Error checking status`)
      }
    }, 3000)
    return () => clearInterval(interval)
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
    setDeploying(true)
    setLogs(['>> Initializing deployment sequence...', '>> Connecting to GitLab API...'])
    setPipelineStatus('pending')
    try {
      const res = await api.post(`/api/deployments/${taskId}/trigger`, {})
      if (res.ok) {
        addLog(`>> Trigger successful! Pipeline ID: ${res.pipeline?.id}`)
        addLog(`>> Web URL: ${res.pipeline?.web_url}`)
        setActiveHistoryId(res.history_id)
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

  const renderTerminal = (full) => (
    <div className={full ? 'terminal-window terminal-full' : 'terminal-window'} style={full ? undefined : { flex: 1, minHeight: 0 }}>
      <div className="term-header">
        <span>TERMINAL - {activeHistoryId ? `history #${activeHistoryId}` : 'ssh output stream'}</span>
        <div className="term-actions">
          <div className="term-action-btn" title={full ? '退出全屏' : '全屏查看'} onClick={() => setTerminalFull((v) => !v)}>
            <Icon name={full ? 'compress' : 'expand'} />
          </div>
          <div className="term-action-btn" title="复制日志" onClick={handleCopyLogs}>
            <Icon name="copy" />
          </div>
          <div className="term-action-btn" title="清空面板" onClick={handleClearLogs}>
            <Icon name="trash" />
          </div>
        </div>
      </div>
      <div className="term-body" ref={termRef}>
        {logs.length === 0 ? <span className="log-info">{'> Ready to deploy...'}</span> : null}
        {logs.map((line, i) => (
          <div key={i} className="log-line">
            {line}
          </div>
        ))}
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
        <button className="btn btn-primary" onClick={() => setTriggerOpen(true)} disabled={deploying}>
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
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, height: '100%', minHeight: 0 }}>{renderTerminal(false)}</div>
      </div>

      {terminalFull ? (
        <div className="terminal-overlay" onClick={() => setTerminalFull(false)}>
          <div onClick={(ev) => ev.stopPropagation()}>{renderTerminal(true)}</div>
        </div>
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
    </div>
  )
}
