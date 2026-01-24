'use client'

import { useState, useEffect } from 'react'
import { getMyResults } from '@/lib/positions'

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function MyLastResults() {
  const [results, setResults] = useState<ReturnType<typeof getMyResults>>([])

  useEffect(() => {
    queueMicrotask(() => setResults(getMyResults()))
  }, [])

  useEffect(() => {
    const onUpdate = () => setResults(getMyResults())
    window.addEventListener('bitpredix_my_results_updated', onUpdate)
    return () => window.removeEventListener('bitpredix_my_results_updated', onUpdate)
  }, [])

  if (results.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs text-zinc-500 uppercase tracking-wider">Yours:</span>
      {results.map((r, i) => (
        <span key={r.roundId} className="font-mono text-sm">
          {i > 0 && <span className="text-zinc-500 mx-0.5">·</span>}
          <span className={r.outcome === 'UP' ? 'text-up' : 'text-down'}>{r.outcome}</span>
          <span className={r.pnl >= 0 ? ' text-up' : ' text-down'}>
            {r.pnl >= 0 ? '+' : ''}{r.pnl.toFixed(2)}
          </span>
          <span className="text-zinc-500 text-xs ml-0.5">({formatTime(r.startAt)})</span>
        </span>
      ))}
    </div>
  )
}
