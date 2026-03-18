/**
 * Agent Leaderboard — GET /api/agent/leaderboard
 *
 * Public ranking of registered agents by PnL, win rate, volume, or ROI.
 */

import { NextRequest, NextResponse } from 'next/server'
import { listAgentKeys } from '@/lib/agent-keys'
import { getWalletProfile } from '@/lib/round-indexer'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const sort = req.nextUrl.searchParams.get('sort') || 'pnl'
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') || '1'))
  const pageSize = Math.min(50, Math.max(1, parseInt(req.nextUrl.searchParams.get('pageSize') || '20')))

  try {
    // Get all registered agents
    const agents = await listAgentKeys(1, 200) // Max 200 agents for now

    // Fetch stats for each agent
    const entries = await Promise.all(
      agents
        .filter(a => a.wallet)
        .map(async (agent) => {
          try {
            const profile = await getWalletProfile(agent.wallet, 1, 1)
            return {
              name: agent.name || 'Anonymous Agent',
              prefix: agent.keyPrefix,
              wallet: agent.wallet,
              stats: {
                totalBets: profile.stats.totalBets,
                winRate: profile.stats.winRate,
                totalPnlUsd: profile.stats.totalPnl,
                roi: profile.stats.roi,
                totalVolumeUsd: profile.stats.totalVolumeUsd,
                activeSince: agent.createdAt,
                lastActive: agent.lastUsed,
              },
              rank: 0,
            }
          } catch {
            return null
          }
        })
    )

    const validEntries = entries.filter(Boolean) as NonNullable<typeof entries[number]>[]

    // Sort
    const sortFn: Record<string, (a: typeof validEntries[0], b: typeof validEntries[0]) => number> = {
      pnl: (a, b) => b.stats.totalPnlUsd - a.stats.totalPnlUsd,
      winRate: (a, b) => b.stats.winRate - a.stats.winRate,
      volume: (a, b) => b.stats.totalVolumeUsd - a.stats.totalVolumeUsd,
      roi: (a, b) => b.stats.roi - a.stats.roi,
    }

    validEntries.sort(sortFn[sort] || sortFn.pnl)

    // Assign ranks
    validEntries.forEach((e, i) => { e.rank = i + 1 })

    // Paginate
    const start = (page - 1) * pageSize
    const paged = validEntries.slice(start, start + pageSize)

    return NextResponse.json({
      ok: true,
      sort,
      total: validEntries.length,
      page,
      pageSize,
      entries: paged,
    })
  } catch (err) {
    console.error('[agent/leaderboard] Error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to fetch leaderboard' }, { status: 500 })
  }
}
