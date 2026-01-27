import { getRound } from '@/lib/rounds'
import { getPriceUp, getPriceDown } from '@/lib/amm'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const ROUND_DURATION_MS = 60 * 1000

/** GET: obter uma rodada por ID (útil quando se perde o resolvedRound no fluxo) */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const round = getRound(id)
    if (!round) {
      return NextResponse.json({ error: 'Round not found', ok: false }, { status: 404 })
    }
    const priceUp = getPriceUp(round.pool)
    const priceDown = getPriceDown(round.pool)
    const endsAt = round.startAt + ROUND_DURATION_MS
    return NextResponse.json({
      round: {
        id: round.id,
        startAt: round.startAt,
        endsAt,
        tradingClosesAt: round.tradingClosesAt ?? endsAt,
        priceAtStart: round.priceAtStart,
        priceAtEnd: round.priceAtEnd,
        outcome: round.outcome,
        status: round.status,
        pool: round.pool,
      },
      priceUp,
      priceDown,
      ok: true,
    })
  } catch (e) {
    return NextResponse.json(
      { error: 'Failed to load round', ok: false },
      { status: 500 }
    )
  }
}
