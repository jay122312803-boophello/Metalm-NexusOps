import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { api } from '../services/api.js'

const fmtPct = (v) => {
  if (v === null || v === undefined) return '-'
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  return `${(n * 100).toFixed(1)}%`
}

const monotonePath = (pts) => {
  if (!pts || pts.length === 0) return ''
  if (pts.length === 1) return `M ${Number(pts[0].x).toFixed(2)} ${Number(pts[0].y).toFixed(2)}`

  const p = pts.map((x) => ({ x: Number(x.x), y: Number(x.y) }))
  const n = p.length
  const d = new Array(n - 1)
  for (let i = 0; i < n - 1; i++) {
    const dx = p[i + 1].x - p[i].x
    d[i] = dx === 0 ? 0 : (p[i + 1].y - p[i].y) / dx
  }

  const m = new Array(n)
  m[0] = d[0]
  m[n - 1] = d[n - 2]
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] === 0 || d[i] === 0 || d[i - 1] * d[i] < 0) m[i] = 0
    else m[i] = (d[i - 1] + d[i]) / 2
  }

  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i] / d[i]
    const b = m[i + 1] / d[i]
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[i] = t * a * d[i]
      m[i + 1] = t * b * d[i]
    }
  }

  let path = `M ${p[0].x.toFixed(2)} ${p[0].y.toFixed(2)}`
  for (let i = 0; i < n - 1; i++) {
    const dx = p[i + 1].x - p[i].x
    const c1x = p[i].x + dx / 3
    const c1y = p[i].y + (m[i] * dx) / 3
    const c2x = p[i + 1].x - dx / 3
    const c2y = p[i + 1].y - (m[i + 1] * dx) / 3
    path += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p[i + 1].x.toFixed(2)} ${p[i + 1].y.toFixed(2)}`
  }
  return path
}

const statusDotClass = (status) => {
  const s = String(status || '').toLowerCase()
  if (s === 'running' || s === 'pending') return 'busy'
  if (s === 'success') return 'online'
  if (s === 'failed') return 'offline'
  if (s === 'canceled') return 'canceled'
  return 'idle'
}

const dayLabel = (isoDate) => {
  const s = String(isoDate || '')
  if (!s) return ''
  return s.slice(5).replace('-', '/')
}

const fullDateLabel = (isoDate) => {
  const s = String(isoDate || '')
  if (!s) return ''
  return s.slice(0, 10).replaceAll('-', '/')
}

const niceStep = (maxVal) => {
  const m = Math.max(1, Math.ceil(Number(maxVal) || 1))
  if (m <= 5) return 1
  if (m <= 10) return 2
  if (m <= 25) return 5
  if (m <= 50) return 10
  if (m <= 100) return 20
  return 50
}

function TrendChart({ data, onNavigate }) {
  const height = 220
  const padLeft = 54
  const padRight = 24
  const padTop = 16
  const padBottom = 44
  const w = 1000
  const h = height
  const wrapRef = useRef(null)
  const tooltipRef = useRef(null)
  const hideTimerRef = useRef(null)
  const [hover, setHover] = useState(null)
  const [tipSize, setTipSize] = useState({ w: 0, h: 0 })

  const series = useMemo(() => {
    const arr = Array.isArray(data) ? data : []
    const pts = arr.map((d) => ({
      date: d.date,
      success: Number(d.success || 0),
      failed: Number(d.failed || 0),
      total: Number(d.total || 0)
    }))
    const maxRaw = Math.max(1, ...pts.flatMap((p) => [p.success, p.failed]))
    const stepY = niceStep(maxRaw)
    const max = Math.ceil(maxRaw / stepY) * stepY
    const ticks = []
    for (let v = 0; v <= max; v += stepY) ticks.push(v)
    const failMax = Math.max(0, ...pts.map((p) => p.failed))
    const n = Math.max(1, pts.length)
    const step = (w - padLeft - padRight) / (n - 1 || 1)
    const toY = (v) => padTop + (h - padTop - padBottom) * (1 - v / max)
    const toX = (i) => padLeft + step * i
    const sucPts = pts.map((p, i) => ({ x: toX(i), y: toY(p.success), date: p.date, v: p.success, total: p.total }))
    const failPts = pts.map((p, i) => ({ x: toX(i), y: toY(p.failed), date: p.date, v: p.failed, total: p.total }))
    const baseY = h - padBottom
    const sucD = monotonePath(sucPts)
    const failD = monotonePath(failPts)
    const area = (d, a) => {
      if (!a.length) return ''
      const first = a[0]
      const last = a[a.length - 1]
      return `M ${first.x.toFixed(2)} ${baseY.toFixed(2)} L ${first.x.toFixed(2)} ${first.y.toFixed(2)} ${d.slice(1)} L ${last.x.toFixed(2)} ${baseY.toFixed(2)} Z`
    }
    return {
      pts,
      max,
      ticks,
      failMax,
      toX,
      toY,
      sucPts,
      failPts,
      baseY,
      sucD,
      failD,
      sucArea: area(sucD, sucPts),
      failArea: area(failD, failPts)
    }
  }, [data])

  const setHoverFromEvent = (ev, i) => {
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const suc = series.sucPts[i]
    const fail = series.failPts[i]
    const x = Math.max(0, Math.min(rect.width, (Number(suc?.x || 0) / w) * rect.width))
    const y = Math.max(0, Math.min(rect.height, (Math.min(Number(suc?.y || 0), Number(fail?.y || 0)) / h) * rect.height))
    const ySvg = Math.max(0, Math.min(h, ((ev.clientY - rect.top) / rect.height) * h))
    const kind =
      series.failMax <= 0
        ? 'success'
        : Math.abs(ySvg - Number(suc?.y || 0)) <= Math.abs(ySvg - Number(fail?.y || 0))
          ? 'success'
          : 'failed'
    setHover({
      i,
      x,
      y,
      rectW: rect.width,
      rectH: rect.height,
      kind,
      date: suc?.date,
      success: suc?.v ?? 0,
      failed: fail?.v ?? 0,
      total: suc?.total ?? 0,
      sx: suc?.x ?? 0,
      sy: suc?.y ?? 0,
      fx: fail?.x ?? 0,
      fy: fail?.y ?? 0
    })
  }

  const clearHover = () => setHover(null)

  useEffect(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    if (!hover) return
    hideTimerRef.current = setTimeout(() => setHover(null), 10000)
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [hover?.i])

  useEffect(() => {
    if (!hover) return
    const el = tooltipRef.current
    if (!el) return
    const next = { w: el.offsetWidth || 0, h: el.offsetHeight || 0 }
    setTipSize((p) => (p.w === next.w && p.h === next.h ? p : next))
  }, [hover?.i, hover?.date])

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontWeight: 800, color: 'var(--text-main)' }}>近 7 天部署趋势</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12, color: 'var(--text-sub)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span className="legend-dot" style={{ background: 'var(--success)' }} /> 成功
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span className="legend-dot" style={{ background: 'var(--danger)' }} /> 失败
          </span>
        </div>
      </div>

      <div className="trend-wrap" ref={wrapRef} onMouseLeave={clearHover}>
        {hover ? (() => {
          const margin = 10
          const halfW = (tipSize.w || 0) / 2
          const left = Math.max(margin + halfW, Math.min((hover.rectW || 0) - margin - halfW, hover.x))
          const preferAbove = hover.y - (tipSize.h || 0) - 14 > 0
          const top = preferAbove ? hover.y - 12 : hover.y + 14
          const transform = preferAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 0)'
          return (
          <div
            className="chart-tooltip"
            ref={tooltipRef}
            style={{
              left,
              top,
              transform
            }}
          >
            <div className="chart-tooltip-title">{fullDateLabel(hover.date)}</div>
            <div className="chart-tooltip-row">
              <span className="legend-dot" style={{ background: 'var(--success)' }} /> 成功
              <span className="chart-tooltip-val">{hover.success} 次</span>
            </div>
            <div className="chart-tooltip-row">
              <span className="legend-dot" style={{ background: 'var(--danger)' }} /> 失败
              <span className="chart-tooltip-val">{hover.failed} 次</span>
            </div>
            <div className="chart-tooltip-row" style={{ opacity: 0.78 }}>
              <span className="legend-dot" style={{ background: 'rgba(148,163,184,0.9)' }} /> 总计
              <span className="chart-tooltip-val">{hover.total} 次</span>
            </div>
          </div>
          )
        })() : null}

        <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={height} style={{ display: 'block' }}>
          <defs>
            <linearGradient id="gradSuccess" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="rgba(16,185,129,0.22)" />
              <stop offset="1" stopColor="rgba(16,185,129,0.02)" />
            </linearGradient>
            <linearGradient id="gradFailed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="rgba(239,68,68,0.18)" />
              <stop offset="1" stopColor="rgba(239,68,68,0.02)" />
            </linearGradient>
          </defs>

          <text x={padLeft} y={12} fontSize="16" fill="rgba(100,116,139,0.82)" fontWeight="650">
            部署次数（次）
          </text>
          {series.ticks.map((t) => (
            <g key={t}>
              <line
                x1={padLeft}
                y1={series.toY(t)}
                x2={w - padRight}
                y2={series.toY(t)}
                stroke="rgba(148,163,184,0.18)"
                strokeWidth="1"
              />
              <text x={padLeft - 10} y={series.toY(t) + 4} textAnchor="end" fontSize="18" fill="rgba(148,163,184,0.92)">
                {t}
              </text>
            </g>
          ))}
          <line x1={padLeft} y1={series.baseY} x2={w - padRight} y2={series.baseY} stroke="rgba(148,163,184,0.30)" strokeWidth="1" />
          {hover ? (
            <line
              x1={series.sucPts[hover.i]?.x}
              y1={padTop}
              x2={series.sucPts[hover.i]?.x}
              y2={series.baseY}
              stroke="rgba(148,163,184,0.32)"
              strokeWidth="1"
              strokeDasharray="4 6"
            />
          ) : null}
          <path d={series.sucArea} fill="url(#gradSuccess)" />
          {series.failMax > 0 ? <path d={series.failArea} fill="url(#gradFailed)" /> : null}
          <path d={series.sucD} fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {series.failMax > 0 ? (
            <path d={series.failD} fill="none" stroke="var(--danger)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
          ) : null}

          {series.sucPts.map((p, i) => {
            const isFirst = i === 0
            const isLast = i === series.sucPts.length - 1
            const anchor = isFirst ? 'start' : isLast ? 'end' : 'middle'
            const dx = isFirst ? 6 : isLast ? -6 : 0
            const active = hover?.i === i
            return (
              <g key={p.date || i}>
                <rect
                  x={i === 0 ? 0 : (series.sucPts[i - 1].x + p.x) / 2}
                  y={0}
                  width={i === series.sucPts.length - 1 ? w : (series.sucPts[i + 1]?.x + p.x) / 2 - (i === 0 ? 0 : (series.sucPts[i - 1].x + p.x) / 2)}
                  height={h}
                  fill="transparent"
                  onMouseEnter={(ev) => setHoverFromEvent(ev, i)}
                  onMouseMove={(ev) => setHoverFromEvent(ev, i)}
                  onClick={(ev) => {
                    if (!onNavigate) return
                    const el = wrapRef.current
                    if (!el) return
                    const rect = el.getBoundingClientRect()
                    const suc = series.sucPts[i]
                    const fail = series.failPts[i]
                    const ySvg = Math.max(0, Math.min(h, ((ev.clientY - rect.top) / rect.height) * h))
                    const kind =
                      series.failMax <= 0
                        ? 'success'
                        : Math.abs(ySvg - Number(suc?.y || 0)) <= Math.abs(ySvg - Number(fail?.y || 0))
                          ? 'success'
                          : 'failed'
                    const st = kind === 'failed' ? 'failed' : 'success'
                    if (p.date) onNavigate('history', null, { date: p.date, status: st })
                  }}
                />
                <circle cx={p.x} cy={p.y} r={active ? 4.5 : 3.5} fill="var(--success)" opacity={active || p.v > 0 ? 1 : 0} />
                {series.failMax > 0 ? (
                  <circle
                    cx={series.failPts[i]?.x}
                    cy={series.failPts[i]?.y}
                    r={active ? 4.5 : 3.5}
                    fill="var(--danger)"
                    opacity={active || (series.failPts[i]?.v || 0) > 0 ? 0.9 : 0}
                  />
                ) : null}
                {active ? <circle cx={p.x} cy={p.y} r="9" fill="rgba(16,185,129,0.10)" /> : null}
                {active && series.failMax > 0 ? <circle cx={series.failPts[i]?.x} cy={series.failPts[i]?.y} r="10" fill="rgba(239,68,68,0.10)" /> : null}
                <text x={p.x + dx} y={h - 12} textAnchor={anchor} fontSize="18" fill="rgba(148,163,184,0.92)">
                  {dayLabel(p.date)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

function Donut({ data }) {
  const size = 220
  const r = 78
  const cx = size / 2
  const cy = size / 2
  const c = 2 * Math.PI * r
  const items = Array.isArray(data) ? data : []
  const total = Math.max(1, items.reduce((a, x) => a + Number(x.count || 0), 0))
  const colors = {
    PROD: 'var(--danger)',
    TEST: 'var(--info)',
    DEV: 'var(--success)',
    OTHER: 'rgba(148,163,184,0.8)'
  }

  let off = 0
  const segs = items.map((it) => {
    const v = Number(it.count || 0)
    const frac = v / total
    const len = c * frac
    const dash = `${len} ${c - len}`
    const stroke = colors[it.key] || colors.OTHER
    const seg = { key: it.key, v, dash, stroke, off }
    off += len
    return seg
  })

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ fontWeight: 800, color: 'var(--text-main)', marginBottom: 10 }}>环境分布</div>
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 14, alignItems: 'center' }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(148,163,184,0.22)" strokeWidth="10" />
          {segs.map((s) => (
            <circle
              key={s.key}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={s.stroke}
              strokeWidth="10"
              strokeDasharray={s.dash}
              strokeDashoffset={-s.off}
              strokeLinecap="butt"
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          ))}
          <text x={cx} y={cy - 4} textAnchor="middle" fontSize="22" fill="rgba(15,23,42,0.92)" fontWeight="800">
            {items.reduce((a, x) => a + Number(x.count || 0), 0)}
          </text>
          <text x={cx} y={cy + 18} textAnchor="middle" fontSize="12" fill="rgba(100,116,139,0.95)">
            Servers
          </text>
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.length ? (
            items.map((it) => (
              <div key={it.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--text-main)', fontWeight: 600 }}>
                  <span className="legend-dot" style={{ background: colors[it.key] || colors.OTHER }} />
                  {it.key}
                </div>
                <div
                  style={{
                    width: 44,
                    textAlign: 'right',
                    color: 'var(--text-sub)',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
                  }}
                >
                  {it.count}
                </div>
              </div>
            ))
          ) : (
            <div style={{ color: 'var(--text-sub)' }}>暂无数据</div>
          )}
        </div>
      </div>
    </div>
  )
}

function MetricCard({ title, value, sub, icon, tone, onClick }) {
  const clickable = typeof onClick === 'function'
  return (
    <div
      className="card metric-card"
      style={{ cursor: clickable ? 'pointer' : 'default' }}
      onClick={clickable ? onClick : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ color: 'var(--text-sub)', fontSize: 13 }}>{title}</div>
          <div className={`metric-value ${tone || ''}`}>{value}</div>
          {sub ? <div style={{ color: 'var(--text-sub)', fontSize: 12 }}>{sub}</div> : null}
        </div>
        <div className="metric-icon">
          <Icon name={icon} />
        </div>
      </div>
    </div>
  )
}

export default function Overview({ onNavigate }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    const res = await api.get('/api/overview')
    if (res?.ok) setData(res)
    setLoading(false)
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [])

  const m = data?.metrics || {}
  const trend = Array.isArray(data?.trend_7d) ? data.trend_7d : []
  const env = Array.isArray(data?.env_dist) ? data.env_dist : []
  const feed = Array.isArray(data?.feed) ? data.feed : []

  const succTone =
    m?.success_rate_today === null || m?.success_rate_today === undefined
      ? 'ok'
      : Number(m.success_rate_today) < 0.6
        ? 'bad'
        : Number(m.success_rate_today) < 0.9
          ? 'warn'
          : 'ok'

  const deltaView = useMemo(() => {
    const d = Number(m?.deploy_delta)
    if (!Number.isFinite(d)) return null
    if (d === 0) return { icon: 'minus', text: '环比 0', color: 'rgba(100,116,139,0.95)' }
    if (d > 0) return { icon: 'arrow-trend-up', text: `环比 +${d}`, color: 'var(--success)' }
    return { icon: 'arrow-trend-down', text: `环比 ${d}`, color: 'var(--danger)' }
  }, [m?.deploy_delta])

  return (
    <div>
      <div className="overview-grid">
        <div className="overview-metrics">
          <MetricCard
            title="今日部署次数"
            value={loading ? '-' : String(m?.deploy_today ?? '-')}
            sub={
              loading || !deltaView ? (
                ''
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: deltaView.color, fontWeight: 600 }}>
                  <Icon name={deltaView.icon} /> {deltaView.text}
                </span>
              )
            }
            icon="rocket"
            tone="ok"
          />
          <MetricCard title="部署成功率" value={loading ? '-' : fmtPct(m?.success_rate_today)} sub="今日" icon="bullseye" tone={succTone} />
          <MetricCard
            title="服务器在线率"
            value={
              loading ? (
                '-'
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
                  <span>{m?.servers_online ?? 0}</span>
                  <span style={{ color: 'rgba(148,163,184,0.95)', fontWeight: 700, fontSize: 14 }}>{`/ ${m?.servers_total ?? 0}`}</span>
                </span>
              )
            }
            sub="点击进入服务器管理"
            icon="server"
            tone="ok"
            onClick={() => (onNavigate ? onNavigate('settings') : null)}
          />
          <MetricCard
            title="纳管代码仓库"
            value={loading ? '-' : String(m?.repos_total ?? 0)}
            sub="点击进入仓库配置"
            icon="code-branch"
            tone="ok"
            onClick={() => (onNavigate ? onNavigate('settings', null, { tab: 'repos' }) : null)}
          />
        </div>

        <div className="overview-charts">
          <TrendChart data={trend} onNavigate={onNavigate} />
          <Donut data={env} />
        </div>

        <div className="overview-bottom">
          <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontWeight: 800, color: 'var(--text-main)' }}>实时部署动态</div>
              <button className="btn btn-ghost btn-sm" onClick={() => (onNavigate ? onNavigate('history') : null)}>
                查看全部 <Icon name="arrow-right" />
              </button>
            </div>
            <div className="feed-list">
              {feed.length ? (
                feed.slice(0, 12).map((it) => (
                  <div key={it.id} className="feed-item" onClick={() => (onNavigate ? onNavigate('detail', it.deployment_id, { historyId: it.id }) : null)}>
                    <span className={`status-dot ${statusDotClass(it.status)}`} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ color: 'var(--text-main)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {it.deployment_name || '部署任务'}
                        </div>
                        <div style={{ color: 'var(--text-sub)', fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                          {it.created_at ? new Date(it.created_at).toLocaleTimeString() : ''}
                        </div>
                      </div>
                      <div style={{ color: 'var(--text-sub)', fontSize: 12, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {`${it.repo_name || '-'}${it.branch ? ` · ${it.branch}` : ''} → ${it.server_name || '-'}`}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ color: 'var(--text-sub)', padding: 10 }}>暂无动态</div>
              )}
            </div>
          </div>

          <div className="card" style={{ padding: 18 }}>
            <div style={{ fontWeight: 800, color: 'var(--text-main)', marginBottom: 10 }}>快捷入口</div>
            <div className="quick-actions">
              <button className="btn btn-primary" onClick={() => (onNavigate ? onNavigate('dashboard') : null)}>
                <Icon name="plus" /> 创建新任务
              </button>
              <button className="btn btn-outline" onClick={() => (onNavigate ? onNavigate('settings') : null)}>
                <Icon name="server" /> 接入新主机
              </button>
              <button className="btn btn-outline" onClick={() => (onNavigate ? onNavigate('settings', null, { tab: 'repos' }) : null)}>
                <Icon name="code-branch" /> 管理 Git 仓库
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
