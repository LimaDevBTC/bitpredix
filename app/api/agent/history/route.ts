import { NextRequest, NextResponse } from 'next/server'
import { getWalletProfile } from '@/lib/round-indexer'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')
  if (!address) {
    return NextResponse.json({ ok: false, error: 'address query param required' }, { status: 400 })
  }

  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') || '1'))
  const pageSize = Math.min(50, Math.max(1, parseInt(req.nextUrl.searchParams.get('pageSize') || '20')))

  try {
    const profile = await getWalletProfile(address, page, pageSize)

    return NextResponse.json({
      ok: true,
      address: profile.address,
      stats: {
        totalBets: profile.stats.totalBets,
        wins: profile.stats.wins,
        losses: profile.stats.losses,
        pending: profile.stats.pending,
        winRate: profile.stats.winRate,
        totalVolumeUsd: profile.stats.totalVolumeUsd,
        totalPnlUsd: profile.stats.totalPnl,
        roi: profile.stats.roi,
        bestWin: profile.stats.bestWin,
        worstLoss: profile.stats.worstLoss,
        avgBetSize: profile.stats.avgBetSize,
        currentStreak: profile.stats.currentStreak,
      },
      bets: profile.recentBets.map(b => ({
        roundId: b.roundId,
        side: b.side,
        amountUsd: b.amountUsd,
        outcome: b.outcome,
        resolved: b.resolved,
        pnl: b.pnl,
        timestamp: b.timestamp,
        txId: b.txId,
      })),
      totalBetRecords: profile.totalBetRecords,
      page,
      pageSize,
    })
  } catch (err) {
    console.error('[agent/history] Error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to fetch history' }, { status: 500 })
  }
}
