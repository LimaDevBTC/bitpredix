/**
 * Agent Ecosystem Stats — GET /api/agent/stats
 *
 * Global stats: total agents, active agents, agent volume share.
 */

import { NextRequest, NextResponse } from 'next/server'
import { listAgentKeys } from '@/lib/agent-keys'
import { withAgentAuth } from '@/lib/agent-auth'

export const dynamic = 'force-dynamic'

export const GET = (req: NextRequest) =>
  withAgentAuth(req, async () => {
  try {
    const agents = await listAgentKeys(1, 200)

    const now = Date.now()
    const oneDayAgo = now - 24 * 60 * 60 * 1000

    const activeAgents24h = agents.filter(a => a.lastUsed > oneDayAgo).length
    const totalVolume = agents.reduce((sum, a) => sum + a.totalVolumeUsd, 0)
    const activeVolume24h = agents
      .filter(a => a.lastUsed > oneDayAgo)
      .reduce((sum, a) => sum + a.totalVolumeUsd, 0)

    // Top agent by volume
    const topAgent = agents.length > 0
      ? agents.reduce((best, a) => a.totalVolumeUsd > best.totalVolumeUsd ? a : best)
      : null

    return NextResponse.json({
      ok: true,
      totalAgents: agents.length,
      activeAgents24h,
      totalVolumeUsd: totalVolume,
      agentVolume24hUsd: activeVolume24h,
      topAgent: topAgent ? {
        name: topAgent.name || 'Anonymous Agent',
        prefix: topAgent.keyPrefix,
        wallet: topAgent.wallet,
        totalVolumeUsd: topAgent.totalVolumeUsd,
      } : null,
    })
  } catch (err) {
    console.error('[agent/stats] Error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to fetch stats' }, { status: 500 })
  }
  }, { requireAuth: false })
