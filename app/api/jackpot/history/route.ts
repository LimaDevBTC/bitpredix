import { NextResponse } from 'next/server'
import { getRecentDraws } from '@/lib/jackpot'

export const dynamic = 'force-dynamic'

/**
 * GET /api/jackpot/history
 * Returns the last 7 draw results.
 */
export async function GET() {
  try {
    const draws = await getRecentDraws(7)
    return NextResponse.json({ ok: true, draws })
  } catch {
    return NextResponse.json({ ok: false, error: 'Failed to fetch draw history' }, { status: 500 })
  }
}
