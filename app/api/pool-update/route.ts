import { NextRequest, NextResponse } from 'next/server'
import { addOptimisticBet } from '@/lib/pool-store'

export const dynamic = 'force-dynamic'

const TRADING_WINDOW_S = 50 // matches TRADING_WINDOW in predixv3

/** Clients call this immediately after broadcasting a bet tx. */
export async function POST(request: NextRequest) {
  try {
    const { roundId, side, amountMicro, tradeId: clientTradeId } = await request.json()

    if (typeof roundId !== 'number' || roundId <= 0) {
      return NextResponse.json({ error: 'invalid roundId' }, { status: 400 })
    }
    if (side !== 'UP' && side !== 'DOWN') {
      return NextResponse.json({ error: 'invalid side' }, { status: 400 })
    }
    if (typeof amountMicro !== 'number' || amountMicro <= 0) {
      return NextResponse.json({ error: 'invalid amountMicro' }, { status: 400 })
    }

    // Reject updates for closed rounds
    const now = Date.now()
    const roundStartMs = roundId * 60 * 1000
    const tradingCloseMs = roundStartMs + TRADING_WINDOW_S * 1000
    if (now > tradingCloseMs) {
      return NextResponse.json({ error: 'Round trading window closed' }, { status: 400 })
    }

    const tradeId = await addOptimisticBet(
      roundId,
      side,
      amountMicro,
      typeof clientTradeId === 'string' ? clientTradeId : undefined,
    )

    return NextResponse.json({ ok: true, tradeId })
  } catch (err) {
    // If Redis is down, return 503
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed') || msg.includes('Redis')) {
      return NextResponse.json({ error: 'Service unavailable (Redis)' }, { status: 503 })
    }
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }
}
