'use client'

import { useEffect, useRef } from 'react'

const WIDGET_SCRIPT = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'

const WIDGET_CONFIG = {
  allow_symbol_change: true,
  calendar: false,
  details: false,
  hide_side_toolbar: true,
  hide_top_toolbar: false,
  hide_legend: false,
  hide_volume: false,
  hotlist: false,
  interval: '1',
  locale: 'en',
  save_image: true,
  style: '1',
  symbol: 'BITSTAMP:BTCUSD',
  theme: 'dark',
  timezone: 'Etc/UTC',
  backgroundColor: '#18181b',
  gridColor: 'rgba(242, 242, 242, 0.06)',
  watchlist: [],
  withdateranges: false,
  compareSymbols: [],
  studies: [],
  autosize: true,
} as const

export function TradingViewBtcChart() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(false)

  useEffect(() => {
    if (!containerRef.current || mountedRef.current) return

    const script = document.createElement('script')
    script.src = WIDGET_SCRIPT
    script.async = true
    script.textContent = JSON.stringify(WIDGET_CONFIG)
    containerRef.current.appendChild(script)
    mountedRef.current = true

    return () => {
      script.remove()
      mountedRef.current = false
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container w-full"
      style={{ height: '100%', minHeight: 280 }}
    >
      <div
        className="tradingview-widget-container__widget w-full"
        style={{ height: '100%' }}
      />
    </div>
  )
}
