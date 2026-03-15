import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { api } from '../services/api.js'
import Tooltip from '../components/Tooltip.jsx'

const overviewCacheKey = 'nexusops_overview_cache_v1'
const runtimeCacheKey = 'nexusops_overview_runtime_v1'
const containersCacheKey = 'nexusops_overview_containers_v2'
const serverMetricsCacheKey = 'nexusops_overview_server_metrics_v1'

const fmtPct = (v) => {
  if (v === null || v === undefined) return '-'
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  return `${(n * 100).toFixed(1)}%`
}

const clampPct100 = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, n))
}

const parsePct = (v) => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (!s) return null
  const n = Number(s.endsWith('%') ? s.slice(0, -1) : s)
  if (!Number.isFinite(n)) return null
  return clampPct100(n)
}

const fmtBytesShort = (bytes) => {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return '-'
  const tb = 1024 ** 4
  const gb = 1024 ** 3
  const mb = 1024 ** 2
  if (n >= tb) return `${(n / tb).toFixed(1)}TB`
  if (n >= gb) return `${(n / gb).toFixed(1)}GB`
  return `${Math.max(0, Math.round(n / mb))}MB`
}

const memToBytes = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  if (n > 200000) return n * 1024
  return n * 1024 * 1024
}

const dfKiBToBytes = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  return n * 1024
}

const mapLimit = async (items, limit, fn) => {
  const arr = Array.isArray(items) ? items : []
  const lim = Math.max(1, Number(limit || 1))
  const out = new Array(arr.length)
  let i = 0
  const workers = new Array(Math.min(lim, arr.length)).fill(0).map(async () => {
    while (i < arr.length) {
      const cur = i++
      try {
        out[cur] = await fn(arr[cur], cur)
      } catch (e) {
        out[cur] = { ok: false, error: e }
      }
    }
  })
  await Promise.all(workers)
  return out
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

function MetricCard({ title, value, sub, icon, tone, onClick, tooltip }) {
  const clickable = typeof onClick === 'function'
  const card = (
    <div
      className="card metric-card"
      style={{ cursor: clickable ? 'pointer' : 'default' }}
      onClick={clickable ? onClick : undefined}
    >
      <div className="metric-head">
        <div className="metric-title">{title}</div>
        <div className="metric-icon">
          <Icon name={icon} />
        </div>
      </div>
      <div className={`metric-value ${tone || ''}`}>{value}</div>
      {typeof sub === 'string' ? <div className="metric-subtext">{sub}</div> : sub ? <div className="metric-subtext">{sub}</div> : null}
    </div>
  )
  if (tooltip) return <Tooltip content={tooltip} block>{card}</Tooltip>
  return card
}

function RingGauge({ label, percent, value, tone, tip }) {
  const p = clampPct100(percent)
  const color =
    tone === 'bad' ? 'var(--danger)' : tone === 'warn' ? 'var(--warning)' : tone === 'info' ? 'var(--info)' : 'var(--primary)'
  const g = (
    <div className="metric-ring sm">
      <div className="metric-ring-circle" style={{ background: `conic-gradient(${color} ${p}%, rgba(148,163,184,0.18) 0)` }}>
        <div className="metric-ring-inner">
          <div className="metric-ring-value">{value}</div>
          <div className="metric-ring-sub">{label}</div>
        </div>
      </div>
    </div>
  )
  if (tip) return <Tooltip content={tip}>{g}</Tooltip>
  return g
}

function ResourceWatermark({ loading, cpu, mem, disk, ts, sampled, total, envText, servers, focusId, onFocus, cpuTip, memTip, diskTip }) {
  const cpuTone = cpu >= 90 ? 'bad' : cpu >= 70 ? 'warn' : 'ok'
  const memTone = mem >= 90 ? 'bad' : mem >= 70 ? 'warn' : 'ok'
  const diskTone = (d) => (d >= 90 ? 'bad' : d >= 70 ? 'warn' : 'ok')
  return (
    <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ fontWeight: 800, color: 'var(--text-main)' }}>全局资源水位</div>
        <div style={{ color: 'var(--text-sub)', fontSize: 12 }}>
          {loading ? '加载中...' : ts ? `更新于 ${new Date(ts).toLocaleTimeString()}` : '未更新'}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, color: 'var(--text-sub)', fontSize: 12 }}>
        <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{envText || ''}</div>
        <div style={{ whiteSpace: 'nowrap' }}>{total ? `采样 ${sampled ?? 0}/${total}` : ''}</div>
      </div>
      <div style={{ display: 'flex', gap: 14, justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <RingGauge label="CPU" percent={cpu} value={`${clampPct100(cpu).toFixed(1)}%`} tone={cpuTone} tip={cpuTip} />
        </div>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <RingGauge label="内存" percent={mem} value={`${clampPct100(mem).toFixed(1)}%`} tone={memTone} tip={memTip} />
        </div>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <RingGauge
            label="磁盘"
            percent={disk ?? 0}
            value={disk === null || disk === undefined ? '-' : `${clampPct100(disk).toFixed(1)}%`}
            tone={disk === null || disk === undefined ? 'ok' : diskTone(disk)}
            tip={diskTip}
          />
        </div>
      </div>
      {Array.isArray(servers) && servers.length ? (
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--text-main)' }}>资源开销（点选巡检）</div>
            <div style={{ color: 'var(--text-sub)', fontSize: 12 }}>{focusId ? '当前节点' : ''}</div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {servers.map((s) => (
              <Tooltip key={s.id} content={s.address || s.name}>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  style={{
                    borderRadius: 999,
                    padding: '4px 10px',
                    borderColor: s.id === focusId ? 'rgba(22,163,74,0.45)' : 'var(--border)',
                    background: s.id === focusId ? 'rgba(16,185,129,0.10)' : 'white',
                    color: s.id === focusId ? 'var(--primary)' : 'var(--text-main)'
                  }}
                  onClick={() => (typeof onFocus === 'function' ? onFocus(s.id) : null)}
                >
                  {s.name}
                </button>
              </Tooltip>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default function Overview({ onNavigate }) {
  const [data, setData] = useState(() => {
    try {
      const raw = localStorage.getItem(overviewCacheKey)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : null
    } catch (_) {
      return null
    }
  })
  const [loading, setLoading] = useState(() => {
    try {
      return !localStorage.getItem(overviewCacheKey)
    } catch (_) {
      return true
    }
  })
  const [servers, setServers] = useState([])
  const [deployments, setDeployments] = useState([])
  const [focusServerId, setFocusServerId] = useState(null)
  const [focusDeploymentId, setFocusDeploymentId] = useState(null)
  const [serverMetricsById, setServerMetricsById] = useState(() => {
    try {
      const raw = localStorage.getItem(serverMetricsCacheKey)
      if (!raw) return {}
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (_) {
      return {}
    }
  })
  const [runtime, setRuntime] = useState(() => {
    try {
      const raw = localStorage.getItem(runtimeCacheKey)
      if (!raw) throw new Error('no cache')
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') throw new Error('bad cache')
      return { loading: false, ...parsed }
    } catch (_) {
      return { loading: true, ts: null, cluster: { ok: 0, warn: 0, offline: 0 }, avgCpu: 0, avgMem: 0, top3: [], sampled: 0, total: 0 }
    }
  })
  const [containers, setContainers] = useState(() => {
    try {
      const raw = localStorage.getItem(containersCacheKey)
      if (!raw) throw new Error('no cache')
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') throw new Error('bad cache')
      return { loading: false, ...parsed }
    } catch (_) {
      return { loading: true, ts: null, total: 0, running: 0, abnormal: 0 }
    }
  })
  const [alerts, setAlerts] = useState([])
  const [bottomTab, setBottomTab] = useState('deploy')
  const pollRef = useRef({ metrics: null, containers: null })
  const pollCtlRef = useRef({
    metrics: null,
    containers: null,
    metricsRunning: false,
    containersRunning: false
  })
  const serversRef = useRef([])
  const deploymentsRef = useRef([])
  const alertStateRef = useRef({})

  const load = async () => {
    const res = await api.get('/api/overview')
    if (res?.ok) {
      setData(res)
      try {
        localStorage.setItem(overviewCacheKey, JSON.stringify(res))
      } catch (_) {}
    }
    setLoading(false)
  }

  const loadLists = async () => {
    const [sv, dp] = await Promise.all([api.get('/api/servers'), api.get('/api/deployments')])
    const s = Array.isArray(sv) ? sv : []
    const d = Array.isArray(dp) ? dp : []
    setServers(s)
    setDeployments(d)
    serversRef.current = s
    deploymentsRef.current = d
    setFocusServerId((p) => (p ? p : s[0]?.id || null))
    setFocusDeploymentId((p) => (p ? p : d[0]?.id || null))
  }

  const pushAlert = (level, key, msg) => {
    const prev = alertStateRef.current[key]
    if (prev === level) return
    if (level === 'ok' && prev === undefined) {
      alertStateRef.current[key] = level
      return
    }
    alertStateRef.current[key] = level
    const id = `${Date.now()}_${key}_${level}`
    setAlerts((p) => [{ id, level, msg, ts: new Date().toISOString() }, ...p].slice(0, 40))
  }

  const pollServerMetrics = async () => {
    if (pollCtlRef.current.metricsRunning) return
    pollCtlRef.current.metricsRunning = true
    if (pollCtlRef.current.metrics) {
      try {
        pollCtlRef.current.metrics.abort()
      } catch (_) {}
    }
    const ctl = new AbortController()
    pollCtlRef.current.metrics = ctl
    const list = serversRef.current || []
    if (!list.length) {
      setRuntime((p) => ({ ...p, loading: false, ts: Date.now(), cluster: { ok: 0, warn: 0, offline: 0 }, avgCpu: 0, avgMem: 0, top3: [], sampled: 0, total: 0 }))
      pollCtlRef.current.metricsRunning = false
      return
    }
    const targetId = focusServerId || list[0]?.id
    const target = list.find((x) => x.id === targetId) || list[0]
    if (!target?.id) {
      pollCtlRef.current.metricsRunning = false
      return
    }
    try {
      const res = await api.get(`/api/servers/${target.id}/metrics`, { signal: ctl.signal })
      if (res?.ok) {
        const cpu = clampPct100(res?.metrics?.cpu_usage)
        const memPct = clampPct100(res?.metrics?.memory?.percent)
        const memTotal = memToBytes(res?.metrics?.memory?.total)
        const memUsed = memToBytes(res?.metrics?.memory?.used)
        const diskPct = parsePct(res?.metrics?.disk?.percent)
        const diskTotal = dfKiBToBytes(res?.metrics?.disk?.total)
        const diskUsed = dfKiBToBytes(res?.metrics?.disk?.used)
        const diskAvail = dfKiBToBytes(res?.metrics?.disk?.avail)
        const item = { ok: true, cpu, mem: memPct, mem_total_bytes: memTotal, mem_used_bytes: memUsed, disk: diskPct, disk_total_bytes: diskTotal, disk_used_bytes: diskUsed, disk_avail_bytes: diskAvail, ts: Date.now() }
        setServerMetricsById((p) => {
          const n = { ...(p || {}), [target.id]: item }
          try {
            localStorage.setItem(serverMetricsCacheKey, JSON.stringify(n))
          } catch (_) {}
          const sampled = Object.keys(n).length
          const ts = Date.now()
          setRuntime((prev) => ({ ...prev, loading: false, ts, sampled, total: list.length, avgCpu: cpu, avgMem: memPct }))
          try {
            localStorage.setItem(runtimeCacheKey, JSON.stringify({ ts, sampled, total: list.length, avgCpu: cpu, avgMem: memPct }))
          } catch (_) {}
          return n
        })
        const warn85 = cpu >= 85 || memPct >= 85
        const severe90 = cpu >= 90 || memPct >= 90
        if (severe90) {
          const d =
            cpu >= 90 && memPct >= 90
              ? `CPU ${cpu.toFixed(0)}% · 内存 ${memPct.toFixed(0)}%`
              : cpu >= 90
                ? `CPU ${cpu.toFixed(0)}%`
              : `内存 ${memPct.toFixed(0)}%`
          pushAlert('bad', `server_hot_${target.id}`, `【严重】${target.name} 资源爆表：${d}`)
        } else {
          pushAlert('ok', `server_hot_${target.id}`, `【恢复】${target.name} 资源已回落（CPU ${cpu.toFixed(0)}% · 内存 ${memPct.toFixed(0)}%）`)
          pushAlert('ok', `server_offline_${target.id}`, `【恢复】${target.name} 资源采集已恢复`)
        }
      } else {
        const item = { ok: false, cpu: 0, mem: 0, mem_total_bytes: null, mem_used_bytes: null, disk: null, disk_total_bytes: null, disk_used_bytes: null, disk_avail_bytes: null, ts: Date.now() }
        setServerMetricsById((p) => {
          const n = { ...(p || {}), [target.id]: item }
          try {
            localStorage.setItem(serverMetricsCacheKey, JSON.stringify(n))
          } catch (_) {}
          const sampled = Object.keys(n).length
          const ts = Date.now()
          setRuntime((prev) => ({ ...prev, loading: false, ts, sampled, total: list.length }))
          try {
            localStorage.setItem(runtimeCacheKey, JSON.stringify({ ts, sampled, total: list.length }))
          } catch (_) {}
          return n
        })
        pushAlert('bad', `server_offline_${target.id}`, `【离线】${target.name}：资源采集失败（SSH/网络不可达）`)
      }
    } catch (_) {}
    pollCtlRef.current.metricsRunning = false
  }

  useEffect(() => {
    if (!focusServerId) return
    pollServerMetrics()
  }, [focusServerId])

  const pollContainers = async () => {
    if (pollCtlRef.current.containersRunning) return
    pollCtlRef.current.containersRunning = true
    if (pollCtlRef.current.containers) {
      try {
        pollCtlRef.current.containers.abort()
      } catch (_) {}
    }
    const ctl = new AbortController()
    pollCtlRef.current.containers = ctl
    const list = deploymentsRef.current || []
    if (!list.length) {
      setContainers({ loading: false, ts: Date.now(), total: 0, running: 0, abnormal: 0 })
      pollCtlRef.current.containersRunning = false
      return
    }
    const targetId = focusDeploymentId || list[0]?.id
    const target = list.find((x) => x.id === targetId) || list[0]
    if (!target?.id) {
      pollCtlRef.current.containersRunning = false
      return
    }
    const seen = new Set()
    let total = 0
    let running = 0
    let abnormal = 0
    const res = await api.get(`/api/deployments/${target.id}/monitor`, { signal: ctl.signal })
    if (res?.ok) {
      const groups = Array.isArray(res.groups) ? res.groups : []
      for (const g of groups) {
        const cts = Array.isArray(g?.containers) ? g.containers : []
        for (const c of cts) {
          const id = c?.ID ? String(c.ID) : `${g?.compose_path || ''}::${c?.Name || c?.Names || ''}::${c?.Image || ''}`
          if (seen.has(id)) continue
          seen.add(id)
          total++
          const st = String(c?.State || '').toLowerCase()
          if (st === 'running') running++
          else abnormal++
          if (st && st !== 'running') {
            const name = String(c?.Name || c?.Names || c?.Service || 'container')
            pushAlert('bad', `container_${target.id}_${id}`, `【严重】${target.name || '实例'} 容器异常：${name}（${st}）`)
          } else {
            const name = String(c?.Name || c?.Names || c?.Service || 'container')
            pushAlert('ok', `container_${target.id}_${id}`, `【恢复】${target.name || '实例'} 容器已恢复运行：${name}`)
          }
        }
      }
    }
    const next = { ts: Date.now(), total, running, abnormal, deployment_id: target.id }
    setContainers({ loading: false, ...next })
    try {
      localStorage.setItem(containersCacheKey, JSON.stringify(next))
    } catch (_) {}
    pollCtlRef.current.containersRunning = false
  }

  useEffect(() => {
    if (!focusDeploymentId) return
    pollContainers()
  }, [focusDeploymentId])

  const stopPolling = () => {
    if (pollRef.current.metrics) clearInterval(pollRef.current.metrics)
    if (pollRef.current.containers) clearInterval(pollRef.current.containers)
    pollRef.current.metrics = null
    pollRef.current.containers = null
    if (pollCtlRef.current.metrics) {
      try {
        pollCtlRef.current.metrics.abort()
      } catch (_) {}
    }
    if (pollCtlRef.current.containers) {
      try {
        pollCtlRef.current.containers.abort()
      } catch (_) {}
    }
    pollCtlRef.current.metrics = null
    pollCtlRef.current.containers = null
    pollCtlRef.current.metricsRunning = false
    pollCtlRef.current.containersRunning = false
  }

  const startPolling = () => {
    if (!pollRef.current.metrics) {
      pollServerMetrics()
      pollRef.current.metrics = setInterval(pollServerMetrics, 30000)
    }
  }

  const startContainersPolling = () => {
    if (pollRef.current.containers) return
    pollContainers()
    pollRef.current.containers = setInterval(pollContainers, 90000)
  }

  const stopContainersPolling = () => {
    if (pollRef.current.containers) clearInterval(pollRef.current.containers)
    pollRef.current.containers = null
    if (pollCtlRef.current.containers) {
      try {
        pollCtlRef.current.containers.abort()
      } catch (_) {}
    }
    pollCtlRef.current.containers = null
    pollCtlRef.current.containersRunning = false
  }

  useEffect(() => {
    load()
    ;(async () => {
      await loadLists()
      startPolling()
    })()
    const t = setInterval(load, 15000)
    const onVis = () => {
      if (document.hidden) stopPolling()
      else startPolling()
    }
    const onUnload = () => stopPolling()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      clearInterval(t)
      stopPolling()
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [])

  useEffect(() => {
    if (document.hidden) return
    if (bottomTab === 'alerts') {
      startContainersPolling()
      return
    }
    stopContainersPolling()
  }, [bottomTab, containers.loading])

  const m = data?.metrics || {}
  const trend = Array.isArray(data?.trend_7d) ? data.trend_7d : []
  const env = Array.isArray(data?.env_dist) ? data.env_dist : []
  const feed = Array.isArray(data?.feed) ? data.feed : []

  const feed7d = useMemo(() => {
    const now = Date.now()
    const from = now - 7 * 24 * 60 * 60 * 1000
    return feed.filter((it) => {
      const t = it?.created_at ? Date.parse(it.created_at) : NaN
      if (!Number.isFinite(t)) return true
      return t >= from && t <= now + 60 * 1000
    })
  }, [feed])

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

  const cluster = useMemo(() => {
    const sv = Array.isArray(servers) ? servers : []
    const map = serverMetricsById && typeof serverMetricsById === 'object' ? serverMetricsById : {}
    let sampled = 0
    let ok = 0
    let warn = 0
    let offline = 0
    for (const s of sv) {
      const it = map?.[s.id]
      if (!it) continue
      sampled++
      if (!it.ok) {
        offline++
        continue
      }
      const hot = Number(it.cpu || 0) >= 85 || Number(it.mem || 0) >= 85
      if (hot) warn++
      else ok++
    }
    const total = sv.length
    const unchecked = Math.max(0, total - sampled)
    return { ok, warn, offline, unchecked, sampled, total }
  }, [servers, serverMetricsById])

  const clusterTone = cluster.offline > 0 ? 'bad' : cluster.warn > 0 ? 'warn' : 'ok'
  const containerTone = containers.abnormal > 0 ? 'bad' : containers.total > 0 ? 'ok' : 'warn'
  const clusterTip = `正常：资源采集成功，CPU/内存 < 85%\n告警：CPU 或 内存 ≥ 85%（资源水位偏高）\n离线：资源采集失败（SSH/网络/鉴权问题）\n未巡检：尚未采集到该节点资源数据`
  const envText = (() => {
    const arr = Array.isArray(servers) ? servers : []
    if (!arr.length) return ''
    const c = { PROD: 0, TEST: 0, DEV: 0, OTHER: 0 }
    for (const s of arr) {
      const k = String(s?.environment || 'OTHER').toUpperCase()
      if (k in c) c[k]++
      else c.OTHER++
    }
    const parts = []
    for (const k of ['PROD', 'TEST', 'DEV', 'OTHER']) {
      if (c[k]) parts.push(`${k} ${c[k]}`)
    }
    return parts.length ? `环境：${parts.join(' · ')}` : ''
  })()
  const focusId = focusServerId || (Array.isArray(servers) && servers[0] ? servers[0].id : null)
  const focusMetric = focusId && serverMetricsById ? serverMetricsById[focusId] : null
  const focusCpu = focusMetric?.ok ? Number(focusMetric.cpu || 0) : 0
  const focusMem = focusMetric?.ok ? Number(focusMetric.mem || 0) : 0
  const focusDisk = focusMetric?.ok ? (focusMetric.disk === null || focusMetric.disk === undefined ? null : Number(focusMetric.disk)) : null
  const cpuTip = focusMetric?.ok ? `CPU 使用率 ${clampPct100(focusCpu).toFixed(1)}%\n空闲 ${(100 - clampPct100(focusCpu)).toFixed(1)}%` : 'CPU 未采集'
  const memTip = (() => {
    if (!focusMetric?.ok) return '内存 未采集'
    const t = Number(focusMetric.mem_total_bytes)
    const u = Number(focusMetric.mem_used_bytes)
    if (!Number.isFinite(t) || !Number.isFinite(u) || t <= 0) return '内存 未采集'
    const avail = Math.max(0, t - u)
    return `内存 已用 ${fmtBytesShort(u)} / 总计 ${fmtBytesShort(t)}\n剩余 ${fmtBytesShort(avail)}`
  })()
  const diskTip = (() => {
    if (!focusMetric?.ok) return '磁盘 未采集'
    const t = Number(focusMetric.disk_total_bytes)
    const u = Number(focusMetric.disk_used_bytes)
    const a = Number(focusMetric.disk_avail_bytes)
    if (Number.isFinite(t) && Number.isFinite(u) && t > 0) {
      const avail = Number.isFinite(a) ? a : Math.max(0, t - u)
      return `磁盘 已用 ${fmtBytesShort(u)} / 总计 ${fmtBytesShort(t)}\n剩余 ${fmtBytesShort(avail)}`
    }
    return '磁盘 未采集'
  })()

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
          <MetricCard
            title="今日部署成功率"
            value={loading ? '-' : fmtPct(m?.success_rate_today)}
            sub={loading ? '总计 - 次部署' : `总计 ${Number(m?.deploy_today || 0)} 次部署`}
            icon="bullseye"
            tone={succTone}
          />
          <MetricCard
            title="集群健康度"
            value={
              cluster.total === 0 ? (
                '-'
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontWeight: 900 }}>{cluster.ok + cluster.warn}</span>
                  <span className="metric-unit">台在线</span>
                </span>
              )
            }
            sub={
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: cluster.warn > 0 ? 'var(--danger)' : 'var(--text-sub)' }}>
                  <span className="legend-dot" style={{ background: cluster.warn > 0 ? 'var(--danger)' : 'rgba(148,163,184,0.9)' }} /> 告警 {cluster.warn}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: cluster.offline > 0 ? 'var(--danger)' : 'var(--text-sub)' }}>
                  <span className="legend-dot" style={{ background: cluster.offline > 0 ? 'var(--danger)' : 'rgba(148,163,184,0.9)' }} /> 离线 {cluster.offline}
                </span>
              </div>
            }
            icon="server"
            tone={clusterTone}
            onClick={() => (onNavigate ? onNavigate('settings') : null)}
            tooltip={clusterTip}
          />
          <MetricCard
            title="活跃容器总数"
            value={containers.loading ? '-' : String(containers.total)}
            sub={
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span className="legend-dot" style={{ background: 'var(--success)' }} /> 运行中 {containers.running}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span className="legend-dot" style={{ background: 'var(--danger)' }} /> 异常 {containers.abnormal}
                </span>
              </div>
            }
            icon="cubes"
            tone={containerTone}
            onClick={() => (onNavigate ? onNavigate('dashboard') : null)}
          />
        </div>

        <div className="overview-charts">
          <TrendChart data={trend} onNavigate={onNavigate} />
          <ResourceWatermark
            loading={!focusMetric}
            cpu={focusCpu}
            mem={focusMem}
            disk={focusDisk}
            ts={focusMetric?.ts || runtime.ts}
            sampled={cluster.sampled}
            total={cluster.total}
            envText={envText}
            servers={servers}
            focusId={focusId}
            onFocus={(id) => setFocusServerId(id)}
            cpuTip={cpuTip}
            memTip={memTip}
            diskTip={diskTip}
          />
        </div>

        <div className="overview-bottom">
          <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div className="tabs tabs-equal" style={{ borderBottom: 0 }}>
                <button className={`tab ${bottomTab === 'deploy' ? 'active' : ''}`} onClick={() => setBottomTab('deploy')}>
                  部署动态
                </button>
                <button className={`tab ${bottomTab === 'alerts' ? 'active' : ''}`} onClick={() => setBottomTab('alerts')}>
                  异常告警
                </button>
              </div>
              {bottomTab === 'deploy' ? (
                <button className="btn btn-ghost btn-sm" onClick={() => (onNavigate ? onNavigate('history') : null)}>
                  查看全部 <Icon name="arrow-right" />
                </button>
              ) : (
                <button className="btn btn-ghost btn-sm" onClick={() => setAlerts([])}>
                  清空 <Icon name="trash" />
                </button>
              )}
            </div>
            <div
              className="feed-scroll"
            >
              <div className="feed-list" style={{ overflow: 'visible' }}>
                {bottomTab === 'deploy' ? (
                  feed7d.length ? (
                    feed7d.map((it) => (
                      <div key={it.id} className="feed-item" onClick={() => (onNavigate ? onNavigate('detail', it.deployment_id, { historyId: it.id }) : null)}>
                        <span className={`status-dot ${statusDotClass(it.status)}`} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                            <div className="feed-title">{it.deployment_name || '部署任务'}</div>
                            <div className="feed-time">{it.created_at ? new Date(it.created_at).toLocaleTimeString() : ''}</div>
                          </div>
                          <div className="feed-sub">{`${it.repo_name || '-'}${it.branch ? ` · ${it.branch}` : ''} → ${it.server_name || '-'}`}</div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ color: 'var(--text-sub)', padding: 10 }}>暂无动态</div>
                  )
                ) : alerts.length ? (
                  alerts.map((a) => (
                    <div key={a.id} className="feed-item">
                      <span className={`status-dot ${a.level === 'bad' ? 'offline' : a.level === 'warn' ? 'canceled' : 'online'}`} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                          <div className="feed-title">{a.msg}</div>
                          <div className="feed-time">{a.ts ? new Date(a.ts).toLocaleTimeString() : ''}</div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ color: 'var(--text-sub)', padding: 10 }}>暂无告警</div>
                )}
              </div>
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
