'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, ExternalLink, Ticket, Trophy, Clock, TrendingUp, Info } from 'lucide-react'
import { getLocalStorage, isConnected } from '@stacks/connect'
import { Footer } from '@/components/Footer'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JackpotStatus {
  balance: number
  totalTickets: number
  userTickets: number
  userProbability: number
  countdownMs: number
  drawHourET: number
}

interface DrawResult {
  date: string
  blockHeight: number
  blockHash: string
  totalTickets: number
  winnerIndex: string
  winner: string
  prize: number
  jackpotBalanceAfter: number
  txId?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'Drawing now...'
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${h}h ${m.toString().padStart(2, '0')}m${s.toString().padStart(2, '0')}s`
}

function truncateAddress(addr: string): string {
  if (addr.length <= 16) return addr
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function JackpotPage() {
  const [status, setStatus] = useState<JackpotStatus | null>(null)
  const [draws, setDraws] = useState<DrawResult[]>([])
  const [loading, setLoading] = useState(true)
  const [address, setAddress] = useState<string | null>(null)
  const [countdownMs, setCountdownMs] = useState(0)

  // Get wallet address
  useEffect(() => {
    if (!isConnected()) return
    const data = getLocalStorage()
    setAddress(data?.addresses?.stx?.[0]?.address ?? null)
  }, [])

  // Fetch data
  const fetchData = useCallback(async () => {
    try {
      const params = address ? `?address=${address}` : ''
      const [statusRes, historyRes] = await Promise.all([
        fetch(`/api/jackpot/status${params}`),
        fetch('/api/jackpot/history'),
      ])
      const statusData = await statusRes.json()
      const historyData = await historyRes.json()

      if (statusData.ok) {
        setStatus(statusData)
        setCountdownMs(statusData.countdownMs)
      }
      if (historyData.ok && historyData.draws) {
        setDraws(historyData.draws)
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [address])

  useEffect(() => { fetchData() }, [fetchData])

  // Live countdown
  useEffect(() => {
    if (!status) return
    const id = setInterval(() => {
      setCountdownMs(prev => Math.max(0, prev - 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [status])

  // Refresh every 30s
  useEffect(() => {
    const id = setInterval(fetchData, 30_000)
    return () => clearInterval(id)
  }, [fetchData])

  return (
    <main className="min-h-screen bg-zinc-950">
      <div className="w-full max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link
            href="/"
            className="p-2 -ml-2 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
          >
            <ArrowLeft size={18} />
          </Link>
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/moneybag.png" alt="" className="w-7 h-7" />
            <h1 className="text-zinc-200 font-semibold text-lg sm:text-xl">Jackpot</h1>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-bitcoin/40 border-t-bitcoin rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-5">

            {/* Treasury Card */}
            <div className="rounded-xl bg-gradient-to-br from-yellow-900/20 via-zinc-900/80 to-zinc-900 border border-bitcoin/20 p-5 sm:p-6">
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Treasury Balance</div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl sm:text-4xl font-mono font-bold text-bitcoin">
                  ${status ? status.balance.toFixed(2) : '0.00'}
                </span>
                <span className="text-zinc-500 text-sm">USDCx</span>
              </div>

              {/* Countdown */}
              <div className="mt-4 flex items-center gap-3 text-sm">
                <Clock size={14} className="text-zinc-500" />
                <span className="text-zinc-400">Next draw in</span>
                <span className="font-mono text-zinc-200 font-medium">
                  {formatCountdown(countdownMs)}
                </span>
              </div>

              {/* Prize info */}
              <div className="mt-2 flex items-center gap-3 text-sm">
                <Trophy size={14} className="text-zinc-500" />
                <span className="text-zinc-400">Prize</span>
                <span className="font-mono text-bitcoin font-medium">
                  ${status ? (status.balance * 0.10).toFixed(2) : '0.00'}
                </span>
                <span className="text-zinc-600 text-xs">(10% of treasury)</span>
              </div>
            </div>

            {/* My Tickets */}
            {address && status && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Ticket size={16} className="text-bitcoin" />
                  <span className="text-sm font-medium text-zinc-300">My Tickets Today</span>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Tickets</div>
                    <div className="text-xl font-mono font-bold text-zinc-200 mt-0.5">
                      {status.userTickets.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Total Pool</div>
                    <div className="text-xl font-mono font-bold text-zinc-200 mt-0.5">
                      {status.totalTickets.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Win Chance</div>
                    <div className="text-xl font-mono font-bold text-bitcoin mt-0.5">
                      {status.userProbability > 0
                        ? `${(status.userProbability * 100).toFixed(1)}%`
                        : '--'}
                    </div>
                  </div>
                </div>
                {status.userTickets === 0 && (
                  <p className="text-zinc-600 text-xs mt-3">
                    Bet in the first 20 seconds of any round to earn tickets.
                  </p>
                )}
              </div>
            )}

            {/* Not connected hint */}
            {!address && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 text-center">
                <Ticket size={20} className="text-zinc-600 mx-auto mb-2" />
                <p className="text-zinc-500 text-sm">Connect your wallet to see your tickets.</p>
              </div>
            )}

            {/* Draw History */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
              <div className="px-5 pt-4 pb-2 flex items-center gap-2">
                <Trophy size={16} className="text-zinc-500" />
                <span className="text-sm font-medium text-zinc-300">Recent Draws</span>
              </div>

              {draws.length === 0 ? (
                <div className="px-5 pb-5 text-zinc-600 text-sm">
                  No draws yet. The first draw happens at 9 PM ET.
                </div>
              ) : (
                <div className="divide-y divide-zinc-800/60">
                  {draws.map(d => (
                    <div key={d.date} className="px-5 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-zinc-300 text-sm font-medium">{d.date}</div>
                        <div className="text-zinc-600 text-xs mt-0.5 flex items-center gap-1.5">
                          <span>{truncateAddress(d.winner)}</span>
                          <span className="text-zinc-700">|</span>
                          <span>{d.totalTickets.toLocaleString()} tickets</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-bitcoin font-mono font-bold text-sm">
                          +${(d.prize / 1e6).toFixed(2)}
                        </div>
                        <a
                          href={`https://mempool.space/block/${d.blockHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-zinc-600 hover:text-zinc-400 text-[10px] inline-flex items-center gap-0.5 mt-0.5"
                        >
                          Block #{d.blockHeight}
                          <ExternalLink size={8} />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* How it works */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="flex items-center gap-2 mb-4">
                <Info size={16} className="text-zinc-500" />
                <span className="text-sm font-medium text-zinc-300">How it Works</span>
              </div>

              <div className="space-y-3 text-xs text-zinc-400 leading-relaxed">
                <div className="flex gap-3">
                  <TrendingUp size={14} className="text-bitcoin shrink-0 mt-0.5" />
                  <div>
                    <span className="text-zinc-300 font-medium">Treasury grows with every round.</span>{' '}
                    1% of all trading volume is automatically deposited into the on-chain jackpot treasury.
                  </div>
                </div>

                <div className="flex gap-3">
                  <Ticket size={14} className="text-bitcoin shrink-0 mt-0.5" />
                  <div>
                    <span className="text-zinc-300 font-medium">Earn tickets by betting early.</span>{' '}
                    Bets placed in the first 20 seconds of a round earn tickets.
                    $1 = 1 ticket. First bettor or largest bet on a side gets 2x.
                    Both? 4x multiplier.
                  </div>
                </div>

                <div className="flex gap-3">
                  <Trophy size={14} className="text-bitcoin shrink-0 mt-0.5" />
                  <div>
                    <span className="text-zinc-300 font-medium">Daily draw at 9 PM ET.</span>{' '}
                    A winner is picked using the first Bitcoin block hash after 9 PM ET.
                    Prize is 10% of the treasury. The jackpot never zeros out.
                  </div>
                </div>

                <div className="flex gap-3">
                  <ExternalLink size={14} className="text-zinc-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="text-zinc-300 font-medium">Fully verifiable.</span>{' '}
                    Treasury balance is on-chain. Draw results use a public Bitcoin block hash.
                    Anyone can reproduce the winner calculation.
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}

        <Footer />
      </div>
    </main>
  )
}
