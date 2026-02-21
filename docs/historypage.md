# Shared Header + Navigation Refactor — Complete Implementation Spec

## Overview

Create a **shared sticky header** (`AppHeader`) rendered via `app/layout.tsx` across all pages. Replace per-page inline headers with icon-based navigation. Clean up the home page by removing `WalletHistory` and `RecentRounds` (history data lives at `/history`, user data lives at `/profile/[address]`).

**Zero new dependencies** — uses existing components and patterns.

---

## App Context

- **Stack**: Next.js 14 App Router, React 19, TailwindCSS 3.4, TypeScript
- **Design system**: Dark theme, zinc-950 bg, up=#22C55E, down=#EF4444, bitcoin=#F7931A
- **Fonts**: Outfit (sans body), JetBrains Mono (mono for numbers/prices)
- **Card pattern**: `bg-zinc-900/50 rounded-xl border border-zinc-800 p-4 sm:p-5`
- **Wallet lib**: `@stacks/connect` — reads from localStorage, uses `isConnected()`, `getLocalStorage()`
- **Custom events**: `stacks:authenticationResponse` (connect), `bitpredix:wallet-disconnected` (disconnect)
- **SSR pattern**: All wallet-dependent components use `dynamic(() => import(...), { ssr: false })` wrappers

---

## Current State (what needs to change)

### `app/layout.tsx` — Root layout (server component)
Currently renders only fonts/metadata + `{children}`. No shared header or footer.

```typescript
// Current: line 55-56
<body className="min-h-screen bg-zinc-950 text-zinc-100 font-sans antialiased">
  {children}
</body>
```

### `app/page.tsx` — Home page
Has an inline `<header>` (lines 14-26) with Logo + ProfileButtonWrapper + MintTestTokensWrapper + ConnectWalletButtonWrapper. Also renders `<WalletHistoryWrapper />` and `<RecentRoundsWrapper />` below the MarketCard.

### `app/history/page.tsx` — History page
Has its own inline `<header>` (lines 17-54) with smaller logo + "Round History" title + back link. Also has its own inline footer (not using shared `<Footer />`).

### `components/ProfilePage.tsx` — Profile page
Has its own inline `<header>` (lines 377-443) with Back link + "Profile" label. The address card (identicon, address, copy button, balance, explorer link) is inside this header but is profile-specific content that should stay.

### `components/ProfileButtonWrapper.tsx` — Profile button
Renders a text button "Profile" with user icon. Will be replaced by an icon-only button inside the shared header. This file becomes dead code.

### `components/Footer.tsx` — Shared footer
Already extracted and used by `app/page.tsx` and `components/ProfilePage.tsx`. History page does NOT use it yet (has its own inline footer).

---

## File Structure

```
MODIFIED FILES:
  app/layout.tsx                          — Add <AppHeader /> before {children}
  app/page.tsx                            — Remove header, WalletHistory, RecentRounds
  app/history/page.tsx                    — Remove inline header, use shared <Footer />
  components/ProfilePage.tsx              — Remove header nav (Back + "Profile"), keep address card

NEW FILES:
  components/AppHeader.tsx                — Shared sticky header (client component)

DELETE FILES:
  components/ProfileButtonWrapper.tsx     — Dead code (replaced by icon in AppHeader)
```

---

## Step 1: Create `components/AppHeader.tsx`

This is a `'use client'` component. It reads wallet state to conditionally show the profile icon.

### Layout

```
<header sticky top-0 z-40 border-b bg-zinc-950/80 backdrop-blur-sm>
  <div max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3>
    [Logo]          [History icon] [Profile icon]          [Mint] [Connected]
     left               center nav                            right
  </div>
</header>
```

### Full Implementation

```typescript
'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { MintTestTokensWrapper } from './MintTestTokensWrapper'
import { ConnectWalletButtonWrapper } from './ConnectWalletButtonWrapper'
import { getLocalStorage, isConnected } from '@stacks/connect'

export function AppHeader() {
  const [stxAddress, setStxAddress] = useState<string | null>(null)

  const refresh = useCallback(() => {
    if (!isConnected()) { setStxAddress(null); return }
    const data = getLocalStorage()
    setStxAddress(data?.addresses?.stx?.[0]?.address ?? null)
  }, [])

  useEffect(() => {
    refresh()
    const onConnect = () => refresh()
    const onDisconnect = () => setStxAddress(null)
    window.addEventListener('stacks:authenticationResponse', onConnect)
    window.addEventListener('bitpredix:wallet-disconnected', onDisconnect)
    const interval = setInterval(refresh, 3000)
    return () => {
      window.removeEventListener('stacks:authenticationResponse', onConnect)
      window.removeEventListener('bitpredix:wallet-disconnected', onDisconnect)
      clearInterval(interval)
    }
  }, [refresh])

  return (
    <header className="sticky top-0 z-40 w-full border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-sm">
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 sm:py-3 flex items-center justify-between gap-3">
        {/* Left: Logo */}
        <Link href="/" className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Predix"
            className="h-9 sm:h-10 w-auto"
            style={{ clipPath: 'inset(10% 0)' }}
          />
        </Link>

        {/* Center: Nav icons */}
        <nav className="flex items-center gap-1">
          {/* History icon — always visible */}
          <Link
            href="/history"
            className="p-2 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
            title="Round History"
          >
            {/* Chart bar icon (Heroicons outline) */}
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
            </svg>
          </Link>

          {/* Profile icon — only when wallet connected */}
          {stxAddress && (
            <Link
              href={`/profile/${stxAddress}`}
              className="p-2 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
              title="My Profile"
            >
              {/* User silhouette icon (Heroicons outline) */}
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
              </svg>
            </Link>
          )}
        </nav>

        {/* Right: Wallet controls */}
        <div className="flex items-center gap-2 sm:gap-3">
          <MintTestTokensWrapper />
          <ConnectWalletButtonWrapper />
        </div>
      </div>
    </header>
  )
}
```

### Key Details
- `sticky top-0 z-40` keeps header visible on scroll
- `bg-zinc-950/80 backdrop-blur-sm` for the semi-transparent blur effect
- Logo is `h-9 sm:h-10` — smaller than the current home page logo (`h-14 sm:h-16 lg:h-20`) since it's persistent
- `clipPath: 'inset(10% 0)'` matches existing logo rendering across the app
- Wallet state pattern is identical to `components/ProfileButtonWrapper.tsx` (same hooks, same events)
- `MintTestTokensWrapper` and `ConnectWalletButtonWrapper` are imported directly (they handle their own `dynamic()` + SSR=false internally)
- History icon uses Heroicons `chart-bar` (3 ascending bars — conveys data/analytics)
- Profile icon uses Heroicons `user` (same SVG path already used in `ProfileButtonWrapper`)

---

## Step 2: Update `app/layout.tsx`

Import `AppHeader` and render before `{children}`.

### Changes

```typescript
// ADD import:
import { AppHeader } from '@/components/AppHeader'

// CHANGE body content (line 55-56):
// FROM:
<body className="min-h-screen bg-zinc-950 text-zinc-100 font-sans antialiased">
  {children}
</body>

// TO:
<body className="min-h-screen bg-zinc-950 text-zinc-100 font-sans antialiased">
  <AppHeader />
  {children}
</body>
```

`layout.tsx` stays a server component — Next.js supports importing client components from server components. The client boundary is established at `AppHeader.tsx` itself.

---

## Step 3: Simplify `app/page.tsx` (Home)

Remove the inline header, WalletHistory, and RecentRounds. The shared header in layout.tsx handles navigation now.

### Target State

```typescript
import { MarketCardV4Wrapper } from '@/components/MarketCardV4Wrapper'
import { Footer } from '@/components/Footer'

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950">
      <div className="w-full max-w-2xl lg:max-w-6xl xl:max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-10">
        <MarketCardV4Wrapper />

        <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5 text-sm text-zinc-400">
          <h3 className="font-semibold text-zinc-300 mb-2">How it works</h3>
          <ul className="space-y-1.5">
            <li>• Each round lasts <strong className="text-zinc-300">1 minute</strong>.</li>
            <li>• Predictions close <strong className="text-zinc-300">when the round ends</strong> (no early cutoff).</li>
            <li>• Buy <strong className="text-up">UP</strong> if you think the price will rise, <strong className="text-down">DOWN</strong> if you think it will fall.</li>
            <li>• UP and DOWN prices are set by an AMM (LMSR).</li>
            <li>• At the end of the minute: if price went up, UP pays $1 per share; if it went down, DOWN pays $1 per share.</li>
          </ul>
        </section>

        <Footer />
      </div>
    </main>
  )
}
```

### What's Removed
- `import Link` — no longer used
- `import { ConnectWalletButtonWrapper }` — moved to AppHeader
- `import { MintTestTokensWrapper }` — moved to AppHeader
- `import { WalletHistoryWrapper }` — removed from home
- `import { RecentRoundsWrapper }` — removed from home
- `import { ProfileButtonWrapper }` — replaced by icon in AppHeader
- Entire `<header>` block (lines 14-26)
- `<WalletHistoryWrapper />` (line 41)
- `<RecentRoundsWrapper />` (line 43)

---

## Step 4: Update `app/history/page.tsx`

Remove the inline header and use the shared `<Footer />`.

### Target State

```typescript
'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { RoundExplorer } from '@/components/RoundExplorer'
import { Footer } from '@/components/Footer'

function HistoryContent() {
  const searchParams = useSearchParams()
  const roundParam = searchParams.get('round')
  const initialRoundId = roundParam ? parseInt(roundParam) : undefined

  return (
    <main className="min-h-screen bg-zinc-950">
      <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6">
          <h1 className="text-zinc-200 font-semibold text-lg sm:text-xl">Round History</h1>
          <p className="text-zinc-500 text-xs mt-1">
            Complete transparency — every round, every prediction, every outcome.
          </p>
        </div>

        <RoundExplorer initialRoundId={initialRoundId} />

        <Footer />
      </div>
    </main>
  )
}

export default function HistoryPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-zinc-950 flex items-center justify-center">
          <div className="flex items-center gap-2 text-zinc-500 text-sm">
            <div className="h-4 w-4 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" />
            Loading...
          </div>
        </main>
      }
    >
      <HistoryContent />
    </Suspense>
  )
}
```

### What's Removed
- `import Link` — no longer used (no inline header, no back link)
- Entire `<header>` block (lines 17-54) — logo, title, back link
- Inline footer (lines 59-64) — replaced by shared `<Footer />`

### What's Kept
- Page title `<h1>` and subtitle — kept from old header, just not in a `<header>` tag
- `<RoundExplorer />` with Suspense/useSearchParams pattern — unchanged
- WalletHistory is **NOT** added here — user data lives at `/profile/[address]`

---

## Step 5: Update `components/ProfilePage.tsx`

Remove the navigation header (Back link + "Profile" label). Keep the address card as the first content block.

### Changes (lines 376-443)

```typescript
// REPLACE lines 376-443:
// FROM:
        {/* Header */}
        <header className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <Link href="/" className="flex items-center gap-2 text-zinc-500 hover:text-zinc-300 transition-colors text-sm">
              <svg ...><path ... d="M15 19l-7-7 7-7" /></svg>
              Back
            </Link>
            <span className="text-zinc-600 text-xs">Profile</span>
          </div>

          {/* Address card */}
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-4 sm:p-5">
            ...address card content...
          </div>
        </header>

// TO:
        {/* Address card */}
        <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-4 sm:p-5 mb-6">
          ...address card content (unchanged)...
        </div>
```

The address card content (Identicon, address, copy button, member since, balance, explorer link) stays exactly the same. Only the wrapping `<header>` tag, the Back link, and the "Profile" label are removed. The card gets `mb-6` for spacing.

### Also Remove
- `import Link from 'next/link'` — no longer used (the Back link is gone, address card's explorer link uses `<a>` not `<Link>`)

---

## Step 6: Delete `components/ProfileButtonWrapper.tsx`

After step 3 removes the import from `app/page.tsx`, this file has no importers. Delete it entirely.

Before deleting, verify with grep that no other file imports it:
```bash
grep -r "ProfileButtonWrapper" --include="*.tsx" --include="*.ts"
```

---

## Summary of Changes

| File | Action | What Changes |
|---|---|---|
| `components/AppHeader.tsx` | **CREATE** | Shared sticky header with logo, history icon, profile icon, mint + connect |
| `app/layout.tsx` | **EDIT** | Add `<AppHeader />` before `{children}` (1 import + 1 JSX line) |
| `app/page.tsx` | **EDIT** | Remove header block + WalletHistory + RecentRounds + 6 unused imports |
| `app/history/page.tsx` | **EDIT** | Remove inline header + inline footer, add page title + shared Footer |
| `components/ProfilePage.tsx` | **EDIT** | Remove `<header>` nav wrapper, keep address card as content block, remove Link import |
| `components/ProfileButtonWrapper.tsx` | **DELETE** | Dead code — replaced by icon in AppHeader |

---

## Verification Checklist

1. `npm run build` — no TypeScript errors
2. Navigate to `/` — shared header visible with logo + icons + wallet controls. Page shows MarketCard + "How it works" + Footer only (no WalletHistory, no RecentRounds)
3. Navigate to `/history` — same header persists. Page shows "Round History" title + RoundExplorer + Footer
4. Navigate to `/profile/[address]` — same header persists. Page shows address card + stats + chart + bets + Footer
5. Click logo from any page — navigates to `/`
6. History icon (chart bars) in header — always visible, links to `/history`
7. Profile icon (user silhouette) in header — only appears when wallet is connected, links to `/profile/[address]`
8. Connect wallet — profile icon appears in header
9. Disconnect wallet — profile icon disappears from header
10. Mobile responsive — header doesn't overflow on small screens, icons are tappable
11. Scroll on any page — header stays sticky at top with blur effect
