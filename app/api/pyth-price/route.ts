import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const BENCHMARKS_URL = 'https://benchmarks.pyth.network'

/**
 * Proxy for Pyth Benchmarks API (historical prices)
 * Avoids CORS issues by fetching server-side
 *
 * Query params:
 * - timestamp: Unix timestamp in seconds
 * - OR from/to: Range for TradingView format
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const timestamp = searchParams.get('timestamp')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  // Validate inputs
  if (!timestamp && (!from || !to)) {
    return NextResponse.json(
      { error: 'Missing timestamp or from/to params', ok: false },
      { status: 400 }
    )
  }

  try {
    let fromTs: number
    let toTs: number

    if (timestamp) {
      // Single timestamp - create a range around it
      const ts = parseInt(timestamp)
      if (isNaN(ts)) {
        return NextResponse.json(
          { error: 'Invalid timestamp', ok: false },
          { status: 400 }
        )
      }
      fromTs = ts - 120 // 2 minutes before
      toTs = ts + 60    // 1 minute after
    } else {
      fromTs = parseInt(from!)
      toTs = parseInt(to!)
      if (isNaN(fromTs) || isNaN(toTs)) {
        return NextResponse.json(
          { error: 'Invalid from/to values', ok: false },
          { status: 400 }
        )
      }
    }

    // Call Pyth Benchmarks TradingView API
    const url = `${BENCHMARKS_URL}/v1/shims/tradingview/history?symbol=Crypto.BTC/USD&resolution=1&from=${fromTs}&to=${toTs}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s timeout

    let response: Response
    try {
      response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'BitPredix/1.0'
        },
        signal: controller.signal
      })
    } catch (fetchError) {
      clearTimeout(timeoutId)
      // Handle timeout or network error
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        console.error('[pyth-price] Request timeout')
        return NextResponse.json(
          { error: 'Request timeout - Pyth API unavailable', ok: false },
          { status: 504 }
        )
      }
      console.error('[pyth-price] Network error:', fetchError instanceof Error ? fetchError.message : fetchError)
      return NextResponse.json(
        { error: 'Network error - unable to reach Pyth API', ok: false },
        { status: 503 }
      )
    }

    clearTimeout(timeoutId)

    if (!response.ok) {
      console.error(`[pyth-price] Benchmarks API error: ${response.status}`)
      return NextResponse.json(
        { error: `Pyth API error: ${response.status}`, ok: false },
        { status: 502 }
      )
    }

    const data = await response.json()

    // TradingView format: { s: "ok", t: [timestamps], c: [close], o: [open], h: [high], l: [low], v: [volume] }
    if (data.s !== 'ok' || !data.c || data.c.length === 0) {
      // No data available - might be too recent or too old
      console.error('[pyth-price] No price data available:', data)
      return NextResponse.json(
        { error: 'No price data available for this timestamp', ok: false, noData: true },
        { status: 404 }
      )
    }

    // Return the candles data
    return NextResponse.json({
      ok: true,
      timestamps: data.t,
      close: data.c,
      open: data.o,
      high: data.h,
      low: data.l,
      // Also include the last price for convenience
      lastPrice: data.c[data.c.length - 1],
      lastTimestamp: data.t[data.t.length - 1]
    })
  } catch (e) {
    console.error('[pyth-price] Unexpected error:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to fetch price', ok: false },
      { status: 500 }
    )
  }
}
