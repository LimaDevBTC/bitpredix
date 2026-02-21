'use client'

import { useEffect, useRef } from 'react'
import type { IChartApi } from 'lightweight-charts'

interface EquityPoint {
  time: number
  value: number
}

interface Props {
  data: EquityPoint[]
}

export default function EquityCurveChart({ data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return
    let cancelled = false

    async function init() {
      const { createChart, BaselineSeries } = await import('lightweight-charts')
      if (cancelled || !containerRef.current) return

      const chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: 280,
        layout: {
          background: { color: 'transparent' },
          textColor: '#71717a',
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 11,
        },
        grid: {
          vertLines: { color: 'rgba(39, 39, 42, 0.5)' },
          horzLines: { color: 'rgba(39, 39, 42, 0.5)' },
        },
        rightPriceScale: {
          borderColor: '#27272a',
        },
        timeScale: {
          borderColor: '#27272a',
          timeVisible: true,
          secondsVisible: false,
        },
        crosshair: {
          vertLine: { color: '#52525b', labelBackgroundColor: '#27272a' },
          horzLine: { color: '#52525b', labelBackgroundColor: '#27272a' },
        },
        handleScroll: true,
        handleScale: true,
      })

      const series = chart.addSeries(BaselineSeries, {
        baseValue: { type: 'price' as const, price: 0 },
        topLineColor: '#22C55E',
        topFillColor1: 'rgba(34, 197, 94, 0.28)',
        topFillColor2: 'rgba(34, 197, 94, 0.05)',
        bottomLineColor: '#EF4444',
        bottomFillColor1: 'rgba(239, 68, 68, 0.05)',
        bottomFillColor2: 'rgba(239, 68, 68, 0.28)',
        lineWidth: 2,
      })

      // Deduplicate by timestamp — keep only the last (cumulative) value per time
      const deduped = new Map<number, number>()
      for (const d of data) {
        deduped.set(d.time, d.value)
      }
      series.setData([...deduped.entries()].map(([t, v]) => ({
        time: t as import('lightweight-charts').UTCTimestamp,
        value: v,
      })))

      chart.timeScale().fitContent()
      chartRef.current = chart

      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          chart.applyOptions({ width: entry.contentRect.width })
        }
      })
      ro.observe(containerRef.current)
      ;(chart as unknown as Record<string, unknown>).__ro = ro
    }

    init()

    return () => {
      cancelled = true
      if (chartRef.current) {
        const ro = (chartRef.current as unknown as Record<string, unknown>).__ro as ResizeObserver | undefined
        ro?.disconnect()
        chartRef.current.remove()
        chartRef.current = null
      }
    }
  }, [data])

  if (data.length === 0) {
    return (
      <div className="h-[280px] flex items-center justify-center text-zinc-600 text-sm">
        No resolved predictions yet
      </div>
    )
  }

  return <div ref={containerRef} className="w-full" />
}
