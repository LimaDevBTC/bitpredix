'use client'

import { useEffect, useState, Fragment } from 'react'

type Side = 'UP' | 'DOWN'

export function RecentOutcomes() {
  const [outcomes, setOutcomes] = useState<Side[]>([])

  useEffect(() => {
    const fetch_ = async () => {
      try {
        const res = await fetch('/api/rounds')
        const data = await res.json()
        if (data.ok && Array.isArray(data.rounds)) {
          const o = data.rounds
            .filter((r: { outcome?: string }) => r.outcome === 'UP' || r.outcome === 'DOWN')
            .slice(0, 8)
            .map((r: { outcome: string }) => r.outcome as Side)
          setOutcomes(o)
        }
      } catch {
        // ignore
      }
    }
    fetch_()
    const id = setInterval(fetch_, 5000)
    return () => clearInterval(id)
  }, [])

  if (outcomes.length === 0) {
    return <span className="text-xs text-zinc-600">Waiting for first results</span>
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs text-zinc-500 uppercase tracking-wider">Latest:</span>
      {outcomes.map((s, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-zinc-500">·</span>}
          <span className={`font-mono text-sm font-medium ${s === 'UP' ? 'text-up' : 'text-down'}`}>{s}</span>
        </Fragment>
      ))}
    </div>
  )
}
