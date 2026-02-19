'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { RoundExplorer } from '@/components/RoundExplorer'

function HistoryContent() {
  const searchParams = useSearchParams()
  const roundParam = searchParams.get('round')
  const initialRoundId = roundParam ? parseInt(roundParam) : undefined

  return (
    <main className="min-h-screen bg-zinc-950">
      <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Header */}
        <header className="mb-6 sm:mb-8">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link href="/" className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logo.png"
                  alt="Bitpredix"
                  className="h-10 sm:h-12 w-auto"
                  style={{ clipPath: 'inset(10% 0)' }}
                />
              </Link>
              <div className="h-6 w-px bg-zinc-800" />
              <h1 className="text-zinc-200 font-semibold text-lg sm:text-xl">
                Round History
              </h1>
            </div>
            <Link
              href="/"
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Back to predictions
            </Link>
          </div>
          <p className="text-zinc-500 text-xs mt-2 sm:mt-3">
            Complete transparency — every round, every prediction, every outcome.
          </p>
        </header>

        {/* Explorer */}
        <RoundExplorer initialRoundId={initialRoundId} />

        {/* Footer */}
        <footer className="mt-12 pt-6 border-t border-zinc-800/50 text-center">
          <div className="text-[10px] text-zinc-600">
            All data sourced from Stacks blockchain. Rounds are indexed from contract transactions.
          </div>
        </footer>
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
