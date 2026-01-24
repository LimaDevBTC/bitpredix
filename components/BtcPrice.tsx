'use client'

import { useEffect, useState, useRef } from 'react'

export function BtcPrice() {
  const [price, setPrice] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [stale, setStale] = useState(false)
  const failCountRef = useRef(0)

  useEffect(() => {
    const FETCH_TIMEOUT_MS = 10_000
    const fetchPrice = async () => {
      const ctrl = new AbortController()
      const to = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
      try {
        const res = await fetch('/api/btc-price', { signal: ctrl.signal })
        const data = await res.json()
        if (data.ok && typeof data.usd === 'number') {
          setPrice(data.usd)
          failCountRef.current = 0
          setStale(false)
        } else {
          failCountRef.current += 1
          if (failCountRef.current >= 3) setStale(true)
        }
      } catch {
        failCountRef.current += 1
        if (failCountRef.current >= 3) setStale(true)
      } finally {
        clearTimeout(to)
        setLoading(false)
      }
    }
    fetchPrice()
    const interval = setInterval(fetchPrice, 3000)
    return () => clearInterval(interval)
  }, [])

  if (loading && price == null) {
    return (
      <div className="font-mono text-2xl text-zinc-500 animate-pulse">
        $ —.—
      </div>
    )
  }

  return (
    <span className="font-mono" title={stale ? 'Price update paused—check connection' : undefined}>
      ${price != null ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
      {stale && price != null && (
        <span className="ml-1 text-amber-400/80" aria-hidden="true">·</span>
      )}
    </span>
  )
}
