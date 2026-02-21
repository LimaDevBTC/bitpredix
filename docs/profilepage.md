# Profile Page — Complete Implementation Spec

## Overview

Public profile page at `/profile/[address]` showing comprehensive trading stats, P&L equity curve, and full bet history for any wallet address. Foundational for future leaderboards, copytrading, and bot competitions.

**Zero new dependencies** — uses existing `lightweight-charts` v5.1.0 + TailwindCSS.

---

## App Context

- **Stack**: Next.js 14 App Router, React 19, TailwindCSS 3.4, TypeScript
- **Blockchain**: Stacks testnet, contract `predixv1` at `ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK`
- **Token**: test-usdcx (6 decimals)
- **Round duration**: 60 seconds, trading open for 48s
- **Fee**: 3% on winning payouts (FEE_BPS = 300)
- **Design system**: Dark theme, zinc-950 bg, up=#22C55E, down=#EF4444, bitcoin=#F7931A
- **Fonts**: Outfit (sans body), JetBrains Mono (mono for numbers/prices)
- **Card pattern**: `bg-zinc-900/50 rounded-xl border border-zinc-800 p-4 sm:p-5`
- **Container**: `max-w-4xl mx-auto px-4 sm:px-6`

---

## File Structure

```
NEW FILES:
  app/profile/[address]/page.tsx         — Route wrapper (Suspense + dynamic import)
  app/api/profile/route.ts               — Backend API aggregating all profile data
  components/ProfilePage.tsx             — Main profile UI (client component)
  components/EquityCurveChart.tsx         — P&L chart (lightweight-charts BaselineSeries)

MODIFIED FILES:
  lib/round-indexer.ts                   — Add getWalletProfile() + new types
  app/page.tsx                           — Add Profile button to header (center, prominent)
  components/ConnectWalletButton.tsx      — Export stxAddress for header Profile button
  components/RoundExplorer.tsx            — Change address links from explorer → /profile/[address]
  components/WalletHistory.tsx            — (if addresses shown) link to /profile/[address]
```

---

## Navigation Design Decisions

### 1. Profile Button in Header (prominent, center)
The Profile button is NOT a dropdown item hidden in the wallet menu. It's a **visually prominent element in the center of the header**, always visible when wallet is connected. Design:

```
[Logo]          [ Profile Button ]          [Mint] [Connected ●]
```

The button uses a user icon + "Profile" text, styled attractively with the bitcoin accent color:
```typescript
// In app/page.tsx header — only shown when wallet is connected
<Link
  href={`/profile/${stxAddress}`}
  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-700/50
             hover:border-bitcoin/40 hover:bg-zinc-800 text-zinc-300 hover:text-bitcoin
             transition-all text-sm font-medium group"
>
  {/* User icon (SVG) */}
  <svg className="h-4 w-4 text-zinc-500 group-hover:text-bitcoin transition-colors" ...>
    {/* Person/user silhouette icon */}
  </svg>
  Profile
</Link>
```

This needs the connected wallet address, so `app/page.tsx` must use a client wrapper or the ConnectWalletButton must emit the address. Best approach: create a small `ProfileButtonWrapper` client component that reads the wallet address from `@stacks/connect` localStorage (same pattern as other components).

### 2. All Address Links → /profile/[address]
Every clickable wallet address in the app redirects to the profile page instead of the Hiro explorer. The explorer link is available **inside** the profile page as a secondary reference.

**Files to update:**
- `components/RoundExplorer.tsx` line 448: `href={explorer/address}` → `href={/profile/address}`
- Any other address links found in components

---

## Step 1: Extend `lib/round-indexer.ts`

### New Types (add after existing `WalletStats` interface)

```typescript
export interface ProfileBetRecord {
  roundId: number
  timestamp: number           // round end timestamp (unix seconds)
  side: 'UP' | 'DOWN'
  amountUsd: number           // bet amount in USD
  outcome: 'UP' | 'DOWN' | null  // null if unresolved
  resolved: boolean
  totalPool: number           // total pool USD for the round
  winningPool: number         // winning side's pool USD (0 if unresolved)
  pnl: number                 // +profit or -loss in USD (0 if unresolved)
  poolSharePct: number        // user's % of their side's pool
  priceStart: number | null   // BTC price at round start (USD)
  priceEnd: number | null     // BTC price at round end (USD)
  txId: string                // transaction ID
}

export interface EquityPoint {
  time: number                // round end timestamp (unix seconds)
  value: number               // cumulative P&L in USD at this point
}

export interface WalletProfile {
  address: string
  firstSeen: number           // unix timestamp of earliest bet
  stats: {
    totalBets: number
    totalVolumeUsd: number
    wins: number
    losses: number
    pending: number
    winRate: number           // wins / (wins + losses), 0-1
    totalPnl: number          // sum of all P&L
    roi: number               // totalPnl / totalVolumeUsd, can be negative
    bestWin: number           // largest single positive P&L
    worstLoss: number         // largest single negative P&L (stored as negative)
    avgBetSize: number        // totalVolumeUsd / totalBets
    longestWinStreak: number
    longestLoseStreak: number
    currentStreak: { type: 'win' | 'loss'; count: number }
    sideDistribution: { upVolume: number; downVolume: number }
  }
  equityCurve: EquityPoint[]  // chronological cumulative P&L points
  recentBets: ProfileBetRecord[] // paginated, newest first
  totalBetRecords: number     // total count for pagination
}
```

### New Function: `getWalletProfile()`

```typescript
export function getWalletProfile(
  address: string,
  page: number = 1,
  pageSize: number = 20
): WalletProfile {
  // 1. Collect all bets by this address across all indexed rounds
  const allBetRecords: ProfileBetRecord[] = []
  let firstSeen = Infinity

  for (const round of roundsIndex.values()) {
    const userBets = round.bets.filter(b => b.user === address && b.status === 'success')
    if (userBets.length === 0) continue

    for (const bet of userBets) {
      if (bet.timestamp < firstSeen) firstSeen = bet.timestamp

      // Calculate P&L for resolved rounds
      let pnl = 0
      let winningPool = 0
      let poolSharePct = 0
      const sidePool = bet.side === 'UP' ? round.totalUpUsd : round.totalDownUsd

      if (sidePool > 0) {
        poolSharePct = (bet.amountUsd / sidePool) * 100
      }

      if (round.resolved && round.outcome) {
        winningPool = round.outcome === 'UP' ? round.totalUpUsd : round.totalDownUsd
        if (bet.side === round.outcome) {
          // Won
          const grossPayout = (bet.amountUsd / winningPool) * round.totalPoolUsd
          const fee = grossPayout * 0.03
          pnl = grossPayout - fee - bet.amountUsd
        } else {
          // Lost
          pnl = -bet.amountUsd
        }
      }

      allBetRecords.push({
        roundId: round.roundId,
        timestamp: round.endTimestamp,
        side: bet.side,
        amountUsd: bet.amountUsd,
        outcome: round.outcome,
        resolved: round.resolved,
        totalPool: round.totalPoolUsd,
        winningPool,
        pnl,
        poolSharePct,
        priceStart: round.priceStart,
        priceEnd: round.priceEnd,
        txId: bet.txId,
      })
    }
  }

  // 2. Sort chronologically for equity curve, then compute stats
  allBetRecords.sort((a, b) => a.timestamp - b.timestamp)

  // 3. Build stats
  let totalPnl = 0, wins = 0, losses = 0, pending = 0
  let bestWin = 0, worstLoss = 0
  let upVolume = 0, downVolume = 0
  let totalVolume = 0
  let curStreak = 0, curStreakType: 'win' | 'loss' = 'win'
  let longestWin = 0, longestLose = 0

  const equityCurve: EquityPoint[] = []
  let cumPnl = 0

  for (const bet of allBetRecords) {
    totalVolume += bet.amountUsd
    if (bet.side === 'UP') upVolume += bet.amountUsd
    else downVolume += bet.amountUsd

    if (!bet.resolved) {
      pending++
      continue
    }

    totalPnl += bet.pnl
    cumPnl += bet.pnl
    equityCurve.push({ time: bet.timestamp, value: cumPnl })

    if (bet.pnl > bestWin) bestWin = bet.pnl
    if (bet.pnl < worstLoss) worstLoss = bet.pnl

    const isWin = bet.pnl >= 0
    if (isWin) {
      wins++
      if (curStreakType === 'win') { curStreak++ }
      else { curStreak = 1; curStreakType = 'win' }
      if (curStreak > longestWin) longestWin = curStreak
    } else {
      losses++
      if (curStreakType === 'loss') { curStreak++ }
      else { curStreak = 1; curStreakType = 'loss' }
      if (curStreak > longestLose) longestLose = curStreak
    }
  }

  const decided = wins + losses
  const totalBets = allBetRecords.length

  // 4. Paginate bets (newest first for display)
  const sortedDesc = [...allBetRecords].reverse()
  const start = (page - 1) * pageSize
  const recentBets = sortedDesc.slice(start, start + pageSize)

  return {
    address,
    firstSeen: firstSeen === Infinity ? 0 : firstSeen,
    stats: {
      totalBets,
      totalVolumeUsd: totalVolume,
      wins,
      losses,
      pending,
      winRate: decided > 0 ? wins / decided : 0,
      totalPnl,
      roi: totalVolume > 0 ? totalPnl / totalVolume : 0,
      bestWin,
      worstLoss,
      avgBetSize: totalBets > 0 ? totalVolume / totalBets : 0,
      longestWinStreak: longestWin,
      longestLoseStreak: longestLose,
      currentStreak: { type: curStreakType, count: curStreak },
      sideDistribution: { upVolume, downVolume },
    },
    equityCurve,
    recentBets,
    totalBetRecords: allBetRecords.length,
  }
}
```

---

## Step 2: API Route `/api/profile/route.ts`

```typescript
import { NextResponse } from 'next/server'
import { getWalletProfile } from '@/lib/round-indexer'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/profile?address=ST1...&page=1&pageSize=20
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const address = searchParams.get('address')

  if (!address) {
    return NextResponse.json({ error: 'address required', ok: false }, { status: 400 })
  }

  const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
  const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') || '20')))

  try {
    const profile = getWalletProfile(address, page, pageSize)

    // Also fetch balance (inline, same pattern as mint-status route)
    let balance = 0
    try {
      // Use stacks-read approach to get test-usdcx balance
      const HIRO_API = 'https://api.testnet.hiro.so'
      const CONTRACT_ADDRESS = 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK'
      const { cvToHex, standardPrincipalCV, hexToCV, cvToJSON } = await import('@stacks/transactions')
      const res = await fetch(
        `${HIRO_API}/v2/contracts/call-read/${CONTRACT_ADDRESS}/test-usdcx/get-balance`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sender: CONTRACT_ADDRESS,
            arguments: [cvToHex(standardPrincipalCV(address))],
          }),
        }
      )
      if (res.ok) {
        const data = await res.json()
        if (data.result) {
          const cv = hexToCV(data.result)
          const json = cvToJSON(cv)
          balance = Number(json.value?.value ?? 0) / 1e6
        }
      }
    } catch { /* balance stays 0 */ }

    return NextResponse.json({ ok: true, profile, balance })
  } catch (e) {
    console.error('[profile] Error:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load profile', ok: false }, { status: 500 })
  }
}
```

### Response Shape

```json
{
  "ok": true,
  "balance": 942.50,
  "profile": {
    "address": "ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK",
    "firstSeen": 1770500000,
    "stats": {
      "totalBets": 89,
      "totalVolumeUsd": 12450.00,
      "wins": 52,
      "losses": 30,
      "pending": 7,
      "winRate": 0.634,
      "totalPnl": 2891.45,
      "roi": 0.232,
      "bestWin": 456.78,
      "worstLoss": -200.00,
      "avgBetSize": 139.89,
      "longestWinStreak": 8,
      "longestLoseStreak": 4,
      "currentStreak": { "type": "win", "count": 3 },
      "sideDistribution": { "upVolume": 7740, "downVolume": 4710 }
    },
    "equityCurve": [
      { "time": 1770500060, "value": 45.20 },
      { "time": 1770500120, "value": -12.50 },
      ...
    ],
    "recentBets": [
      {
        "roundId": 29527100,
        "timestamp": 1771636860,
        "side": "UP",
        "amountUsd": 50.00,
        "outcome": "UP",
        "resolved": true,
        "totalPool": 250.00,
        "winningPool": 150.00,
        "pnl": 30.83,
        "poolSharePct": 33.33,
        "priceStart": 97234.56,
        "priceEnd": 97345.67,
        "txId": "0xabc123..."
      }
    ],
    "totalBetRecords": 89
  }
}
```

---

## Step 3: Page Route `app/profile/[address]/page.tsx`

```typescript
'use client'

import { useParams } from 'next/navigation'
import { Suspense } from 'react'
import dynamic from 'next/dynamic'

const ProfilePage = dynamic(() => import('@/components/ProfilePage'), {
  ssr: false,
  loading: () => (
    <main className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="flex items-center gap-2 text-zinc-500 text-sm">
        <div className="h-4 w-4 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" />
        Loading profile...
      </div>
    </main>
  ),
})

export default function ProfileRoute() {
  const params = useParams()
  const address = params.address as string

  return (
    <Suspense fallback={null}>
      <ProfilePage address={address} />
    </Suspense>
  )
}
```

---

## Step 4: `components/ProfilePage.tsx`

Main client component. Fetches `/api/profile?address=X` on mount + when page changes.

### Layout Structure

```
main (min-h-screen bg-zinc-950)
└── div (max-w-4xl mx-auto px-4 sm:px-6 py-6)
    ├── Header
    │   ├── Logo + "Profile" title + back link
    │   ├── Address card: identicon + address + copy + member since + balance
    │   └── (future: follow button, bot badge, etc.)
    │
    ├── Stats Grid (grid grid-cols-2 lg:grid-cols-4 gap-3)
    │   ├── Total P&L card (large, col-span-2 on mobile)
    │   ├── Win Rate card (with SVG arc)
    │   ├── Volume card
    │   ├── Total Bets card
    │   ├── Best Win card
    │   ├── ROI card
    │   ├── Avg Bet card
    │   └── Streak card
    │
    ├── Equity Curve (full-width card, ~300px height)
    │   └── EquityCurveChart component (dynamic import)
    │
    ├── Side Distribution (horizontal bar)
    │   └── Green (UP%) | Red (DOWN%) with labels
    │
    ├── Bet History
    │   ├── Filter tabs: All / Wins / Losses / Pending
    │   ├── Table/cards of bets
    │   ├── Expandable rows (prices, tx link)
    │   └── "Load more" pagination
    │
    └── Footer
```

### Identicon Generation (no library)

Deterministic 5x5 pixel avatar from address hash:

```typescript
function generateIdenticon(address: string): string[][] {
  // Simple hash from address characters
  let hash = 0
  for (let i = 0; i < address.length; i++) {
    hash = ((hash << 5) - hash) + address.charCodeAt(i)
    hash |= 0
  }

  // Generate 5x5 grid (mirrored horizontally for symmetry)
  const grid: boolean[][] = []
  for (let y = 0; y < 5; y++) {
    const row: boolean[] = []
    for (let x = 0; x < 3; x++) {
      row.push(((hash >> (y * 3 + x)) & 1) === 1)
    }
    // Mirror: col 3 = col 1, col 4 = col 0
    grid.push([row[0], row[1], row[2], row[1], row[0]])
  }

  // Pick hue from hash
  const hue = Math.abs(hash) % 360
  const color = `hsl(${hue}, 65%, 55%)`
  const bg = `hsl(${hue}, 20%, 15%)`

  return { grid, color, bg }
}
```

Render as a 5x5 CSS grid with tiny colored cells inside a rounded-xl container.

### Stat Card Component

```typescript
function StatCard({ label, value, subtext, color, large }: {
  label: string
  value: string
  subtext?: string
  color?: 'up' | 'down' | 'default'
  large?: boolean
}) {
  return (
    <div className={`bg-zinc-900/50 rounded-xl border border-zinc-800 p-4 ${large ? 'col-span-2' : ''}`}>
      <div className="text-xs text-zinc-500 mb-1">{label}</div>
      <div className={`font-mono text-lg sm:text-xl font-bold ${
        color === 'up' ? 'text-up' : color === 'down' ? 'text-down' : 'text-zinc-100'
      }`}>
        {value}
      </div>
      {subtext && <div className="text-[11px] text-zinc-500 mt-0.5">{subtext}</div>}
    </div>
  )
}
```

### Win Rate Ring (SVG)

```typescript
function WinRateRing({ rate }: { rate: number }) {
  const pct = rate * 100
  const circumference = 2 * Math.PI * 24 // r=24
  const offset = circumference * (1 - rate)

  return (
    <svg width="56" height="56" className="shrink-0">
      {/* Background ring */}
      <circle cx="28" cy="28" r="24" fill="none" stroke="#27272a" strokeWidth="4" />
      {/* Progress ring */}
      <circle cx="28" cy="28" r="24" fill="none"
        stroke="#22C55E" strokeWidth="4"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 28 28)"
      />
      {/* Center text */}
      <text x="28" y="32" textAnchor="middle" className="fill-zinc-100 text-xs font-mono font-bold">
        {pct.toFixed(0)}%
      </text>
    </svg>
  )
}
```

### Bet History Table

Desktop: table layout with columns
Mobile: stacked card layout

```
| Time          | Side | Amount  | Pool % | Outcome | P&L      |
|---------------|------|---------|--------|---------|----------|
| 2m ago        | UP ↑ | $50.00  | 33.3%  | UP ✓    | +$30.83  |
| 5m ago        | DOWN↓| $25.00  | 12.5%  | UP ✗    | -$25.00  |
| 8m ago        | UP ↑ | $100.00 | -      | pending | -        |
```

Expandable row shows:
- Round ID (link to `/history?round=ID`)
- BTC price: $97,234.56 → $97,345.67
- Transaction: link to `https://explorer.hiro.so/txid/0x...?chain=testnet`

Filter tabs:
```typescript
const filters = ['All', 'Wins', 'Losses', 'Pending'] as const
const [activeFilter, setActiveFilter] = useState<typeof filters[number]>('All')

const filteredBets = recentBets.filter(bet => {
  if (activeFilter === 'All') return true
  if (activeFilter === 'Wins') return bet.resolved && bet.pnl >= 0
  if (activeFilter === 'Losses') return bet.resolved && bet.pnl < 0
  if (activeFilter === 'Pending') return !bet.resolved
  return true
})
```

### Empty State

When address has no bets:
```
No predictions yet

This address hasn't placed any predictions yet.
```

### Loading Skeleton

Each section has skeleton placeholders:
```typescript
{loading && (
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
    {[...Array(8)].map((_, i) => (
      <div key={i} className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-4 h-20 animate-pulse" />
    ))}
  </div>
)}
```

---

## Step 5: `components/EquityCurveChart.tsx`

Follows the exact pattern of `components/BtcPriceChart.tsx`.

```typescript
'use client'

import { useEffect, useRef } from 'react'
import { createChart, BaselineSeries } from 'lightweight-charts'

interface EquityPoint {
  time: number  // unix seconds
  value: number // cumulative P&L USD
}

interface Props {
  data: EquityPoint[]
}

export default function EquityCurveChart({ data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null)

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 280,
      layout: {
        background: { color: 'transparent' },
        textColor: '#71717a', // zinc-500
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(39, 39, 42, 0.5)' },
        horzLines: { color: 'rgba(39, 39, 42, 0.5)' },
      },
      rightPriceScale: {
        borderColor: '#27272a',
      },
      timeScale: {
        borderColor: '#27272a',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: '#52525b', labelBackgroundColor: '#27272a' },
        horzLine: { color: '#52525b', labelBackgroundColor: '#27272a' },
      },
    })

    const series = chart.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: 0 },
      topLineColor: '#22C55E',
      topFillColor1: 'rgba(34, 197, 94, 0.28)',
      topFillColor2: 'rgba(34, 197, 94, 0.05)',
      bottomLineColor: '#EF4444',
      bottomFillColor1: 'rgba(239, 68, 68, 0.05)',
      bottomFillColor2: 'rgba(239, 68, 68, 0.28)',
      lineWidth: 2,
    })

    series.setData(data.map(d => ({
      time: d.time as any, // lightweight-charts expects UTCTimestamp
      value: d.value,
    })))

    chart.timeScale().fitContent()
    chartRef.current = chart

    // Responsive
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        chart.applyOptions({ width: entry.contentRect.width })
      }
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [data])

  if (data.length === 0) {
    return (
      <div className="h-[280px] flex items-center justify-center text-zinc-600 text-sm">
        No resolved predictions yet
      </div>
    )
  }

  return <div ref={containerRef} className="w-full" />
}
```

Dynamic import in ProfilePage:
```typescript
const EquityCurveChart = dynamic(() => import('./EquityCurveChart'), {
  ssr: false,
  loading: () => <div className="h-[280px] animate-pulse bg-zinc-800/50 rounded-lg" />,
})
```

---

## Step 6: Profile Button in Header + Address Link Redirects

### 6.1 Prominent Profile Button in Header (`app/page.tsx`)

Add a new client component `ProfileButton` that reads the wallet address and renders a visually prominent link in the center of the header. Only visible when wallet is connected.

**New component** (can be inline in a wrapper file or standalone):
```typescript
// components/ProfileButtonWrapper.tsx
'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { getLocalStorage, isConnected } from '@stacks/connect'

export function ProfileButton() {
  const [stxAddress, setStxAddress] = useState<string | null>(null)

  const refresh = useCallback(() => {
    if (!isConnected()) { setStxAddress(null); return }
    const data = getLocalStorage()
    setStxAddress(data?.addresses?.stx?.[0]?.address ?? null)
  }, [])

  useEffect(() => {
    refresh()
    // Listen for connect/disconnect events
    const onConnect = () => refresh()
    const onDisconnect = () => setStxAddress(null)
    window.addEventListener('stacks:authenticationResponse', onConnect)
    window.addEventListener('bitpredix:wallet-disconnected', onDisconnect)
    return () => {
      window.removeEventListener('stacks:authenticationResponse', onConnect)
      window.removeEventListener('bitpredix:wallet-disconnected', onDisconnect)
    }
  }, [refresh])

  if (!stxAddress) return null

  return (
    <Link
      href={`/profile/${stxAddress}`}
      className="flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl
                 bg-zinc-900 border border-zinc-700/50
                 hover:border-bitcoin/40 hover:bg-zinc-800
                 text-zinc-300 hover:text-bitcoin
                 transition-all text-xs sm:text-sm font-medium group"
    >
      {/* User icon */}
      <svg
        className="h-4 w-4 text-zinc-500 group-hover:text-bitcoin transition-colors"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
        />
      </svg>
      Profile
    </Link>
  )
}
```

**Header layout in `app/page.tsx`:**
```
<header>
  <div className="flex items-center justify-between gap-2 sm:gap-4">
    <Link href="/">
      <img src="/logo.png" ... />
    </Link>

    {/* Center: Profile button (only shows when connected) */}
    <ProfileButtonWrapper />

    <div className="flex items-center gap-2 sm:gap-3">
      <MintTestTokensWrapper />
      <ConnectWalletButtonWrapper />
    </div>
  </div>
</header>
```

### 6.2 Redirect All Address Links to Profile

**`components/RoundExplorer.tsx`** line ~448:
```typescript
// BEFORE:
href={`https://explorer.hiro.so/address/${bet.user}?chain=testnet`}
target="_blank"
rel="noopener noreferrer"

// AFTER:
href={`/profile/${bet.user}`}
// (remove target="_blank" and rel - stays in-app)
```

The Hiro explorer link for the address is available **inside** the profile page itself, as a secondary "View on Explorer" link in the header section.

---

## Future Extensibility

This architecture is designed for:

1. **Leaderboards**: Query `getWalletProfile()` for all known addresses, sort by P&L/ROI/winRate
2. **Copytrading**: Profile page shows live activity, others can mirror bets
3. **Bot profiles**: Same page works for bot addresses — add bot badge detection later
4. **Bot battles**: Compare two profiles side-by-side (add `/compare/[addr1]/[addr2]` later)
5. **Social**: Add follow button, comment section, sharing (future features on top of profile)

The `/api/profile` endpoint returns everything in a single call, making it efficient for any consumer (web, mobile, bot dashboard).

---

## Verification Checklist

1. `npm run build` — no TypeScript errors
2. Navigate to `/profile/ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK` (deployer has bets)
3. Stats grid loads with correct numbers
4. Equity curve renders with green/red baseline at $0
5. Bet history table loads, filters work (All/Wins/Losses/Pending)
6. "Load more" pagination works
7. Expandable rows show price details + tx link
8. Empty state works for address with no bets
9. Mobile layout: cards stack, table becomes card view
10. Copy address button works
11. Profile link appears in wallet dropdown
12. Page works for any arbitrary address (not just connected wallet)
