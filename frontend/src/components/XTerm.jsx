import { useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'

export default function XTerm({ lines, onReady }) {
  const hostRef = useRef(null)
  const termRef = useRef(null)
  const fitRef = useRef(null)
  const lastLenRef = useRef(0)

  useEffect(() => {
    if (!hostRef.current) return
    if (termRef.current) return
    const term = new Terminal({
      convertEol: true,
      cursorBlink: false,
      fontSize: 13,
      fontFamily: "Consolas, 'Fira Code', Menlo, Monaco, monospace",
      theme: {
        background: '#0b1220',
        foreground: '#e2e8f0'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)
    fit.fit()
    termRef.current = term
    fitRef.current = fit
    if (onReady) onReady({ term, fit })

    const onResize = () => fit.fit()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [onReady])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const next = Array.isArray(lines) ? lines : []
    const last = lastLenRef.current || 0
    if (next.length < last) {
      term.reset()
      lastLenRef.current = 0
    }
    for (let i = lastLenRef.current; i < next.length; i++) {
      term.writeln(next[i] ?? '')
    }
    lastLenRef.current = next.length
  }, [lines])

  return <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
}

