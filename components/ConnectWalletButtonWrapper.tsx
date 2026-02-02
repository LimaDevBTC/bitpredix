'use client'

import dynamic from 'next/dynamic'

const ConnectWalletButton = dynamic(
  () => import('@/components/ConnectWalletButton').then((m) => m.ConnectWalletButton),
  { ssr: false }
)

export function ConnectWalletButtonWrapper() {
  return <ConnectWalletButton />
}
