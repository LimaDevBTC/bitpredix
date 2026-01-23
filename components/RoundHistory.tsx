'use client'

import { useEffect, useState } from 'react'

type Side = 'UP' | 'DOWN'

interface Round {
  id: string
  outcome?: Side
  status: string
}

export function RoundHistory() {
  const [rounds, setRounds] = useState<Round[]>([])

  useEffect(() => {
    const fetchRounds = async () => {
      try {
        const res = await fetch('/api/rounds')
        const data = await res.json()
        if (data.ok && Array.isArray(data.rounds)) {
          // Filtra apenas rounds resolvidos e pega os 5 mais recentes
          // A API já retorna ordenado por mais recente primeiro
          const resolved = data.rounds
            .filter((r: Round) => r.status === 'RESOLVED' && (r.outcome === 'UP' || r.outcome === 'DOWN'))
            .slice(0, 5) // Pega os 5 mais recentes (já ordenados)
          setRounds(resolved)
        }
      } catch {
        // ignore
      }
    }
    
    fetchRounds()
    const id = setInterval(fetchRounds, 3000)
    return () => clearInterval(id)
  }, [])

  if (rounds.length === 0) {
    return null
  }

  return (
    <div className="flex items-center gap-1">
      {rounds.map((round, i) => (
        <div
          key={round.id}
          className={`w-2 h-2 rounded-full transition-opacity hover:opacity-80 ${
            round.outcome === 'UP' 
              ? 'bg-up' 
              : 'bg-down'
          }`}
          title={`Round ${round.id} - ${round.outcome}`}
          aria-label={`Round ${i + 1}: ${round.outcome}`}
        />
      ))}
    </div>
  )
}
