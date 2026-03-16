const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

const getToken = () => {
  try {
    return localStorage.getItem('nexusops_token') || ''
  } catch {
    return ''
  }
}

const parseSseEvent = (raw) => {
  const lines = String(raw || '')
    .split('\n')
    .map((x) => x.trimEnd())
    .filter((x) => x !== '')
  const dataLines = lines.filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart())
  if (!dataLines.length) return null
  return dataLines.join('\n')
}

export async function streamChatCompletions({ messages, signal, onDelta, onFinish }) {
  const t = getToken()
  const headers = { Accept: 'text/event-stream', 'Content-Type': 'application/json' }
  if (t) headers['Authorization'] = `Bearer ${t}`

  const res = await fetch(`${base}/api/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ messages, stream: true }),
    signal
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `HTTP ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value || new Uint8Array(), { stream: true })
    buf = buf.replace(/\r/g, '')

    while (true) {
      const idx = buf.indexOf('\n\n')
      if (idx < 0) break
      const rawEvent = buf.slice(0, idx)
      buf = buf.slice(idx + 2)

      const data = parseSseEvent(rawEvent)
      if (!data) continue
      if (data === '[DONE]') {
        if (onFinish) onFinish({ ok: true })
        return
      }
      let obj = null
      try {
        obj = JSON.parse(data)
      } catch {
        obj = null
      }
      const delta = obj?.choices?.[0]?.delta?.content
      const finishReason = obj?.finish_reason
      if (typeof delta === 'string' && delta) {
        if (onDelta) onDelta(delta)
      }
      if (finishReason) {
        if (onFinish) onFinish({ ok: true, finishReason })
      }
    }
  }

  if (onFinish) onFinish({ ok: true })
}

