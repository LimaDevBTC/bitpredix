'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface IndexedBet {
  txId: string
  user: string
  side: 'UP' | 'DOWN'
  amountUsd: number
  timestamp: number
  status: string
}

interface IndexedRound {
  roundId: number
  startTimestamp: number
  totalUpUsd: number
  totalDownUsd: number
  totalPoolUsd: number
  resolved: boolean
  outcome: 'UP' | 'DOWN' | null
  priceStart: number | null
  priceEnd: number | null
  bets: IndexedBet[]
  participantCount: number
}

function timeAgo(ts: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - ts
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(ts * 1000).toLocaleDateString()
}

function formatUsd(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function RecentRounds() {
  const [rounds, setRounds] = useState<IndexedRound[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchRecent = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/round-history?page=1&pageSize=5')
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Unknown error')
      setRounds(data.rounds || [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRecent()
    const id = setInterval(fetchRecent, 30_000)
    return () => clearInterval(id)
  }, [fetchRecent])

  // Listen for new bets/claims
  useEffect(() => {
    const onUpdate = () => {
      setTimeout(fetchRecent, 5000)
    }
    window.addEventListener('bitpredix:balance-changed', onUpdate)
    return () => window.removeEventListener('bitpredix:balance-changed', onUpdate)
  }, [fetchRecent])

  return (
    <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5 text-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-zinc-300">Recent Rounds</h3>
        <div className="flex items-center gap-2">
          <Link
            href="/history"
            className="text-xs text-zinc-500 hover:text-bitcoin transition-colors"
          >
            View all rounds &rarr;
          </Link>
          <button
            onClick={fetchRecent}
            disabled={loading}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-50"
            title="Refresh"
          >
            {loading ? '...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-400/80 mb-3 bg-red-500/5 rounded-lg px-3 py-2 border border-red-500/10">
          {error}
        </div>
      )}

      {loading && rounds.length === 0 && !error && (
        <div className="flex items-center gap-2 text-zinc-500 text-xs py-4 justify-center">
          <div className="h-3 w-3 border border-zinc-500 border-t-transparent rounded-full animate-spin" />
          Indexing rounds...
        </div>
      )}

      {!loading && rounds.length === 0 && !error && (
        <p className="text-zinc-500 text-xs">No rounds found yet. Make a prediction to start!</p>
      )}

      {rounds.length > 0 && (
        <div className="space-y-1.5">
          {rounds.map((round) => {
            const upPct = round.totalPoolUsd > 0
              ? (round.totalUpUsd / round.totalPoolUsd) * 100
              : 50

            return (
              <Link
                key={round.roundId}
                href={`/history?round=${round.roundId}`}
                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-900/80 border border-zinc-800/50 hover:border-zinc-700/50 transition-colors group"
              >
                {/* Outcome badge */}
                <div
                  className={`shrink-0 w-8 h-8 rounded-lg border flex items-center justify-center text-xs font-bold ${
                    round.outcome === 'UP'
                      ? 'text-up bg-up/10 border-up/30'
                      : round.outcome === 'DOWN'
                        ? 'text-down bg-down/10 border-down/30'
                        : 'text-zinc-400 bg-zinc-400/10 border-zinc-400/30'
                  }`}
                >
                  {round.outcome === 'UP' ? 'UP' : round.outcome === 'DOWN' ? 'DN' : '?'}
                </div>

                {/* Round info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-200 font-medium text-xs">
                      Round {round.roundId}
                    </span>
                    <span className="text-zinc-600 text-[10px]">
                      {round.participantCount} predictor{round.participantCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {/* Pool bar */}
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className="flex-1 h-1 rounded-full overflow-hidden flex bg-zinc-800">
                      <div
                        className="bg-up/70 transition-all"
                        style={{ width: `${upPct}%` }}
                      />
                      <div
                        className="bg-down/70 transition-all"
                        style={{ width: `${100 - upPct}%` }}
                      />
                    </div>
                    <span className="text-zinc-500 text-[10px] shrink-0">
                      ${formatUsd(round.totalPoolUsd)}
                    </span>
                  </div>
                </div>

                {/* Time */}
                <div className="shrink-0 text-zinc-600 text-[10px]">
                  {round.startTimestamp > 0 ? timeAgo(round.startTimestamp) : '...'}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}
