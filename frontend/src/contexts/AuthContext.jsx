import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from '../services/api.js'

const AuthContext = createContext(null)

const tokenKey = 'nexusops_token'
const userKey = 'nexusops_user'
const permsKey = 'nexusops_permissions'

const readJson = (k, fallback) => {
  try {
    const raw = localStorage.getItem(k)
    if (!raw) return fallback
    const v = JSON.parse(raw)
    return v ?? fallback
  } catch {
    return fallback
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => {
    try {
      return localStorage.getItem(tokenKey) || ''
    } catch {
      return ''
    }
  })
  const [user, setUser] = useState(() => readJson(userKey, null))
  const [permissions, setPermissions] = useState(() => readJson(permsKey, []))
  const [loading, setLoading] = useState(true)

  const persist = (t, u, p) => {
    try {
      if (t) localStorage.setItem(tokenKey, t)
      else localStorage.removeItem(tokenKey)
      if (u) localStorage.setItem(userKey, JSON.stringify(u))
      else localStorage.removeItem(userKey)
      if (p) localStorage.setItem(permsKey, JSON.stringify(p))
      else localStorage.removeItem(permsKey)
    } catch {
    }
  }

  const refresh = useCallback(async () => {
    if (!token) {
      setUser(null)
      setPermissions([])
      setLoading(false)
      return
    }
    try {
      const res = await api.get('/api/auth/me')
      if (res?.ok) {
        setUser(res.user || null)
        setPermissions(Array.isArray(res.permissions) ? res.permissions : [])
        persist(token, res.user || null, Array.isArray(res.permissions) ? res.permissions : [])
      } else {
        setToken('')
        setUser(null)
        setPermissions([])
        persist('', null, [])
      }
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    refresh()
  }, [refresh])

  const login = useCallback(async (username, password) => {
    const res = await api.post('/api/auth/login', { username, password })
    if (!res?.ok || !res?.token) return { ok: false, detail: res?.detail || '登录失败' }
    const t = String(res.token)
    const u = res.user || null
    const p = Array.isArray(res.permissions) ? res.permissions : []
    setToken(t)
    setUser(u)
    setPermissions(p)
    persist(t, u, p)
    return { ok: true }
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout', {})
    } catch {
    }
    setToken('')
    setUser(null)
    setPermissions([])
    persist('', null, [])
  }, [])

  const hasPerm = useCallback(
    (code) => {
      if (!code) return true
      return (permissions || []).includes(code) || (permissions || []).includes('rbac:manage')
    },
    [permissions]
  )

  const value = useMemo(() => ({ token, user, permissions, loading, login, logout, refresh, hasPerm }), [token, user, permissions, loading, login, logout, refresh, hasPerm])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
