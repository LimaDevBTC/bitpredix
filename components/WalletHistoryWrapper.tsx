'use client'

import dynamic from 'next/dynamic'

const WalletHistory = dynamic(
  () => import('@/components/WalletHistory').then((m) => m.WalletHistory),
  { ssr: false }
)

export function WalletHistoryWrapper() {
  return <WalletHistory />
}
