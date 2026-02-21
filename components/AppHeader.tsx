'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { History, Crown, CircleUserRound } from 'lucide-react'
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
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 sm:py-4 flex items-center justify-between gap-3">
        {/* Left: Logo */}
        <Link href="/" className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Predix"
            className="h-14 sm:h-16 lg:h-20 w-auto"
            style={{ clipPath: 'inset(10% 0)' }}
          />
        </Link>

        {/* Center: Nav icons */}
        <nav className="flex items-center gap-1">
          {/* History icon */}
          <Link
            href="/history"
            className="p-2 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
            title="Round History"
          >
            <History size={20} strokeWidth={1.5} />
          </Link>

          {/* Leaderboard icon */}
          <Link
            href="/leaderboard"
            className="p-2 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
            title="Leaderboard"
          >
            <Crown size={20} strokeWidth={1.5} />
          </Link>

          {/* Profile icon — only when wallet connected */}
          {stxAddress && (
            <Link
              href={`/profile/${stxAddress}`}
              className="p-2 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
              title="My Profile"
            >
              <CircleUserRound size={20} strokeWidth={1.5} />
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
