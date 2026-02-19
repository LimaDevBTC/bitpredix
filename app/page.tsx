import Link from 'next/link'
import { MarketCardV4Wrapper } from '@/components/MarketCardV4Wrapper'
import { ConnectWalletButtonWrapper } from '@/components/ConnectWalletButtonWrapper'
import { MintTestTokensWrapper } from '@/components/MintTestTokensWrapper'
import { ClaimButtonWrapper } from '@/components/ClaimButtonWrapper'
import { WalletHistoryWrapper } from '@/components/WalletHistoryWrapper'

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 bg-grid-pattern">
      <div className="w-full max-w-2xl lg:max-w-6xl xl:max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-10">
        <header className="mb-6 sm:mb-8">
          {/* Desktop: uma linha */}
          <div className="hidden sm:flex sm:items-center sm:justify-between sm:gap-4">
            <Link href="/" className="font-bold text-2xl tracking-tight shrink-0">
              <span className="text-bitcoin">Bit</span>
              <span className="text-zinc-100">predix</span>
            </Link>
            <div className="flex items-center gap-3">
              <ClaimButtonWrapper />
              <MintTestTokensWrapper />
              <ConnectWalletButtonWrapper />
            </div>
          </div>

          {/* Mobile: layout compacto */}
          <div className="sm:hidden space-y-2">
            <div className="flex items-center justify-between">
              <Link href="/" className="font-bold text-xl tracking-tight">
                <span className="text-bitcoin">Bit</span>
                <span className="text-zinc-100">predix</span>
              </Link>
              <div className="flex items-center gap-2">
                <MintTestTokensWrapper />
                <ConnectWalletButtonWrapper />
              </div>
            </div>
            <div className="flex items-center justify-end">
              <ClaimButtonWrapper />
            </div>
          </div>
        </header>

        <MarketCardV4Wrapper />

        <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5 text-sm text-zinc-400">
          <h3 className="font-semibold text-zinc-300 mb-2">How it works</h3>
          <ul className="space-y-1.5">
            <li>• Each round lasts <strong className="text-zinc-300">1 minute</strong>.</li>
            <li>• Trading closes <strong className="text-zinc-300">when the round ends</strong> (no early cutoff).</li>
            <li>• Buy <strong className="text-up">UP</strong> if you think the price will rise, <strong className="text-down">DOWN</strong> if you think it will fall.</li>
            <li>• UP and DOWN prices are set by an AMM (LMSR).</li>
            <li>• At the end of the minute: if price went up, UP pays $1 per share; if it went down, DOWN pays $1 per share.</li>
          </ul>
        </section>

        <WalletHistoryWrapper />

        <footer className="mt-12 pt-8 border-t border-zinc-800/50">
          <div className="flex flex-col items-center gap-4 text-xs text-zinc-500">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-zinc-400">
                <span className="text-bitcoin">Bit</span>predix
              </span>
              <span className="text-zinc-600">·</span>
              <span className="text-zinc-500">beta version 0.0.1</span>
            </div>
            <div className="text-zinc-600">
              © 2026 Bitpredix. All rights reserved.
            </div>
            <div className="text-zinc-600/80 text-[10px] max-w-md text-center leading-relaxed">
              This is a beta version. Trading is simulated. Not financial advice.
            </div>
          </div>
        </footer>
      </div>
    </main>
  )
}
