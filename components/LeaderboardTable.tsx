'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { Footer } from './Footer'

// ============================================================================
// TYPES
// ============================================================================

interface LeaderboardEntry {
  rank: number
  address: string
  totalBets: number
  totalVolumeUsd: number
  wins: number
  losses: number
  winRate: number
  totalPnl: number
  roi: number
}

type SortBy = 'pnl' | 'volume' | 'winRate' | 'totalBets' | 'roi'

const SORT_OPTIONS: { key: SortBy; label: string }[] = [
  { key: 'pnl', label: 'P&L' },
  { key: 'volume', label: 'Volume' },
  { key: 'winRate', label: 'Win Rate' },
  { key: 'roi', label: 'ROI' },
  { key: 'totalBets', label: 'Predictions' },
]

// ============================================================================
// HELPERS
// ============================================================================

function shortenAddress(addr: string): string {
  if (addr.length <= 14) return addr
  return addr.slice(0, 8) + '...' + addr.slice(-6)
}

function formatUsd(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ============================================================================
// IDENTICON (same as ProfilePage.tsx)
// ============================================================================

function generateIdenticon(address: string): { grid: boolean[][]; color: string; bg: string } {
  let hash = 0
  for (let i = 0; i < address.length; i++) {
    hash = ((hash << 5) - hash) + address.charCodeAt(i)
    hash |= 0
  }

  const grid: boolean[][] = []
  for (let y = 0; y < 5; y++) {
    const row: boolean[] = []
    for (let x = 0; x < 3; x++) {
      row.push(((hash >> (y * 3 + x)) & 1) === 1)
    }
    grid.push([row[0], row[1], row[2], row[1], row[0]])
  }

  const hue = Math.abs(hash) % 360
  const color = `hsl(${hue}, 65%, 55%)`
  const bg = `hsl(${hue}, 20%, 15%)`

  return { grid, color, bg }
}

function MiniIdenticon({ address }: { address: string }) {
  const { grid, color, bg } = generateIdenticon(address)
  return (
    <div
      className="w-7 h-7 rounded-lg grid grid-cols-5 grid-rows-5 gap-px p-0.5 shrink-0"
      style={{ backgroundColor: bg }}
    >
      {grid.flat().map((filled, i) => (
        <div
          key={i}
          className="rounded-[1px]"
          style={{ backgroundColor: filled ? color : 'transparent' }}
        />
      ))}
    </div>
  )
}

// ============================================================================
// RANK BADGE
// ============================================================================

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-sm font-bold text-yellow-400">1</span>
  if (rank === 2) return <span className="text-sm font-bold text-zinc-400">2</span>
  if (rank === 3) return <span className="text-sm font-bold text-amber-600">3</span>
  return <span className="text-sm text-zinc-500">{rank}</span>
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function LeaderboardTable() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [total, setTotal] = useState(0)
  const [sortBy, setSortBy] = useState<SortBy>('pnl')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const PAGE_SIZE = 50

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const fetchLeaderboard = useCallback(async (s: SortBy, p: number, append: boolean, search?: string) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError(null)

    try {
      let url = `/api/leaderboard?sortBy=${s}&page=${p}&pageSize=${PAGE_SIZE}`
      if (search) url += `&search=${encodeURIComponent(search)}`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch leaderboard')
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Failed')

      if (append) {
        setEntries((prev) => [...prev, ...data.entries])
      } else {
        setEntries(data.entries)
      }
      setTotal(data.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load leaderboard')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    setPage(1)
    fetchLeaderboard(sortBy, 1, false, debouncedSearch || undefined)
  }, [sortBy, debouncedSearch, fetchLeaderboard])

  const loadMore = () => {
    if (loadingMore) return
    const next = page + 1
    setPage(next)
    fetchLeaderboard(sortBy, next, true, debouncedSearch || undefined)
  }

  const hasMore = entries.length < total

  return (
    <main className="min-h-screen bg-zinc-950">
      <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Page title */}
        <div className="mb-6">
          <h1 className="text-zinc-200 font-semibold text-lg sm:text-xl">Leaderboard</h1>
          <p className="text-zinc-500 text-xs mt-1">
            Top predictors ranked by performance. Click any predictor to view their full profile.
          </p>
        </div>

        {/* Search bar */}
        <div className="relative mb-4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by wallet address..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-8 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors font-mono"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); searchInputRef.current?.focus() }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Sort tabs */}
        <div className="flex items-center gap-1 mb-4 overflow-x-auto">
          {SORT_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors whitespace-nowrap ${
                sortBy === key
                  ? 'bg-zinc-800 text-zinc-200 font-medium'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
              }`}
            >
              {label}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-zinc-600">
            {debouncedSearch
              ? `${total} result${total !== 1 ? 's' : ''}`
              : `${total} predictor${total !== 1 ? 's' : ''}`
            }
          </span>
        </div>

        {/* Error */}
        {error && (
          <div className="text-sm text-red-400/80 bg-red-500/5 rounded-xl px-4 py-3 border border-red-500/10 mb-4">
            {error}
          </div>
        )}

        {/* Table */}
        <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 overflow-hidden">
          {/* Desktop header */}
          <div className="hidden sm:grid grid-cols-[2.5rem_1fr_3.5rem_5.5rem_5.5rem_3.5rem_5.5rem_4rem] gap-2 px-4 py-2.5 text-[10px] text-zinc-600 font-medium uppercase tracking-wider border-b border-zinc-800/50">
            <span>#</span>
            <span>Predictor</span>
            <span className="text-right">Predictions</span>
            <span className="text-right">Volume</span>
            <span className="text-right">W / L</span>
            <span className="text-right">Win%</span>
            <span className="text-right">P&L</span>
            <span className="text-right">ROI</span>
          </div>

          {/* Loading skeleton */}
          {loading && (
            <div className="divide-y divide-zinc-800/50">
              {[...Array(10)].map((_, i) => (
                <div key={i} className="px-4 py-3 flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg bg-zinc-800 animate-pulse" />
                  <div className="flex-1 h-4 bg-zinc-800 rounded animate-pulse" />
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading && entries.length === 0 && !error && !debouncedSearch && (
            <div className="text-center py-16 text-zinc-600 text-sm">
              No predictors found yet. Place the first prediction!
            </div>
          )}
          {!loading && entries.length === 0 && !error && debouncedSearch && (
            <div className="text-center py-12 text-zinc-600 text-sm">
              {debouncedSearch.trim().length >= 30 ? (
                <>
                  <p className="mb-3">No predictor found matching this address.</p>
                  <Link
                    href={`/profile/${debouncedSearch.trim()}`}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors"
                  >
                    View profile for this address
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                    </svg>
                  </Link>
                </>
              ) : (
                <p>No predictors matching &ldquo;{debouncedSearch}&rdquo;</p>
              )}
            </div>
          )}

          {/* Rows */}
          {!loading && entries.map((entry) => (
            <Link
              key={entry.address}
              href={`/profile/${entry.address}`}
              className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800/50 last:border-b-0 hover:bg-zinc-800/20 transition-colors group"
            >
              {/* Mobile layout */}
              <div className="sm:hidden flex items-center gap-3 w-full">
                <div className="w-6 text-center shrink-0">
                  <RankBadge rank={entry.rank} />
                </div>
                <MiniIdenticon address={entry.address} />
                <div className="flex-1 min-w-0">
                  <div className="text-zinc-300 font-mono text-xs truncate group-hover:text-zinc-100 transition-colors">
                    {shortenAddress(entry.address)}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-zinc-500 mt-0.5">
                    <span>{entry.totalBets} predictions</span>
                    <span>{(entry.winRate * 100).toFixed(0)}%</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`text-xs font-mono font-medium ${
                    entry.totalPnl >= 0 ? 'text-up' : 'text-down'
                  }`}>
                    {entry.totalPnl >= 0 ? '+' : ''}${formatUsd(Math.abs(entry.totalPnl))}
                  </div>
                  <div className={`text-[11px] font-mono ${
                    entry.roi >= 0 ? 'text-up/60' : 'text-down/60'
                  }`}>
                    {entry.roi >= 0 ? '+' : ''}{(entry.roi * 100).toFixed(1)}%
                  </div>
                </div>
              </div>

              {/* Desktop layout */}
              <div className="hidden sm:grid grid-cols-[2.5rem_1fr_3.5rem_5.5rem_5.5rem_3.5rem_5.5rem_4rem] gap-2 items-center w-full">
                <div className="text-center">
                  <RankBadge rank={entry.rank} />
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <MiniIdenticon address={entry.address} />
                  <span className="text-zinc-300 font-mono text-xs truncate group-hover:text-zinc-100 transition-colors">
                    {shortenAddress(entry.address)}
                  </span>
                </div>
                <span className="text-zinc-400 text-xs font-mono text-right">
                  {entry.totalBets}
                </span>
                <span className="text-zinc-400 text-xs font-mono text-right">
                  ${formatUsd(entry.totalVolumeUsd)}
                </span>
                <span className="text-xs text-right">
                  <span className="text-up">{entry.wins}W</span>
                  <span className="text-zinc-600"> - </span>
                  <span className="text-down">{entry.losses}L</span>
                </span>
                <span className="text-zinc-300 text-xs font-mono text-right">
                  {(entry.winRate * 100).toFixed(0)}%
                </span>
                <span className={`text-xs font-mono font-medium text-right ${
                  entry.totalPnl >= 0 ? 'text-up' : 'text-down'
                }`}>
                  {entry.totalPnl >= 0 ? '+' : ''}${formatUsd(Math.abs(entry.totalPnl))}
                </span>
                <span className={`text-xs font-mono text-right ${
                  entry.roi >= 0 ? 'text-up/70' : 'text-down/70'
                }`}>
                  {entry.roi >= 0 ? '+' : ''}{(entry.roi * 100).toFixed(1)}%
                </span>
              </div>
            </Link>
          ))}

          {/* Load more */}
          {hasMore && !loading && (
            <button
              onClick={(e) => { e.preventDefault(); loadMore() }}
              disabled={loadingMore}
              className="w-full py-3 text-xs text-zinc-500 hover:text-zinc-300 border-t border-zinc-800/50 transition-colors disabled:opacity-50"
            >
              {loadingMore ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-3 w-3 border border-zinc-500 border-t-transparent rounded-full animate-spin" />
                  Loading...
                </span>
              ) : (
                `Show more (${entries.length} of ${total})`
              )}
            </button>
          )}
        </div>

        <Footer />
      </div>
    </main>
  )
}
