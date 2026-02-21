'use client'

import { useParams } from 'next/navigation'
import { Suspense } from 'react'
import dynamic from 'next/dynamic'

const ProfilePage = dynamic(() => import('@/components/ProfilePage'), {
  ssr: false,
  loading: () => (
    <main className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="flex items-center gap-2 text-zinc-500 text-sm">
        <div className="h-4 w-4 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" />
        Loading profile...
      </div>
    </main>
  ),
})

export default function ProfileRoute() {
  const params = useParams()
  const address = params.address as string

  return (
    <Suspense fallback={null}>
      <ProfilePage address={address} />
    </Suspense>
  )
}
