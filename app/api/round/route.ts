import { getOrCreateCurrentRound } from '@/lib/rounds'
import { fetchBtcPriceUsd } from '@/lib/btc-price'
import { getPriceUp, getPriceDown } from '@/lib/amm'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const ROUND_DURATION_MS = 60 * 1000

function roundToJson(r: { id: string; startAt: number; endsAt: number; tradingClosesAt?: number; priceAtStart: number; priceAtEnd?: number; outcome?: string; status: string; pool: object }) {
  const endsAt = r.startAt + ROUND_DURATION_MS
  return {
    id: r.id,
    startAt: r.startAt,
    endsAt,
    tradingClosesAt: r.tradingClosesAt ?? endsAt,
    priceAtStart: r.priceAtStart,
    priceAtEnd: r.priceAtEnd,
    outcome: r.outcome,
    status: r.status,
    pool: r.pool,
  }
}

/** GET: obter/criar rodada atual e preços. Se acabou de resolver, inclui resolvedRound. */
export async function GET() {
  try {
    const result = await getOrCreateCurrentRound(fetchBtcPriceUsd)
    const { round, resolvedRound } = result
    const priceUp = getPriceUp(round.pool)
    const priceDown = getPriceDown(round.pool)
    return NextResponse.json({
      round: roundToJson(round),
      resolvedRound: resolvedRound ? roundToJson(resolvedRound) : undefined,
      priceUp,
      priceDown,
      serverNow: Date.now(),
      ok: true,
    })
  } catch (e) {
    return NextResponse.json(
      { error: 'Failed to load round', ok: false },
      { status: 500 }
    )
  }
}

/** POST: comprar shares (body: { side: 'UP'|'DOWN', amountUsd: number }) */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { side, amountUsd, roundId } = body as {
      side?: 'UP' | 'DOWN'
      amountUsd?: number
      roundId?: string
    }

    if (!side || !['UP', 'DOWN'].includes(side)) {
      return NextResponse.json(
        { error: 'side must be UP or DOWN', ok: false },
        { status: 400 }
      )
    }
    const amount = typeof amountUsd === 'number' ? amountUsd : parseFloat(String(amountUsd ?? ''))
    if (isNaN(amount) || amount <= 0) {
      return NextResponse.json(
        { error: 'amountUsd must be a positive number', ok: false },
        { status: 400 }
      )
    }

    const { executeTrade, getOrCreateCurrentRound, getRound } = await import('@/lib/rounds')
    const round = roundId
      ? getRound(roundId)
      : (await getOrCreateCurrentRound(await import('@/lib/btc-price').then((m) => m.fetchBtcPriceUsd))).round
    if (!round) {
      return NextResponse.json({ error: 'Round not found', ok: false }, { status: 404 })
    }

    const result = executeTrade(round.id, side, amount)
    if (!result.success) {
      return NextResponse.json(
        { error: result.error ?? 'Execution error', ok: false },
        { status: 400 }
      )
    }

    const priceUp = getPriceUp(round.pool)
    const priceDown = getPriceDown(round.pool)
    return NextResponse.json({
      success: true,
      roundId: round.id,
      side,
      sharesReceived: result.sharesReceived,
      pricePerShare: result.pricePerShare,
      priceUp,
      priceDown,
      pool: round.pool,
      serverNow: Date.now(),
      ok: true,
    })
  } catch (e) {
    return NextResponse.json(
      { error: 'Error processing trade', ok: false },
      { status: 500 }
    )
  }
}
