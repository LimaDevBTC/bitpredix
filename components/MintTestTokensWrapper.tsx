'use client'

import dynamic from 'next/dynamic'

const MintTestTokens = dynamic(
  () => import('@/components/MintTestTokens').then((m) => m.MintTestTokens),
  { ssr: false }
)

export function MintTestTokensWrapper() {
  return <MintTestTokens />
}
