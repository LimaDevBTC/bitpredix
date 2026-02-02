'use client'

import { useEffect, useRef } from 'react'

const WIDGET_SCRIPT = 'https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js'

const WIDGET_CONFIG = {
  colorTheme: 'dark',
  displayMode: 'single',
  isTransparent: true,
  locale: 'en',
  interval: '1m',
  disableInterval: false,
  width: 425,
  height: 450,
  symbol: 'BITSTAMP:BTCUSD',
  showIntervalTabs: true,
} as const

export function TradingViewTechnicalAnalysis() {
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
    <div ref={containerRef} className="tradingview-widget-container w-full">
      <div className="tradingview-widget-container__widget w-full" style={{ height: 450 }} />
      <div className="tradingview-widget-copyright mt-1 text-[10px] text-zinc-500">
        <a
          href="https://www.tradingview.com/symbols/BTCUSD/?exchange=BITSTAMP"
          rel="noopener nofollow"
          target="_blank"
          className="text-bitcoin/80 hover:text-bitcoin"
        >
          BTCUSD analysis
        </a>
        <span className="text-zinc-600"> by TradingView</span>
      </div>
    </div>
  )
}
