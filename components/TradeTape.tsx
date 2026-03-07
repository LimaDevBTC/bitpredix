'use client'

export interface TradeTapeItem {
  id: string
  side: 'UP' | 'DOWN'
  amount: number // USD
}

export function TradeTape({ items }: { items: TradeTapeItem[] }) {
  if (items.length === 0) return null

  return (
    <div className="absolute bottom-1.5 left-1.5 sm:bottom-2 sm:left-2 z-10 pointer-events-none">
      {items.map((item) => (
        <div
          key={item.id}
          className={`
            px-1.5 py-0.5 rounded bg-zinc-900/70 backdrop-blur-sm
            font-mono text-[10px] sm:text-xs font-semibold tabular-nums
            trade-tape-float
            ${item.side === 'UP' ? 'text-up' : 'text-down'}
          `}
        >
          ${item.amount}
        </div>
      ))}

      <style jsx>{`
        .trade-tape-float {
          animation: tradeTapeFloat 4s ease-out forwards;
        }
        @keyframes tradeTapeFloat {
          0% {
            opacity: 0;
            transform: translateY(10px);
          }
          8% {
            opacity: 1;
            transform: translateY(0);
          }
          60% {
            opacity: 0.7;
          }
          100% {
            opacity: 0;
            transform: translateY(-50px);
          }
        }
      `}</style>
    </div>
  )
}
