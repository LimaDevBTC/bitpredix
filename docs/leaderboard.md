# Leaderboard Page — Complete Implementation Spec

## Overview

Create a **Leaderboard page** (`/leaderboard`) that ranks all traders by performance metrics. Each row links to the trader's `/profile/[address]`. Add a trophy icon to the shared `AppHeader` nav.

**Zero new dependencies** — uses existing round-indexer data and design patterns.

---

## App Context

- **Stack**: Next.js 14 App Router, React 19, TailwindCSS 3.4, TypeScript
- **Design system**: Dark theme, zinc-950 bg, up=#22C55E, down=#EF4444, bitcoin=#F7931A
- **Fonts**: Outfit (sans body), JetBrains Mono (mono for numbers/prices)
- **Card pattern**: `bg-zinc-900/50 rounded-xl border border-zinc-800 p-4 sm:p-5`
- **Data source**: `lib/round-indexer.ts` — in-memory singleton `roundsIndex` with all rounds and bets

---

## Current State (what exists)

### `lib/round-indexer.ts` — Data layer
- `roundsIndex: Map<number, IndexedRound>` — all indexed rounds with bets
- `getWalletStats(address)` — returns `WalletStats` (totalBets, volume, wins, losses, winRate)
- `getWalletProfile(address, page, pageSize)` — returns full `WalletProfile` (stats + PnL + ROI + streaks)
- **No leaderboard function exists yet** — needs a new export that iterates all rounds, collects unique addresses, computes stats for each, and returns a sorted array

### `components/AppHeader.tsx` — Shared header
Currently has 2 nav icons: History (chart-bar) and Profile (user silhouette). Leaderboard icon (trophy) needs to be added between them.

### `components/ProfilePage.tsx` — Identicon generator
Has `generateIdenticon(address)` and `Identicon` component that creates a 5x5 grid avatar from address hash. This should be reused in the leaderboard rows.

---

## File Structure

```
NEW FILES:
  app/api/leaderboard/route.ts            — API endpoint
  app/leaderboard/page.tsx                 — Page route
  components/LeaderboardTable.tsx          — Client component (table + sorting + pagination)

MODIFIED FILES:
  lib/round-indexer.ts                     — Add getLeaderboard() export
  components/AppHeader.tsx                 — Add trophy icon to nav
```

---

## Step 1: Add `getLeaderboard()` to `lib/round-indexer.ts`

### New Types

```typescript
export interface LeaderboardEntry {
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

export type LeaderboardSortBy = 'pnl' | 'volume' | 'winRate' | 'totalBets' | 'roi'
```

### New Export

Add after `getWalletProfile()`:

```typescript
export function getLeaderboard(
  sortBy: LeaderboardSortBy = 'pnl',
  page: number = 1,
  pageSize: number = 50
): { entries: LeaderboardEntry[]; total: number } {
  // 1. Collect all unique addresses from roundsIndex
  const statsMap = new Map<string, {
    totalBets: number
    totalVolumeUsd: number
    wins: number
    losses: number
    totalPnl: number
  }>()

  for (const round of roundsIndex.values()) {
    for (const bet of round.bets) {
      if (bet.status !== 'success') continue

      let entry = statsMap.get(bet.user)
      if (!entry) {
        entry = { totalBets: 0, totalVolumeUsd: 0, wins: 0, losses: 0, totalPnl: 0 }
        statsMap.set(bet.user, entry)
      }

      entry.totalBets++
      entry.totalVolumeUsd += bet.amountUsd

      if (round.resolved && round.outcome) {
        if (bet.side === round.outcome) {
          entry.wins++
          const winningPool = round.outcome === 'UP' ? round.totalUpUsd : round.totalDownUsd
          if (winningPool > 0) {
            const grossPayout = (bet.amountUsd / winningPool) * round.totalPoolUsd
            const fee = grossPayout * 0.03
            entry.totalPnl += grossPayout - fee - bet.amountUsd
          }
        } else {
          entry.losses++
          entry.totalPnl -= bet.amountUsd
        }
      }
    }
  }

  // 2. Convert to LeaderboardEntry array
  const entries: Omit<LeaderboardEntry, 'rank'>[] = []
  for (const [address, s] of statsMap) {
    const decided = s.wins + s.losses
    entries.push({
      address,
      totalBets: s.totalBets,
      totalVolumeUsd: s.totalVolumeUsd,
      wins: s.wins,
      losses: s.losses,
      winRate: decided > 0 ? s.wins / decided : 0,
      totalPnl: s.totalPnl,
      roi: s.totalVolumeUsd > 0 ? s.totalPnl / s.totalVolumeUsd : 0,
    })
  }

  // 3. Sort
  const sortFns: Record<LeaderboardSortBy, (a: typeof entries[0], b: typeof entries[0]) => number> = {
    pnl: (a, b) => b.totalPnl - a.totalPnl,
    volume: (a, b) => b.totalVolumeUsd - a.totalVolumeUsd,
    winRate: (a, b) => b.winRate - a.winRate || b.totalBets - a.totalBets,
    totalBets: (a, b) => b.totalBets - a.totalBets,
    roi: (a, b) => b.roi - a.roi || b.totalVolumeUsd - a.totalVolumeUsd,
  }
  entries.sort(sortFns[sortBy])

  // 4. Paginate and assign ranks
  const total = entries.length
  const start = (page - 1) * pageSize
  const paged = entries.slice(start, start + pageSize).map((e, i) => ({
    ...e,
    rank: start + i + 1,
  }))

  return { entries: paged, total }
}
```

### Key Details
- Iterates `roundsIndex` once, collecting per-address stats in a Map — O(total bets)
- PnL calculation mirrors `getWalletProfile()` logic (same formula: gross payout - 3% fee - cost)
- `winRate` sort uses `totalBets` as tiebreaker (more bets = higher confidence)
- `roi` sort uses `totalVolumeUsd` as tiebreaker
- Pagination server-side to keep response small

---

## Step 2: Create `app/api/leaderboard/route.ts`

```typescript
import { NextResponse } from 'next/server'
import { getLeaderboard } from '@/lib/round-indexer'
import type { LeaderboardSortBy } from '@/lib/round-indexer'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const VALID_SORT: LeaderboardSortBy[] = ['pnl', 'volume', 'winRate', 'totalBets', 'roi']

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)

  const sortBy = (searchParams.get('sortBy') || 'pnl') as LeaderboardSortBy
  if (!VALID_SORT.includes(sortBy)) {
    return NextResponse.json({ error: 'Invalid sortBy', ok: false }, { status: 400 })
  }

  const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '50')))

  try {
    const result = getLeaderboard(sortBy, page, pageSize)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[leaderboard] Error:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load leaderboard', ok: false }, { status: 500 })
  }
}
```

### API Response Shape

```json
{
  "ok": true,
  "entries": [
    {
      "rank": 1,
      "address": "ST1QP...",
      "totalBets": 42,
      "totalVolumeUsd": 1250.50,
      "wins": 28,
      "losses": 14,
      "winRate": 0.667,
      "totalPnl": 385.20,
      "roi": 0.308
    }
  ],
  "total": 156
}
```

---

## Step 3: Create `components/LeaderboardTable.tsx`

This is the main client component. Mirrors the design patterns from `RoundExplorer.tsx` and `ProfilePage.tsx`.

### Layout

```
[Sort tabs: P&L | Volume | Win Rate | ROI | Bets]

[Table]
  # | Trader          | Bets | Volume    | W/L      | Win%  | P&L        | ROI
  1   [identicon] ST1.. 42    $1,250.50   28W - 14L  66.7%  +$385.20    +30.8%
  2   [identicon] ST2.. 31    $980.00     20W - 11L  64.5%  +$220.10    +22.5%
  ...

[Load more button]
```

### Full Implementation

```typescript
'use client'

import { useState, useEffect, useCallback } from 'react'
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
  { key: 'totalBets', label: 'Bets' },
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

  const PAGE_SIZE = 50

  const fetchLeaderboard = useCallback(async (s: SortBy, p: number, append: boolean) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/leaderboard?sortBy=${s}&page=${p}&pageSize=${PAGE_SIZE}`)
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
    fetchLeaderboard(sortBy, 1, false)
  }, [sortBy, fetchLeaderboard])

  const loadMore = () => {
    if (loadingMore) return
    const next = page + 1
    setPage(next)
    fetchLeaderboard(sortBy, next, true)
  }

  const hasMore = entries.length < total

  return (
    <main className="min-h-screen bg-zinc-950">
      <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Page title */}
        <div className="mb-6">
          <h1 className="text-zinc-200 font-semibold text-lg sm:text-xl">Leaderboard</h1>
          <p className="text-zinc-500 text-xs mt-1">
            Top traders ranked by performance. Click any trader to view their full profile.
          </p>
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
            {total} trader{total !== 1 ? 's' : ''}
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
            <span>Trader</span>
            <span className="text-right">Bets</span>
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
          {!loading && entries.length === 0 && !error && (
            <div className="text-center py-16 text-zinc-600 text-sm">
              No traders found yet. Place the first prediction!
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
                    <span>{entry.totalBets} bets</span>
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
```

### Key Details
- **Entire row is a `<Link>`** to `/profile/[address]` — no separate click target needed
- **Mobile layout**: Stacked compact view (rank + identicon + address + PnL)
- **Desktop layout**: Full table with all columns
- **Sort tabs** change `sortBy`, which triggers a fresh fetch (resets pagination)
- **Load more** appends next page to existing entries
- **RankBadge**: Gold (#1), silver (#2), bronze (#3) — adds visual flair to top positions
- **MiniIdenticon**: Smaller (28px) version of ProfilePage's Identicon — same hash algorithm
- Load more button uses `e.preventDefault()` since it's inside a `<Link>` ancestor context — prevents navigation

---

## Step 4: Create `app/leaderboard/page.tsx`

Simple page route that renders the client component.

```typescript
import dynamic from 'next/dynamic'

const LeaderboardTable = dynamic(() => import('@/components/LeaderboardTable'), {
  ssr: false,
  loading: () => (
    <main className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="flex items-center gap-2 text-zinc-500 text-sm">
        <div className="h-4 w-4 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" />
        Loading...
      </div>
    </main>
  ),
})

export default function LeaderboardPage() {
  return <LeaderboardTable />
}
```

### Why `dynamic` with `ssr: false`?
Consistent with the existing pattern used in `/profile/[address]/page.tsx`. The leaderboard component doesn't need SSR since it fetches data client-side.

---

## Step 5: Add trophy icon to `components/AppHeader.tsx`

Add a Leaderboard icon between History and Profile in the nav.

### Changes

```typescript
// Inside <nav>, after the History icon Link and before the Profile icon conditional:

{/* Leaderboard icon */}
<Link
  href="/leaderboard"
  className="p-2 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
  title="Leaderboard"
>
  {/* Trophy icon (Heroicons outline) */}
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 0 1-.982-3.172M9.497 14.25a7.454 7.454 0 0 0 .982-3.172M2.25 4.5a3.75 3.75 0 0 0 3.75 3.75h.008a7.464 7.464 0 0 1 .352-2.853 1.13 1.13 0 0 0-.084-.517A3.75 3.75 0 0 0 2.25 4.5Zm19.5 0a3.75 3.75 0 0 1-3.75 3.75h-.008a7.464 7.464 0 0 0-.352-2.853 1.13 1.13 0 0 1 .084-.517A3.75 3.75 0 0 1 21.75 4.5Zm-15 1.125a5.25 5.25 0 1 0 10.5 0v-1.5a.75.75 0 0 0-.75-.75H7.5a.75.75 0 0 0-.75.75v1.5Z" />
  </svg>
</Link>
```

### Nav Order
```
[History icon]  [Leaderboard icon]  [Profile icon (conditional)]
```

---

## Summary of Changes

| File | Action | What Changes |
|---|---|---|
| `lib/round-indexer.ts` | **EDIT** | Add `LeaderboardEntry`, `LeaderboardSortBy` types + `getLeaderboard()` export |
| `app/api/leaderboard/route.ts` | **CREATE** | API endpoint with sortBy, page, pageSize params |
| `components/LeaderboardTable.tsx` | **CREATE** | Client component: sort tabs, table with identicons, pagination |
| `app/leaderboard/page.tsx` | **CREATE** | Page route with dynamic import |
| `components/AppHeader.tsx` | **EDIT** | Add trophy icon to nav between History and Profile |

---

## Verification Checklist

1. `npm run build` — no TypeScript errors
2. Navigate to `/leaderboard` — see sorted table with all traders
3. Default sort is by P&L (descending)
4. Click sort tabs — table re-sorts (P&L, Volume, Win Rate, ROI, Bets)
5. Click any row — navigates to `/profile/[address]`
6. Top 3 ranks show gold/silver/bronze styling
7. Each row has mini identicon matching the profile page identicon
8. "Load more" button works when >50 traders
9. Trophy icon visible in header, links to `/leaderboard`
10. Mobile responsive — compact card layout on small screens
11. Empty state shown when no traders exist
12. Loading skeleton while data fetches
