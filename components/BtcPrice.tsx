'use client'

import { useEffect, useState } from 'react'

export function BtcPrice() {
  const [price, setPrice] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const FETCH_TIMEOUT_MS = 5000
    const fetchPrice = async () => {
      const ctrl = new AbortController()
      const to = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
      try {
        const res = await fetch('/api/btc-price', { signal: ctrl.signal })
        const data = await res.json()
        if (data.ok) setPrice(data.usd)
      } catch {
        // mantém o último preço válido para evitar piscar
      } finally {
        clearTimeout(to)
        setLoading(false)
      }
    }
    fetchPrice()
    const interval = setInterval(fetchPrice, 2000)
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
    <span className="font-mono">
      ${price != null ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
    </span>
  )
}
