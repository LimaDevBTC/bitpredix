'use client'

import { useRef, useEffect } from 'react'
import type { IChartApi, ISeriesApi, SeriesType, IPriceLine } from 'lightweight-charts'

export interface BtcPricePoint {
  time: number  // epoch seconds
  price: number // BTC/USD price
}

interface BtcPriceChartProps {
  data: BtcPricePoint[]
  openPrice: number | null
  roundStartAt: number
  roundEndsAt: number
}

// Smooth-damp time — how many seconds to approximately reach the target.
// Higher = smoother/slower curves. 2s gives very organic, Polymarket-like motion.
const SMOOTH_TIME = 2.0
// Interval between chart data point additions (ms) — controls X-axis smoothness
// 50ms (~20fps) × 1px barSpacing = each tick shifts just 1px, imperceptible to the eye
const DATA_TICK_MS = 50

export default function BtcPriceChart({ data, openPrice }: BtcPriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null)
  const priceLineRef = useRef<IPriceLine | null>(null)
  const currentPriceLineRef = useRef<IPriceLine | null>(null)
  const openIndicatorRef = useRef<HTMLDivElement>(null)
  const openPriceRef = useRef<number | null>(null)
  const indicatorStateRef = useRef('')

  // Animation state
  const displayedPriceRef = useRef<number | null>(null)
  const targetPriceRef = useRef<number | null>(null)
  const lastFrameTimeRef = useRef(0)
  const rafIdRef = useRef(0)
  const latestTimeRef = useRef<number>(0)
  const lastDataTickRef = useRef(0) // performance.now() of last data-point addition
  const velocityRef = useRef(0) // current price velocity for smooth-damp

  // Initialize chart on mount
  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false

    async function init() {
      const {
        createChart,
        AreaSeries,
        ColorType,
        CrosshairMode,
        LineStyle,
        LineType,
        LastPriceAnimationMode,
      } = await import('lightweight-charts')

      if (cancelled || !containerRef.current) return

      const chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#71717a',
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 9,
        },
        grid: {
          vertLines: { visible: false },
          horzLines: { color: 'rgba(255, 255, 255, 0.04)', style: LineStyle.Solid },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: {
            width: 1,
            color: 'rgba(247, 147, 26, 0.2)',
            style: LineStyle.Dashed,
            labelBackgroundColor: '#27272a',
          },
          horzLine: {
            width: 1,
            color: 'rgba(247, 147, 26, 0.2)',
            style: LineStyle.Dashed,
            labelBackgroundColor: '#27272a',
          },
        },
        timeScale: {
          borderColor: 'rgba(255, 255, 255, 0.06)',
          timeVisible: true,
          secondsVisible: true,
          rightOffset: 40,
          barSpacing: 1,
        },
        rightPriceScale: {
          borderColor: 'rgba(255, 255, 255, 0.06)',
          scaleMargins: { top: 0.15, bottom: 0.15 },
        },
        handleScroll: false,
        handleScale: false,
      })

      const series = chart.addSeries(AreaSeries, {
        lineColor: '#F7931A',
        topColor: 'rgba(247, 147, 26, 0.15)',
        bottomColor: 'rgba(247, 147, 26, 0)',
        lineWidth: 2,
        lineType: LineType.Curved,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 5,
        crosshairMarkerBackgroundColor: '#F7931A',
        crosshairMarkerBorderColor: '#F7931A',
        lastPriceAnimation: LastPriceAnimationMode.Continuous,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat: { type: 'price', precision: 0, minMove: 1 },
      })

      // Custom current-price label (replaces lastValueVisible to control text color)
      currentPriceLineRef.current = series.createPriceLine({
        price: 0,
        color: 'transparent',
        lineVisible: false,
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        axisLabelColor: '#F7931A',
        axisLabelTextColor: '#000',
        title: '',
      })

      chartRef.current = chart
      seriesRef.current = series

      // ResizeObserver for responsive sizing
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect
          chart.applyOptions({ width, height })
        }
      })
      ro.observe(containerRef.current)
      ;(chart as unknown as Record<string, unknown>).__ro = ro

      // === ANIMATION LOOP (60fps rendering, ~7fps data ticks) ===
      lastFrameTimeRef.current = performance.now()
      lastDataTickRef.current = performance.now()

      function animate(now: number) {
        if (cancelled) return

        const dt = Math.min((now - lastFrameTimeRef.current) / 1000, 0.1)
        lastFrameTimeRef.current = now

        const target = targetPriceRef.current
        const displayed = displayedPriceRef.current

        if (target !== null && displayed !== null && series) {
          // Critically-damped spring (SmoothDamp) — smooths both position AND velocity
          // so the line makes U-curves instead of V-shaped direction changes
          let newPrice: number
          const diff = displayed - target
          if (Math.abs(diff) < 0.001 && Math.abs(velocityRef.current) < 0.001) {
            newPrice = target
            velocityRef.current = 0
          } else {
            const omega = 2.0 / SMOOTH_TIME
            const x = omega * dt
            const exp = 1.0 / (1.0 + x + 0.48 * x * x + 0.235 * x * x * x)
            const temp = (velocityRef.current + omega * diff) * dt
            velocityRef.current = (velocityRef.current - omega * temp) * exp
            newPrice = target + (diff + temp) * exp
          }
          displayedPriceRef.current = newPrice

          const sinceLastTick = now - lastDataTickRef.current
          if (sinceLastTick >= DATA_TICK_MS) {
            // Add a NEW data point — advances the X axis (line "crawls" forward)
            const timeSec = Date.now() / 1000
            if (timeSec > latestTimeRef.current) {
              latestTimeRef.current = timeSec
              series.update({
                time: timeSec as import('lightweight-charts').UTCTimestamp,
                value: newPrice,
              })
            }
            lastDataTickRef.current = now
          } else if (latestTimeRef.current > 0) {
            // Between ticks — update last point's Y for 60fps visual smoothness
            series.update({
              time: latestTimeRef.current as import('lightweight-charts').UTCTimestamp,
              value: newPrice,
            })
          }

          // Update current-price axis label
          if (currentPriceLineRef.current) {
            currentPriceLineRef.current.applyOptions({ price: newPrice })
          }
        }

        // Open price off-screen indicator + trend coloring
        const op = openPriceRef.current
        const ind = openIndicatorRef.current
        const ctr = containerRef.current
        let indicatorPos = 'hidden'
        if (op !== null && series && ctr) {
          const coord = series.priceToCoordinate(op)
          const h = ctr.clientHeight - 28
          if (coord !== null && coord < 0) indicatorPos = 'above'
          else if (coord !== null && coord > h) indicatorPos = 'below'
        }
        const isAbove = displayedPriceRef.current !== null && op !== null && displayedPriceRef.current >= op
        const trendColor = isAbove ? '#22C55E' : '#EF4444'
        const trendColorLine = isAbove ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)'
        const stateKey = `${indicatorPos}-${op}-${isAbove}`
        if (ind && stateKey !== indicatorStateRef.current) {
          indicatorStateRef.current = stateKey
          if (indicatorPos === 'above') {
            ind.style.display = 'flex'
            ind.style.top = '4px'
            ind.style.bottom = ''
            ind.textContent = 'Open ▲'
            ind.style.color = trendColor
          } else if (indicatorPos === 'below') {
            ind.style.display = 'flex'
            ind.style.top = ''
            ind.style.bottom = '28px'
            ind.textContent = 'Open ▼'
            ind.style.color = trendColor
          } else {
            ind.style.display = 'none'
          }
          // Hide price line label when off-screen indicator is visible (avoid duplicate "Open")
          if (priceLineRef.current) {
            if (indicatorPos === 'hidden') {
              priceLineRef.current.applyOptions({ title: 'Open', axisLabelVisible: true, color: trendColorLine, axisLabelColor: trendColor, axisLabelTextColor: '#000' })
            } else {
              priceLineRef.current.applyOptions({ title: '', axisLabelVisible: false, color: trendColorLine })
            }
          }
        }
        // Match native title text position: flush against left edge of price scale
        if (ind && indicatorPos !== 'hidden') {
          const pw = chart.priceScale('right').width()
          ind.style.right = `${pw}px`
        }

        rafIdRef.current = requestAnimationFrame(animate)
      }
      rafIdRef.current = requestAnimationFrame(animate)
    }

    init()

    return () => {
      cancelled = true
      cancelAnimationFrame(rafIdRef.current)
      if (chartRef.current) {
        const ro = (chartRef.current as unknown as Record<string, unknown>).__ro as ResizeObserver | undefined
        ro?.disconnect()
        chartRef.current.remove()
        chartRef.current = null
        seriesRef.current = null
        priceLineRef.current = null
        currentPriceLineRef.current = null

      }
      displayedPriceRef.current = null
      targetPriceRef.current = null
      velocityRef.current = 0
      latestTimeRef.current = 0
      lastDataTickRef.current = 0
    }
  }, []) // mount once

  // Keep openPrice accessible in animation loop via ref
  useEffect(() => {
    openPriceRef.current = openPrice
  }, [openPrice])

  // React to new price data from Pyth — update targets only (animate loop handles rendering)
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current || data.length === 0) return

    const latest = data[data.length - 1]

    // First point — bootstrap displayed price
    if (displayedPriceRef.current === null) {
      displayedPriceRef.current = latest.price
    }

    // Update the target — animate loop handles all chart rendering
    targetPriceRef.current = latest.price
  }, [data])

  // Update open price reference line + reset Y-range for new round
  useEffect(() => {
    if (!seriesRef.current) return

    async function updatePriceLine() {
      const { LineStyle } = await import('lightweight-charts')

      if (priceLineRef.current && seriesRef.current) {
        seriesRef.current.removePriceLine(priceLineRef.current)
        priceLineRef.current = null
      }

      if (openPrice && seriesRef.current) {
        priceLineRef.current = seriesRef.current.createPriceLine({
          price: openPrice,
          color: 'rgba(255, 255, 255, 0.4)',
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          axisLabelColor: '#27272a',
          axisLabelTextColor: '#000',
          title: 'Open',
        })
      }
    }

    updatePriceLine()
  }, [openPrice])

  return (
    <div className="relative w-full h-[220px] sm:h-[280px] lg:h-[320px]">
      <div ref={containerRef} className="w-full h-full" />
      <div
        ref={openIndicatorRef}
        style={{ display: 'none' }}
        className="absolute text-[9px] font-mono text-white/40 whitespace-nowrap pointer-events-none z-10 select-none"
      />
    </div>
  )
}
