'use client'

import dynamic from 'next/dynamic'

const MarketCardV4 = dynamic(
  () => import('@/components/MarketCardV4').then((m) => m.MarketCardV4),
  { ssr: false }
)

export function MarketCardV4Wrapper() {
  return <MarketCardV4 />
}
