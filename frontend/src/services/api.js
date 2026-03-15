const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

const parseBody = async (res) => {
  const ct = (res.headers.get('content-type') || '').toLowerCase()
  if (ct.includes('application/json')) return res.json()
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { ok: false, status: res.status, text }
  }
}

const request = async (method, url, data, opts) => {
  const isAbs = /^https?:\/\//i.test(url)
  const full = isAbs ? url : `${base}${url}`
  const o = { method, headers: {}, ...(opts || {}) }
  if (data !== undefined) {
    o.headers['Content-Type'] = 'application/json'
    o.body = JSON.stringify(data)
  }
  const res = await fetch(full, o)
  return parseBody(res)
}

export const api = {
  get: (url, opts) => request('GET', url, undefined, opts),
  post: (url, data, opts) => request('POST', url, data, opts),
  put: (url, data, opts) => request('PUT', url, data, opts),
  del: (url, opts) => request('DELETE', url, undefined, opts)
}
