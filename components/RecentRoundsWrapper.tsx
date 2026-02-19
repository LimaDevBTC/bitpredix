'use client'

import dynamic from 'next/dynamic'

const RecentRounds = dynamic(
  () => import('@/components/RecentRounds').then((m) => m.RecentRounds),
  { ssr: false }
)

export function RecentRoundsWrapper() {
  return <RecentRounds />
}
