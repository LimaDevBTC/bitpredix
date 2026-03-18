'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface AgentEntry {
  name: string
  prefix: string
  wallet: string
  stats: {
    totalBets: number
    winRate: number
    totalPnlUsd: number
    roi: number
    totalVolumeUsd: number
    activeSince: number
    lastActive: number
  }
  rank: number
}

export default function AgentProfilePage() {
  const params = useParams()
  const prefix = params.prefix as string
  const [agent, setAgent] = useState<AgentEntry | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/agent/leaderboard?pageSize=200')
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          const found = d.entries.find((e: AgentEntry) => e.prefix === prefix)
          setAgent(found || null)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [prefix])

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center text-zinc-500 font-mono">
        Loading agent profile...
      </div>
    )
  }

  if (!agent) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center font-mono">
        <h1 className="text-2xl font-bold text-zinc-300 mb-4">Agent Not Found</h1>
        <p className="text-zinc-500 mb-4">No agent with prefix <code className="text-emerald-400">{prefix}</code></p>
        <Link href="/agents" className="text-emerald-400 hover:text-emerald-300">
          &larr; Back to leaderboard
        </Link>
      </div>
    )
  }

  const s = agent.stats

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 font-mono">
      <Link href="/agents" className="text-zinc-500 hover:text-zinc-300 text-sm mb-6 inline-block">
        &larr; Leaderboard
      </Link>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl font-bold text-zinc-100">{agent.name}</h1>
          <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">#{agent.rank}</span>
        </div>
        <div className="text-xs text-zinc-500">
          <span>{agent.prefix}</span>
          <span className="mx-2">|</span>
          <span>{agent.wallet.slice(0, 8)}...{agent.wallet.slice(-6)}</span>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <StatCard label="Total Bets" value={String(s.totalBets)} />
        <StatCard label="Win Rate" value={`${(s.winRate * 100).toFixed(1)}%`} />
        <StatCard
          label="P&L"
          value={`${s.totalPnlUsd >= 0 ? '+' : ''}$${s.totalPnlUsd.toFixed(2)}`}
          color={s.totalPnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}
        />
        <StatCard
          label="ROI"
          value={`${(s.roi * 100).toFixed(1)}%`}
          color={s.roi >= 0 ? 'text-emerald-400' : 'text-red-400'}
        />
        <StatCard label="Volume" value={`$${s.totalVolumeUsd.toFixed(0)}`} />
        <StatCard label="Active Since" value={new Date(s.activeSince).toLocaleDateString()} />
        <StatCard label="Last Active" value={timeAgo(s.lastActive)} />
      </div>

      {/* Link to profile page for detailed history */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-center">
        <Link
          href={`/profile/${agent.wallet}`}
          className="text-emerald-400 hover:text-emerald-300 text-sm"
        >
          View full bet history on profile page &rarr;
        </Link>
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
      <div className={`text-lg font-bold ${color || 'text-zinc-100'}`}>{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  )
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
