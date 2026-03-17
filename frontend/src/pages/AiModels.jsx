import { useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { api } from '../services/api.js'
import { toast } from '../services/toast.js'
import Modal from '../components/Modal.jsx'

const emptyForm = {
  id: null,
  name: '',
  model: '',
  base_url: '',
  api_key: '',
  system_prompt: '',
  temperature: 0.2,
  max_history: 10,
  is_active: false,
  has_key: false
}

export default function AiModels() {
  const API_KEY_MASK = '••••••••••••••••'
  const [models, setModels] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const selected = useMemo(() => (models || []).find((m) => m?.id === selectedId) || null, [models, selectedId])

  const load = async (pickId) => {
    setLoading(true)
    try {
      const res = await api.get('/api/admin/ai/models')
      const rows = Array.isArray(res) ? res : []
      setModels(rows)
      const nextPick = pickId || (rows.find((x) => x?.is_active)?.id || rows[0]?.id || null)
      if (nextPick) {
        const m = rows.find((x) => x?.id === nextPick) || null
        if (m) {
          setSelectedId(m.id)
          setForm({
            id: m.id,
            name: String(m.name || ''),
            model: String(m.model || ''),
            base_url: String(m.base_url || ''),
              api_key: m.has_key ? API_KEY_MASK : '',
            system_prompt: String(m.system_prompt || ''),
            temperature: Number.isFinite(Number(m.temperature)) ? Number(m.temperature) : 0.2,
            max_history: Number.isFinite(Number(m.max_history)) ? Number(m.max_history) : 10,
            is_active: !!m.is_active,
            has_key: !!m.has_key
          })
            setShowApiKey(false)
        } else {
          setSelectedId(null)
          setForm(emptyForm)
        }
      } else {
        setSelectedId(null)
        setForm(emptyForm)
      }
    } catch (e) {
      toast.error(e?.message || '加载失败')
      setModels([])
      setSelectedId(null)
      setForm(emptyForm)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(null)
  }, [])

  const pick = (m) => {
    if (!m?.id) return
    setSelectedId(m.id)
    setForm({
      id: m.id,
      name: String(m.name || ''),
      model: String(m.model || ''),
      base_url: String(m.base_url || ''),
      api_key: m.has_key ? API_KEY_MASK : '',
      system_prompt: String(m.system_prompt || ''),
      temperature: Number.isFinite(Number(m.temperature)) ? Number(m.temperature) : 0.2,
      max_history: Number.isFinite(Number(m.max_history)) ? Number(m.max_history) : 10,
      is_active: !!m.is_active,
      has_key: !!m.has_key
    })
    setShowApiKey(false)
  }

  const addNew = () => {
    setSelectedId(null)
    setForm({ ...emptyForm, temperature: 0.2, max_history: 10 })
    setShowApiKey(false)
  }

  const validate = () => {
    const name = String(form.name || '').trim()
    const model = String(form.model || '').trim()
    const base = String(form.base_url || '').trim()
    if (!name) return '请输入模型名称'
    if (!model) return '请输入模型 ID'
    if (!base) return '请输入 Base URL'
    const t = Number(form.temperature)
    if (!Number.isFinite(t) || t < 0 || t > 2) return 'Temperature 需在 0.0~2.0'
    const mh = Number(form.max_history)
    if (!Number.isFinite(mh) || mh < 1 || mh > 50) return '最大上下文轮数需在 1~50'
    return null
  }

  const testConn = async () => {
    const err = validate()
    if (err) return toast.error(err)
    const key = String(form.api_key || '').trim()
    if (!key || key === API_KEY_MASK) return toast.error('请先填写 API Key（用于测试）')
    setTesting(true)
    try {
      const res = await api.post('/api/admin/ai/models/test', {
        name: String(form.name || '').trim(),
        model: String(form.model || '').trim(),
        base_url: String(form.base_url || '').trim(),
        api_key: key,
        system_prompt: String(form.system_prompt || ''),
        temperature: Number(form.temperature),
        max_history: Number(form.max_history)
      })
      if (res?.ok) toast.success('连接成功')
      else toast.error('连接失败')
    } catch (e) {
      toast.error(e?.message || '连接失败')
    } finally {
      setTesting(false)
    }
  }

  const save = async (activate) => {
    const err = validate()
    if (err) return toast.error(err)
    setSaving(true)
    try {
      const apiKey = String(form.api_key || '')
      const apiKeyTrim = apiKey.trim()
      const payload = {
        name: String(form.name || '').trim(),
        model: String(form.model || '').trim(),
        base_url: String(form.base_url || '').trim(),
        api_key: form.has_key && (!apiKeyTrim || apiKeyTrim === API_KEY_MASK) ? '' : apiKey,
        system_prompt: String(form.system_prompt || ''),
        temperature: Number(form.temperature),
        max_history: Number(form.max_history)
      }
      let res = null
      if (form.id) {
        res = await api.put(`/api/admin/ai/models/${encodeURIComponent(form.id)}?activate=${activate ? '1' : '0'}`, payload)
      } else {
        res = await api.post(`/api/admin/ai/models?activate=${activate ? '1' : '0'}`, payload)
      }
      if (!res?.id) throw new Error('保存失败')
      toast.success(activate ? '已保存并启用' : '已保存')
      await load(String(res.id))
    } catch (e) {
      toast.error(e?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!form.id) return
    if (form.is_active) return toast.error('生效中的模型不可删除')
    setSaving(true)
    try {
      const res = await api.del(`/api/admin/ai/models/${encodeURIComponent(form.id)}`)
      if (!res?.ok) throw new Error(res?.detail || '删除失败')
      toast.success('已删除')
      await load(null)
    } catch (e) {
      toast.error(e?.message || '删除失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="panel-canvas">
      <div className="panel-frame">
        <div className="page-head" style={{ marginBottom: 10 }}>
          <div className="page-head-left">
            <div className="page-title-row">
              <h2 className="page-title">AI 助手配置</h2>
            </div>
            <div style={{ color: 'var(--text-sub)', fontSize: 13, lineHeight: 1.45 }}>
              配置平台默认使用的对话模型；普通用户只使用右下角 Copilot。
            </div>
          </div>
          <div className="page-actions">
            <button className="btn btn-outline" type="button" onClick={addNew}>
              <Icon name="plus" />
              添加新模型
            </button>
          </div>
        </div>

        <div className="ai-config-grid">
          <div className="ai-model-list card">
            <div className="ai-model-list-head">
              <div style={{ fontWeight: 900 }}>模型列表</div>
              <div style={{ color: 'var(--text-sub)', fontSize: 12 }}>{loading ? '加载中…' : `${(models || []).length} 个`}</div>
            </div>
            <div className="ai-model-list-body">
              {(models || []).length ? null : <div className="empty-state">暂无模型配置</div>}
              {(models || []).map((m) => (
                <div key={m.id} className={`ai-model-item ${m.id === selectedId ? 'active' : ''}`} onClick={() => pick(m)}>
                  <div className="ai-model-item-top">
                    <div className="ai-model-name">{m.name || '-'}</div>
                    {m.is_active ? <span className="ai-badge ai-badge-on">生效中</span> : <span className="ai-badge">未启用</span>}
                  </div>
                  <div className="ai-model-meta">
                    <span className="ai-mono">{m.model || '-'}</span>
                    <span className="ai-dot" />
                    <span className="ai-truncate">{m.base_url || '-'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="ai-model-form card">
            <div className="ai-model-form-head">
              <div style={{ fontWeight: 900 }}>{form.id ? '编辑模型' : '新增模型'}</div>
              {selected?.is_active ? <span className="ai-badge ai-badge-on">当前生效</span> : null}
            </div>
            <div className="ai-model-form-body">
              <div className="ai-form-section">
                <div className="ai-form-section-title">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Icon name="plug" /> 基础与连接配置
                  </span>
                </div>

                <div className="form-item">
                  <label className="form-label">模型名称</label>
                  <input className="form-input" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="例如 NexusOps Copilot" />
                </div>

                <div className="ai-form-grid-mid">
                  <div className="form-item" style={{ marginBottom: 0 }}>
                    <label className="form-label">模型 ID</label>
                    <input className="form-input" value={form.model} onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))} placeholder="deepseek-chat / gpt-4o-mini" />
                  </div>
                  <div className="form-item" style={{ marginBottom: 0 }}>
                    <label className="form-label">API 地址 (Base URL)</label>
                    <input className="form-input" value={form.base_url} onChange={(e) => setForm((p) => ({ ...p, base_url: e.target.value }))} placeholder="https://api.deepseek.com 或 https://xxx/v1" />
                  </div>
                </div>

                <div className="form-item" style={{ marginTop: 14 }}>
                  <label className="form-label">API Key</label>
                  <div className="input-wrap">
                    <input
                      className="form-input"
                      type={showApiKey ? 'text' : 'password'}
                      value={form.api_key}
                      onFocus={() => {
                        if (form.has_key && String(form.api_key || '') === API_KEY_MASK) setForm((p) => ({ ...p, api_key: '' }))
                      }}
                      onChange={(e) => setForm((p) => ({ ...p, api_key: e.target.value, has_key: true }))}
                      placeholder={form.has_key ? '已配置（留空不变，输入新值覆盖）' : '请输入 API Key'}
                    />
                    <div className="input-toggle" onClick={() => setShowApiKey((v) => !v)}>
                      <Icon name={showApiKey ? 'eye-slash' : 'eye'} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="ai-form-section">
                <div className="ai-form-section-title">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Icon name="brain" /> 模型行为与设定
                  </span>
                </div>

                <div className="form-item">
                  <label className="form-label">系统提示词 (System Prompt)</label>
                  <textarea
                    className="form-input ai-prompt-textarea"
                    value={form.system_prompt}
                    onChange={(e) => setForm((p) => ({ ...p, system_prompt: e.target.value }))}
                    placeholder="例如：你是一个高级运维专家，请优先使用 Markdown 输出 Shell 命令"
                  />
                </div>

                <div className="ai-form-grid-behavior">
                  <div className="form-item" style={{ marginBottom: 0 }}>
                    <label className="form-label">模型温度 (Temperature)</label>
                    <div className="ai-slider-row">
                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.1"
                        value={String(form.temperature)}
                        onChange={(e) => setForm((p) => ({ ...p, temperature: Number(e.target.value) }))}
                        className="ai-slider"
                      />
                      <div className="ai-slider-val">{Number(form.temperature).toFixed(1)}</div>
                    </div>
                    <div className="ai-hint">值越小回答越严谨，适合运维场景</div>
                  </div>

                  <div className="form-item" style={{ marginBottom: 0 }}>
                    <label className="form-label">最大上下文轮数</label>
                    <input
                      className="form-input"
                      type="number"
                      min={1}
                      max={50}
                      value={String(form.max_history)}
                      onChange={(e) => setForm((p) => ({ ...p, max_history: Number(e.target.value) }))}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="ai-model-form-actions">
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-outline" type="button" onClick={testConn} disabled={testing || saving}>
                  <Icon name={testing ? 'spinner fa-spin' : 'plug'} />
                  连通性测试
                </button>
                {form.id ? (
                  <button
                    className="btn btn-danger"
                    type="button"
                    onClick={() => setDeleteOpen(true)}
                    disabled={saving || testing || form.is_active}
                  >
                    <Icon name="trash" />
                    删除
                  </button>
                ) : null}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-outline" type="button" onClick={() => save(false)} disabled={saving || testing}>
                  保存
                </button>
                <button className="btn btn-primary" type="button" onClick={() => save(true)} disabled={saving || testing}>
                  保存并启用
                </button>
              </div>
            </div>
          </div>
        </div>

        {deleteOpen ? (
          <Modal
            danger
            title="确认删除该模型？"
            onClose={() => setDeleteOpen(false)}
            footer={[
              <button key="c" className="btn btn-outline" onClick={() => setDeleteOpen(false)}>
                取消
              </button>,
              <button
                key="ok"
                className="btn btn-danger"
                onClick={async () => {
                  setDeleteOpen(false)
                  await remove()
                }}
                disabled={saving || testing}
              >
                删除
              </button>
            ]}
          >
            <div style={{ color: 'var(--text-sub)', fontSize: 13, lineHeight: 1.6 }}>
              删除后将无法恢复。
            </div>
          </Modal>
        ) : null}
      </div>
    </div>
  )
}
