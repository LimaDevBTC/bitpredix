'use client'

import { useState, useEffect } from 'react'

const KEY = 'bitpredix_seen_onboarding'

export function OnboardingBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    queueMicrotask(() => { if (!localStorage.getItem(KEY)) setVisible(true) })
  }, [])

  const dismiss = () => {
    if (typeof window === 'undefined') return
    localStorage.setItem(KEY, '1')
    setVisible(false)
  }

  if (!visible) {
    return <div className="mb-4 h-[3.25rem]" aria-hidden="true" />
  }

  return (
    <div
      className="mb-4 rounded-xl border border-bitcoin/30 bg-bitcoin/10 px-4 py-3 text-sm text-zinc-300 flex items-start justify-between gap-3"
      role="region"
      aria-label="How to start"
    >
      <p>
        <strong className="text-bitcoin">New?</strong> Choose <span className="text-up font-medium">UP</span> or <span className="text-down font-medium">DOWN</span>, enter the amount and click to trade. Rounds last 1 minute; trading closes when the round ends.
      </p>
      <button
        onClick={dismiss}
        className="shrink-0 text-bitcoin hover:text-bitcoin/80 font-medium text-xs"
      >
        Got it
      </button>
    </div>
  )
}
