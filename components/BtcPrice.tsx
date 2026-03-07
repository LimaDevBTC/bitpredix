'use client'

interface BtcPriceProps {
  price: number | null
  loading?: boolean
  error?: string | null
}

export function BtcPrice({ price, loading, error }: BtcPriceProps) {
  if (loading && price == null) {
    return (
      <div className="font-mono text-2xl text-zinc-500 animate-pulse">
        $ —.—
      </div>
    )
  }

  const hasError = !!error

  return (
    <span className="font-mono" title={hasError ? 'Price update paused—reconnecting...' : undefined}>
      ${price != null ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
      {hasError && price != null && (
        <span className="ml-1 text-amber-400/80" aria-hidden="true">·</span>
      )}
    </span>
  )
}
