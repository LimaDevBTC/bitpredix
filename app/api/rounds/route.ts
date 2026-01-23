import { listRecentRounds } from '@/lib/rounds'
import { getPriceUp, getPriceDown } from '@/lib/amm'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** GET: listar rodadas recentes */
export async function GET() {
  try {
    const rounds = listRecentRounds(20)
    const data = rounds.map((r) => ({
      ...r,
      priceUp: getPriceUp(r.pool),
      priceDown: getPriceDown(r.pool),
    }))
    return NextResponse.json({ rounds: data, ok: true })
  } catch (e) {
    return NextResponse.json(
      { error: 'Failed to list rounds', ok: false },
      { status: 500 }
    )
  }
}
