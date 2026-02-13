'use client'

import { useEffect, useRef, useState } from 'react'

interface CountdownProps {
  endsAt: number
  /** Skew em ms: serverNow - clientNow no momento do fetch. Corrige countdown em produção (Vercel vs cliente). */
  serverTimeSkew?: number
  onEnd?: () => void
  onTick?: (secondsLeft: number) => void
  className?: string
}

export function Countdown({ endsAt, serverTimeSkew = 0, onEnd, onTick, className = '' }: CountdownProps) {
  const [secs, setSecs] = useState(0)
  const hasCalledOnEndRef = useRef(false)

  useEffect(() => {
    hasCalledOnEndRef.current = false
  }, [endsAt])

  useEffect(() => {
    const tick = () => {
      const now = Date.now() + serverTimeSkew
      const raw = Math.floor((endsAt - now) / 1000)
      const left = Math.max(0, Math.min(60, raw))
      setSecs(left)
      onTick?.(left)
      if (left <= 0 && onEnd && !hasCalledOnEndRef.current) {
        hasCalledOnEndRef.current = true
        onEnd()
      }
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [endsAt, serverTimeSkew, onEnd, onTick])

  const m = Math.floor(secs / 60)
  const s = secs % 60
  const urgent = secs > 0 && secs <= 10
  const ended = secs === 0

  return (
    <span
      className={`font-mono tabular-nums ${className} ${urgent ? 'text-red-400 animate-pulse' : ended ? 'text-zinc-500' : ''}`}
    >
      {ended ? '0:00' : `${m}:${s.toString().padStart(2, '0')}`}
    </span>
  )
}
