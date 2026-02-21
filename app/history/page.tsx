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
