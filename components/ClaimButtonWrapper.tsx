'use client'

import dynamic from 'next/dynamic'

const ClaimButton = dynamic(
  () => import('./ClaimButton').then((mod) => mod.ClaimButton),
  { ssr: false }
)

export function ClaimButtonWrapper() {
  return <ClaimButton />
}
