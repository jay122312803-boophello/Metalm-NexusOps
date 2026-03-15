import { useMemo, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'

function BrandMark() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="nxo_g" x1="6" y1="6" x2="38" y2="38" gradientUnits="userSpaceOnUse">
          <stop stopColor="#16A34A" />
          <stop offset="1" stopColor="#22C55E" />
        </linearGradient>
      </defs>
      <rect x="2.5" y="2.5" width="39" height="39" rx="14" fill="rgba(22,163,74,0.10)" stroke="rgba(22,163,74,0.18)" />
      <path
        d="M16.2 14.6c2.3-2.2 5.8-2.2 8.1 0l3.5 3.4c2.2 2.2 2.2 5.6 0 7.8l-3.5 3.4c-2.3 2.2-5.8 2.2-8.1 0l-3.5-3.4c-2.2-2.2-2.2-5.6 0-7.8l3.5-3.4Z"
        fill="url(#nxo_g)"
        opacity="0.95"
      />
      <path
        d="M17.6 22c0-2.4 2-4.4 4.4-4.4h0c2.4 0 4.4 2 4.4 4.4v0c0 2.4-2 4.4-4.4 4.4h0c-2.4 0-4.4-2-4.4-4.4Z"
        fill="white"
        opacity="0.95"
      />
      <path
        d="M20.3 22c0-0.9 0.7-1.7 1.7-1.7h0c0.9 0 1.7 0.7 1.7 1.7v0c0 0.9-0.7 1.7-1.7 1.7h0c-0.9 0-1.7-0.7-1.7-1.7Z"
        fill="#16A34A"
        opacity="0.95"
      />
    </svg>
  )
}

function SmartAgentIllustration() {
  return (
    <svg width="520" height="360" viewBox="0 0 520 360" fill="none" aria-hidden="true" className="login-illu">
      <defs>
        <linearGradient id="bg" x1="24" y1="24" x2="496" y2="336" gradientUnits="userSpaceOnUse">
          <stop stopColor="rgba(22,163,74,0.10)" />
          <stop offset="1" stopColor="rgba(59,130,246,0.05)" />
        </linearGradient>
        <linearGradient id="g1" x1="146" y1="90" x2="244" y2="196" gradientUnits="userSpaceOnUse">
          <stop stopColor="#16A34A" />
          <stop offset="1" stopColor="#22C55E" />
        </linearGradient>
        <linearGradient id="g2" x1="280" y1="112" x2="388" y2="256" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0EA5E9" />
          <stop offset="1" stopColor="#22C55E" />
        </linearGradient>
        <filter id="shadow" x="0" y="0" width="520" height="360" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="10" stdDeviation="18" floodColor="rgba(15,23,42,0.12)" />
        </filter>
      </defs>

      <g filter="url(#shadow)">
        <rect x="28" y="24" width="464" height="312" rx="22" fill="url(#bg)" stroke="rgba(226,232,240,0.9)" />
      </g>

      <path id="p1" d="M72 258c58-44 120-58 186-42 38 9 68 5 90-14 24-20 55-30 100-28" stroke="rgba(22,163,74,0.30)" strokeWidth="2.5" />
      <path id="p2" d="M76 276c70-62 150-72 238-30 42 20 78 20 108 0" stroke="rgba(59,130,246,0.22)" strokeWidth="2.5" />
      <path id="p3" d="M88 210c48-40 98-54 150-42 26 6 48 4 66-6" stroke="rgba(22,163,74,0.20)" strokeWidth="2.5" />

      <g className="login-flow">
        <circle r="4" fill="#22C55E">
          <animateMotion dur="10s" repeatCount="indefinite" path="M72 258c58-44 120-58 186-42 38 9 68 5 90-14 24-20 55-30 100-28" />
        </circle>
        <circle r="3.2" fill="#16A34A" opacity="0.9">
          <animateMotion dur="12s" repeatCount="indefinite" begin="-4s" path="M76 276c70-62 150-72 238-30 42 20 78 20 108 0" />
        </circle>
        <circle r="2.8" fill="#3B82F6" opacity="0.85">
          <animateMotion dur="11s" repeatCount="indefinite" begin="-7s" path="M88 210c48-40 98-54 150-42 26 6 48 4 66-6" />
        </circle>
      </g>

      <g opacity="0.98">
        <rect x="76" y="176" width="112" height="86" rx="14" fill="rgba(255,255,255,0.78)" stroke="rgba(226,232,240,0.9)" />
        <rect x="90" y="194" width="84" height="10" rx="5" fill="rgba(148,163,184,0.55)" />
        <rect x="90" y="212" width="64" height="10" rx="5" fill="rgba(148,163,184,0.42)" />
        <rect x="90" y="230" width="72" height="10" rx="5" fill="rgba(148,163,184,0.42)" />
      </g>

      <g opacity="0.98">
        <rect x="344" y="160" width="120" height="102" rx="16" fill="rgba(255,255,255,0.78)" stroke="rgba(226,232,240,0.9)" />
        <rect x="360" y="178" width="88" height="10" rx="5" fill="rgba(148,163,184,0.55)" />
        <rect x="360" y="196" width="52" height="10" rx="5" fill="rgba(148,163,184,0.42)" />
        <rect x="360" y="214" width="76" height="10" rx="5" fill="rgba(148,163,184,0.42)" />
        <rect x="360" y="232" width="64" height="10" rx="5" fill="rgba(148,163,184,0.42)" />
      </g>

      <g>
        <path d="M232 282c0 8 6.5 14.5 14.5 14.5h28c8 0 14.5-6.5 14.5-14.5v-10h-57v10Z" fill="rgba(15,23,42,0.10)" />
        <rect x="210" y="96" width="100" height="152" rx="22" fill="rgba(255,255,255,0.92)" stroke="rgba(226,232,240,0.95)" />
        <rect x="232" y="118" width="56" height="34" rx="10" fill="rgba(22,163,74,0.10)" stroke="rgba(22,163,74,0.18)" />
        <circle cx="248" cy="135" r="4.5" fill="#16A34A" />
        <circle cx="272" cy="135" r="4.5" fill="#16A34A" />
        <path d="M242 164h36" stroke="rgba(100,116,139,0.60)" strokeWidth="3" strokeLinecap="round" />
        <rect x="226" y="182" width="68" height="46" rx="14" fill="rgba(15,23,42,0.04)" stroke="rgba(226,232,240,0.95)" />
        <path d="M238 216v-20" stroke="rgba(22,163,74,0.55)" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M250 216v-14" stroke="rgba(59,130,246,0.45)" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M262 216v-18" stroke="rgba(22,163,74,0.55)" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M274 216v-10" stroke="rgba(59,130,246,0.45)" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M286 216v-16" stroke="rgba(22,163,74,0.55)" strokeWidth="3.5" strokeLinecap="round" />
      </g>

      <g>
        <path d="M208 206c-24 18-38 38-44 60" stroke="rgba(22,163,74,0.40)" strokeWidth="6" strokeLinecap="round" />
        <path d="M312 206c24 18 38 38 44 60" stroke="rgba(22,163,74,0.40)" strokeWidth="6" strokeLinecap="round" />
        <rect x="138" y="250" width="70" height="44" rx="14" fill="rgba(255,255,255,0.92)" stroke="rgba(226,232,240,0.95)" />
        <rect x="150" y="262" width="46" height="6" rx="3" fill="rgba(148,163,184,0.55)" />
        <rect x="150" y="274" width="30" height="6" rx="3" fill="rgba(148,163,184,0.42)" />
        <path d="M302 250h80c10 0 18 8 18 18v40c0 8-6 14-14 14h-84c-8 0-14-6-14-14v-44c0-8 6-14 14-14Z" fill="rgba(255,255,255,0.92)" stroke="rgba(226,232,240,0.95)" />
        <rect x="306" y="264" width="64" height="10" rx="5" fill="url(#g1)" opacity="0.85" />
        <rect x="306" y="282" width="52" height="10" rx="5" fill="url(#g2)" opacity="0.72" />
        <circle cx="388" cy="262" r="3.2" fill="#22C55E" />
        <circle cx="396" cy="270" r="2.4" fill="#16A34A" />
      </g>
    </svg>
  )
}

export default function Login() {
  const auth = useAuth()
  const defaultUserHint = useMemo(() => 'admin', [])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setError('')
    setSubmitting(true)
    try {
      const res = await auth.login(username, password)
      if (!res?.ok) setError(res?.detail || '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-inner">
        <div className="login-shell">
          <div className="login-shell-top">
            <div className="login-shell-status">
              <span className="login-status-dot" />
              <span>系统全服务就绪</span>
              <span className="login-status-sub">(All Services Operational)</span>
            </div>
            <div className="login-shell-badges">
              <span className="login-badge">
                <Icon name="shield-halved" /> 安全审核
              </span>
            </div>
          </div>

          <div className="login-shell-body">
            <div className="login-left">
              <div className="login-brand">
                <BrandMark />
                <div>
                  <div className="login-brand-title">NexusOps</div>
                  <div className="login-brand-sub">智能运维运营平台</div>
                </div>
              </div>
              <div className="login-hero">
                <div className="login-hero-title">Smart Agent · 部署与运营自动化</div>
                <div className="login-hero-desc">以统一的工作流、可审计的变更记录与权限体系，连接应用、主机与仓库。</div>
              </div>
              <div className="login-hero-illu">
                <SmartAgentIllustration />
              </div>
            </div>

            <div className="login-right">
              <div className="login-card">
                <div className="login-card-head">
                  <div className="login-card-title">欢迎登录</div>
                  <div className="login-card-sub">您的账号 {defaultUserHint} 已准备就绪</div>
                </div>

                <div className="login-input">
                  <span className="login-input-icon" aria-hidden="true">
                    <Icon name="user" />
                  </span>
                  <input
                    className="login-input-ctrl"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="请输入账号"
                    autoComplete="username"
                    aria-label="账号"
                    onKeyDown={(e) => (e.key === 'Enter' ? submit() : null)}
                  />
                </div>

                <div className="login-input" style={{ marginTop: 12 }}>
                  <span className="login-input-icon" aria-hidden="true">
                    <Icon name="lock" />
                  </span>
                  <input
                    className="login-input-ctrl"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="请输入密码"
                    autoComplete="current-password"
                    aria-label="密码"
                    onKeyDown={(e) => (e.key === 'Enter' ? submit() : null)}
                  />
                  <button className="login-input-suffix" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? '隐藏密码' : '显示密码'}>
                    <Icon name={showPassword ? 'eye-slash' : 'eye'} />
                  </button>
                </div>

                <label className="login-remember">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  记住我
                </label>

                {error ? <div className="login-error">{error}</div> : null}

                <button className="btn btn-primary login-submit" disabled={submitting} onClick={submit}>
                  <Icon name={submitting ? 'spinner fa-spin' : 'right-to-bracket'} /> {submitting ? '登录中...' : '登录'}
                </button>

                <div className="login-links">
                  <button className="login-link" type="button">
                    忘记密码？
                  </button>
                  <span className="login-link-sep" />
                  <button className="login-link" type="button">
                    注册新账号
                  </button>
                  <span className="login-link-sep" />
                  <button className="login-link" type="button">
                    使用 SSO 登录
                  </button>
                </div>
              </div>

              <div className="login-foot">© NexusOps</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
