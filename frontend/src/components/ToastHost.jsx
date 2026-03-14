import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'

export default function ToastHost() {
  const [toast, setToast] = useState(null)

  useEffect(() => {
    let t = null
    const onToast = (ev) => {
      const d = ev.detail || {}
      setToast({ type: d.type || 'success', message: d.message || '' })
      if (t) clearTimeout(t)
      t = setTimeout(() => setToast(null), 2200)
    }
    window.addEventListener('app-toast', onToast)
    return () => {
      window.removeEventListener('app-toast', onToast)
      if (t) clearTimeout(t)
    }
  }, [])

  if (!toast) return null

  const ok = toast.type === 'success'
  return (
    <div className={`toast ${ok ? 'toast-success' : 'toast-error'}`}>
      <Icon name={ok ? 'circle-check' : 'circle-xmark'} />
      <span>{toast.message}</span>
    </div>
  )
}

