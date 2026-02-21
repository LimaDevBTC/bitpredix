'use client'

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
