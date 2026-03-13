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

const request = async (method, url, data) => {
  const isAbs = /^https?:\/\//i.test(url)
  const full = isAbs ? url : `${base}${url}`
  const opts = { method, headers: {} }
  if (data !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(data)
  }
  const res = await fetch(full, opts)
  return parseBody(res)
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, data) => request('POST', url, data),
  del: (url) => request('DELETE', url)
}

