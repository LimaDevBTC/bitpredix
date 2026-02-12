'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { getLocalStorage, openContractCall, isConnected } from '@stacks/connect'
import { uintCV, contractPrincipalCV, stringAsciiCV, Pc } from '@stacks/transactions'
import { BtcPrice } from './BtcPrice'
import { Countdown } from './Countdown'
import dynamic from 'next/dynamic'
import type { BtcPricePoint } from './BtcPriceChart'

const BtcPriceChart = dynamic(() => import('./BtcPriceChart'), {
  ssr: false,
  loading: () => <div className="w-full h-[220px] sm:h-[280px] lg:h-[320px] rounded-xl bg-zinc-900/50 animate-pulse" />,
})
import { usePythPrice } from '@/lib/pyth'

const BITPREDIX_CONTRACT = process.env.NEXT_PUBLIC_BITPREDIX_CONTRACT_ID || 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.bitpredix-v5'
const TOKEN_CONTRACT = process.env.NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID || 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.test-usdcx'
const MAX_APPROVE_AMOUNT = BigInt('1000000000000') // 1 million USD (6 decimals)

type Side = 'UP' | 'DOWN'

const ROUND_DURATION_MS = 60 * 1000  // 60 segundos
const TRADING_WINDOW_MS = 48 * 1000  // Trading fecha 12s antes do fim
const MIN_BET_USD = 1

interface RoundInfo {
  id: number
  startAt: number
  endsAt: number
  tradingClosesAt: number
  priceAtStart: number | null
}

function formatRoundId(roundId: number): string {
  const ts = roundId * 60 * 1000
  const d = new Date(ts)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hour = String(d.getHours()).padStart(2, '0')
  const minute = String(d.getMinutes()).padStart(2, '0')
  return `#${year}${month}${day}${hour}${minute}`
}

function getCurrentRoundInfo(): RoundInfo {
  const now = Date.now()
  const roundId = Math.floor(now / ROUND_DURATION_MS)
  const startAt = roundId * ROUND_DURATION_MS
  const endsAt = startAt + ROUND_DURATION_MS
  const tradingClosesAt = startAt + TRADING_WINDOW_MS

  return {
    id: roundId,
    startAt,
    endsAt,
    tradingClosesAt,
    priceAtStart: null
  }
}

interface PoolData {
  totalUp: number    // USD in UP pool
  totalDown: number  // USD in DOWN pool
  priceUp: number    // 0-1 implied probability
  priceDown: number  // 0-1 implied probability
}

const FEE_BPS = 0.03 // 3% fee

function calcPayout(amount: number, sidePool: number, totalPool: number): number {
  if (sidePool + amount <= 0) return 0
  return ((amount / (sidePool + amount)) * (totalPool + amount)) * (1 - FEE_BPS)
}

export function MarketCardV4() {
  const [round, setRound] = useState<RoundInfo | null>(null)
  const [amount, setAmount] = useState('')
  const [trading, setTrading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [roundBets, setRoundBets] = useState<{ roundId: number; up: number; down: number } | null>(null)
  const [stxAddress, setStxAddress] = useState<string | null>(null)
  const [btcPriceHistory, setBtcPriceHistory] = useState<BtcPricePoint[]>([])
  const [pool, setPool] = useState<PoolData | null>(null)

  const lastRoundIdRef = useRef<number | null>(null)
  const openPriceRef = useRef<number | null>(null)

  // Pyth price em tempo real
  const { price: currentPrice, loading: priceLoading } = usePythPrice()

  // Atualiza round a cada segundo
  useEffect(() => {
    const updateRound = () => {
      const newRound = getCurrentRoundInfo()

      // Se mudou de round, reseta apostas mas mantém gráfico contínuo
      if (lastRoundIdRef.current !== newRound.id) {
        lastRoundIdRef.current = newRound.id
        openPriceRef.current = currentPrice
        setRoundBets(null)
        setPool(null)
      }

      // Atualiza preco de abertura se ainda nao temos
      if (!openPriceRef.current && currentPrice) {
        openPriceRef.current = currentPrice
      }

      setRound({
        ...newRound,
        priceAtStart: openPriceRef.current
      })
    }

    updateRound()
    const interval = setInterval(updateRound, 1000)
    return () => clearInterval(interval)
  }, [currentPrice])

  // Poll pool data from blockchain every 8s
  useEffect(() => {
    if (!round) return
    let cancelled = false

    const fetchPool = async () => {
      try {
        const res = await fetch('/api/round')
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (cancelled || !data.ok) return
        const qUp = data.round?.pool?.qUp ?? 0
        const qDown = data.round?.pool?.qDown ?? 0
        // Never regress below optimistic values — blockchain tx may not be confirmed yet
        // Pool values can only increase during a round (bets are irrevocable)
        setPool(prev => {
          const up = Math.max(qUp, prev?.totalUp ?? 0)
          const down = Math.max(qDown, prev?.totalDown ?? 0)
          const total = up + down
          return {
            totalUp: up,
            totalDown: down,
            priceUp: total > 0 ? up / total : 0.5,
            priceDown: total > 0 ? down / total : 0.5,
          }
        })
      } catch { /* ignore */ }
    }

    fetchPool()
    const interval = setInterval(fetchPool, 8000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [round?.id])

  // Estado de allowance (verifica no blockchain via API)
  const [tradingEnabled, setTradingEnabled] = useState<boolean | null>(null)
  const [checkingAllowance, setCheckingAllowance] = useState(false)

  // Verifica allowance no blockchain
  const checkAllowance = useCallback(async (addr: string) => {
    if (!addr || !BITPREDIX_CONTRACT) {
      setTradingEnabled(false)
      return
    }

    const cacheKey = `bitpredix_trading_enabled_${addr}_${BITPREDIX_CONTRACT}`
    const cachedEnabled = localStorage.getItem(cacheKey) === 'true'

    setCheckingAllowance(true)
    try {
      const response = await fetch(`/api/allowance-status?address=${encodeURIComponent(addr)}`)
      const data = await response.json()

      console.log('[MarketCardV4] Allowance check:', data)

      if (data.ok) {
        if (data.hasAllowance === true) {
          setTradingEnabled(true)
          localStorage.setItem(cacheKey, 'true')
        } else if (cachedEnabled) {
          // Blockchain diz sem allowance mas cache diz que tem
          // Provável que a tx de approve ainda não confirmou (testnet ~30-60s)
          // Mantém trading habilitado pelo cache
          console.log('[MarketCardV4] Blockchain says no allowance but cache says enabled, trusting cache')
          setTradingEnabled(true)
        } else {
          setTradingEnabled(false)
        }
      } else {
        // API falhou - usa localStorage como fallback
        setTradingEnabled(cachedEnabled)
      }
    } catch {
      // Erro de rede - usa localStorage como fallback
      setTradingEnabled(cachedEnabled)
    } finally {
      setCheckingAllowance(false)
    }
  }, [])

  // Busca endereco da carteira
  useEffect(() => {
    const refreshAddress = () => {
      if (!isConnected()) {
        setStxAddress(null)
        setTradingEnabled(false)
        return
      }
      const data = getLocalStorage()
      const addr = data?.addresses?.stx?.[0]?.address ?? null

      if (addr !== stxAddress) {
        setStxAddress(addr)
        if (addr) {
          // Usa cache do localStorage imediatamente para evitar flicker
          const cacheKey = `bitpredix_trading_enabled_${addr}_${BITPREDIX_CONTRACT}`
          if (localStorage.getItem(cacheKey) === 'true') {
            setTradingEnabled(true)
          }
          // Depois verifica no blockchain
          checkAllowance(addr)
        }
      }
    }
    refreshAddress()
    const interval = setInterval(refreshAddress, 2500)
    return () => clearInterval(interval)
  }, [stxAddress, checkAllowance])

  // Adiciona pontos ao historico de precos BTC (mantém últimos 5 min)
  useEffect(() => {
    if (!round || !currentPrice) return
    const timeSec = Math.floor(Date.now() / 1000)
    setBtcPriceHistory(prev => {
      let next: BtcPricePoint[]
      const last = prev[prev.length - 1]
      if (last && last.time === timeSec) {
        next = [...prev.slice(0, -1), { time: timeSec, price: currentPrice }]
      } else {
        next = [...prev, { time: timeSec, price: currentPrice }]
      }
      // Cap at 300 entries (~5 min at 1/s) to prevent unbounded growth
      if (next.length > 300) next = next.slice(-300)
      return next
    })
  }, [currentPrice, round])

  // Habilita trading (approve de valor alto, uma vez só)
  const enableTrading = async () => {
    if (!stxAddress) {
      setError('Connect wallet first')
      return
    }

    setTrading(true)
    setError(null)

    const [tokenAddr, tokenName] = TOKEN_CONTRACT.split('.')
    const [bitpredixAddr, bitpredixName] = BITPREDIX_CONTRACT.split('.')
    if (!tokenAddr || !tokenName || !bitpredixAddr || !bitpredixName) {
      setError('Token contract not configured')
      setTrading(false)
      return
    }

    try {
      await new Promise<void>((resolve, reject) => {
        openContractCall({
          contractAddress: tokenAddr,
          contractName: tokenName,
          functionName: 'approve',
          functionArgs: [
            contractPrincipalCV(bitpredixAddr, bitpredixName),
            uintCV(MAX_APPROVE_AMOUNT)
          ],
          network: 'testnet',
          onFinish: () => {
            // Salva no localStorage como cache imediato
            const key = `bitpredix_trading_enabled_${stxAddress}_${BITPREDIX_CONTRACT}`
            localStorage.setItem(key, 'true')
            setTradingEnabled(true)
            resolve()
          },
          onCancel: () => reject(new Error('Cancelled'))
        })
      })
    } catch (e) {
      if (e instanceof Error && e.message !== 'Cancelled') {
        setError(e.message)
      }
    } finally {
      setTrading(false)
    }
  }

  const buy = async (side: Side) => {
    const v = parseFloat(amount)
    if (isNaN(v) || v <= 0) {
      setError('Enter a valid amount')
      return
    }
    if (v < MIN_BET_USD) {
      setError(`Min. $${MIN_BET_USD} to bet`)
      return
    }
    if (!round) {
      setError('No active round')
      return
    }
    if (Date.now() >= round.tradingClosesAt) {
      setError('Trading closed for this round')
      return
    }
    if (!stxAddress) {
      setError('Connect wallet first')
      return
    }
    if (!tradingEnabled) {
      setError('Enable trading first (click button below)')
      return
    }

    setTrading(true)
    setError(null)

    const [bpAddr, bpName] = BITPREDIX_CONTRACT.split('.')
    if (!bpAddr || !bpName) {
      setError('Contract not configured')
      setTrading(false)
      return
    }

    const amountMicro = Math.round(v * 1e6) // 6 decimais

    try {
      // Post-condition: usuário envia no máximo amountMicro de test-usdcx
      // Pc namespace pode falhar no bundler (mesmo bug do Cl), então usamos try-catch
      const [tokenAddr, tokenName] = TOKEN_CONTRACT.split('.')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let postConditions: any[] = []
      try {
        if (tokenAddr && tokenName) {
          postConditions = [
            Pc.principal(stxAddress)
              .willSendLte(amountMicro)
              .ft(`${tokenAddr}.${tokenName}`, 'test-usdcx')
          ]
        }
      } catch (pcError) {
        console.warn('[MarketCardV4] Post-condition builder failed, proceeding without:', pcError)
      }

      await new Promise<void>((resolve, reject) => {
        openContractCall({
          contractAddress: bpAddr,
          contractName: bpName,
          functionName: 'place-bet',
          functionArgs: [
            uintCV(round.id),
            stringAsciiCV(side),
            uintCV(amountMicro)
          ],
          postConditions,
          network: 'testnet',
          onFinish: (data) => {
            console.log('Bet placed:', data.txId)
            resolve()
          },
          onCancel: () => reject(new Error('Cancelled'))
        })
      })

      // Sucesso — acumula apostas no round atual
      const prevBets = (roundBets?.roundId === round.id) ? roundBets : { roundId: round.id, up: 0, down: 0 }
      setRoundBets({
        roundId: round.id,
        up: prevBets.up + (side === 'UP' ? v : 0),
        down: prevBets.down + (side === 'DOWN' ? v : 0),
      })
      setAmount('')

      // Optimistic pool update — reflect bet instantly in UI
      setPool(prev => {
        const up = (prev?.totalUp ?? 0) + (side === 'UP' ? v : 0)
        const down = (prev?.totalDown ?? 0) + (side === 'DOWN' ? v : 0)
        const total = up + down
        return {
          totalUp: up,
          totalDown: down,
          priceUp: total > 0 ? up / total : 0.5,
          priceDown: total > 0 ? down / total : 0.5,
        }
      })

      // Dispara evento para atualizar saldo em outros componentes
      window.dispatchEvent(new CustomEvent('bitpredix:balance-changed'))

    } catch (e) {
      if (e instanceof Error && e.message !== 'Cancelled') {
        setError(e.message)
      }
    } finally {
      setTrading(false)
    }
  }

  const PRESETS = [5, 10, 50, 100] as const

  const now = Date.now()
  const isTradingOpen = round && now < round.tradingClosesAt
  const canTrade = isTradingOpen && stxAddress && !trading

  const amountNum = parseFloat(amount)
  const hasValidAmount = !isNaN(amountNum) && amountNum >= MIN_BET_USD

  // Delta entre preço atual e preço de abertura
  const priceDelta = currentPrice && openPriceRef.current
    ? currentPrice - openPriceRef.current
    : null

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 bg-grid-pattern overflow-hidden">
      {/* Header */}
      <div className="px-3 sm:px-6 py-2.5 sm:py-3.5 border-b border-zinc-800 space-y-2 sm:space-y-3">
        {/* Row 1: Title + Timer */}
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-semibold text-zinc-200 leading-tight">
              BTC next minute
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px] sm:text-xs font-mono text-zinc-400">
                {round ? formatRoundId(round.id) : '—'}
              </span>
              <span className="text-[9px] sm:text-[10px] text-emerald-400/80">
                v4 · Pyth Oracle
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end shrink-0">
            <p className="text-[9px] sm:text-[10px] text-zinc-500 uppercase tracking-wider font-medium">
              Time Left
            </p>
            {round ? (
              <Countdown
                endsAt={round.endsAt}
                serverTimeSkew={0}
                onEnd={() => {}}
                onTick={() => {}}
                className="text-xl sm:text-3xl font-bold text-amber-400 leading-none tabular-nums"
              />
            ) : (
              <span className="text-xl sm:text-3xl font-bold font-mono text-zinc-600 leading-none">—</span>
            )}
          </div>
        </div>

        {/* Row 2: Prices */}
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[9px] sm:text-[10px] text-zinc-500 uppercase tracking-wider font-medium">
              Price to Beat
            </p>
            <span className="font-mono text-sm sm:text-lg font-bold text-zinc-300 leading-none">
              ${round?.priceAtStart?.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              }) ?? '—'}
            </span>
          </div>
          <div className="text-right">
            <p className="text-[9px] sm:text-[10px] text-zinc-500 uppercase tracking-wider font-medium flex items-center justify-end gap-1">
              Current Price
              {priceDelta !== null && (
                <span className={`font-mono ${priceDelta >= 0 ? 'text-up' : 'text-down'}`}>
                  {priceDelta >= 0 ? '▲' : '▼'}${Math.abs(priceDelta).toFixed(0)}
                </span>
              )}
            </p>
            <span className="font-mono text-sm sm:text-lg font-bold text-bitcoin leading-none">
              <BtcPrice />
            </span>
          </div>
        </div>
      </div>

      <div className="px-3 pt-3 pb-2 sm:p-6">
        {/* Mensagens */}
        <div className="h-16 mb-3 flex items-stretch">
          <div className="w-full flex items-center">
            {error ? (
              <div className="w-full h-full px-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center justify-between gap-2">
                <span className="flex-1">{error}</span>
                <button
                  onClick={() => setError(null)}
                  className="px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 text-xs font-medium shrink-0"
                >
                  Dismiss
                </button>
              </div>
            ) : trading ? (
              <div className="w-full h-full px-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm flex items-center gap-3">
                <div className="h-5 w-5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin shrink-0" />
                <p className="font-medium">Awaiting wallet approval...</p>
              </div>
            ) : roundBets && roundBets.roundId === round?.id && (roundBets.up > 0 || roundBets.down > 0) ? (
              <div className="w-full h-full px-4 rounded-lg bg-zinc-800/80 text-zinc-400 text-sm flex items-center gap-1">
                <span className="text-zinc-500">Your bets: </span>
                {roundBets.up > 0 && <span className="text-up font-medium">${roundBets.up} UP</span>}
                {roundBets.up > 0 && roundBets.down > 0 && <span className="text-zinc-600"> | </span>}
                {roundBets.down > 0 && <span className="text-down font-medium">${roundBets.down} DOWN</span>}
              </div>
            ) : isTradingOpen ? (
              <div className="w-full h-full px-4 rounded-lg bg-zinc-800/60 text-zinc-400 text-sm border border-zinc-700/50 flex flex-col justify-center">
                <p className="font-medium text-zinc-300 leading-tight">Market open</p>
                <p className="text-xs text-zinc-500 mt-0.5 leading-tight">
                  Choose UP or DOWN and enter the amount to bet
                </p>
              </div>
            ) : (
              <div className="w-full h-full px-4 rounded-lg bg-zinc-800/60 text-amber-400/90 text-sm border border-zinc-700/50 flex items-center justify-center">
                Trading closed. Next round starting...
              </div>
            )}
          </div>
        </div>

        {/* BTC Price Chart (full width, Polymarket style) */}
        <div className="mb-3 sm:mb-4 rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
          {round && (
            <BtcPriceChart
              data={btcPriceHistory}
              openPrice={openPriceRef.current}
              roundStartAt={round.startAt}
              roundEndsAt={round.endsAt}
            />
          )}
        </div>

        {/* Trading Controls */}
        <div className="space-y-3 sm:space-y-4">
          {/* UP/DOWN Buttons */}
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <button
              onClick={() => buy('UP')}
              disabled={!canTrade}
              className="flex flex-col items-center justify-center rounded-xl bg-up py-2.5 sm:py-3 text-white transition hover:bg-up/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="text-base sm:text-lg font-bold leading-tight">Up</span>
              <span className="text-[11px] sm:text-xs font-mono opacity-90 leading-tight">
                {Math.round((pool?.priceUp ?? 0.5) * 100)}¢ · {((pool?.priceUp ?? 0.5) > 0 ? (1 / (pool?.priceUp ?? 0.5)) : 2).toFixed(1)}x
              </span>
            </button>
            <button
              onClick={() => buy('DOWN')}
              disabled={!canTrade}
              className="flex flex-col items-center justify-center rounded-xl bg-down py-2.5 sm:py-3 text-white transition hover:bg-down/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="text-base sm:text-lg font-bold leading-tight">Down</span>
              <span className="text-[11px] sm:text-xs font-mono opacity-90 leading-tight">
                {Math.round((pool?.priceDown ?? 0.5) * 100)}¢ · {((pool?.priceDown ?? 0.5) > 0 ? (1 / (pool?.priceDown ?? 0.5)) : 2).toFixed(1)}x
              </span>
            </button>
          </div>

          {/* Pool ratio bar */}
          {(() => {
            const total = (pool?.totalUp ?? 0) + (pool?.totalDown ?? 0)
            const upPct = total > 0 ? ((pool?.totalUp ?? 0) / total) * 100 : 50
            return (
              <div className="space-y-1">
                <div className="h-1.5 rounded-full overflow-hidden flex bg-zinc-800">
                  <div className="bg-up/70 transition-all duration-500" style={{ width: `${upPct}%` }} />
                  <div className="bg-down/70 transition-all duration-500" style={{ width: `${100 - upPct}%` }} />
                </div>
                <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                  <span>{Math.round(upPct)}% Up</span>
                  <span>${total.toLocaleString('en-US', { maximumFractionDigits: 0 })} pool</span>
                  <span>{Math.round(100 - upPct)}% Down</span>
                </div>
              </div>
            )
          })()}

          {/* Amount Input */}
          <div>
            {isTradingOpen ? (
              stxAddress ? (
                checkingAllowance ? (
                  <div className="flex items-center justify-center min-h-[4.5rem] py-2">
                    <div className="flex items-center gap-2 text-zinc-400">
                      <div className="h-4 w-4 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm">Checking approval status...</span>
                    </div>
                  </div>
                ) : tradingEnabled !== true ? (
                  <div className="space-y-3">
                    <div className="px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm">
                      <p className="font-medium">Enable trading to place bets</p>
                      <p className="text-xs text-amber-300/70 mt-1">
                        One-time approval to allow the contract to use your USDCx
                      </p>
                    </div>
                    <button
                      onClick={enableTrading}
                      disabled={trading}
                      className="w-full py-3 rounded-xl bg-bitcoin/20 border border-bitcoin/50 text-bitcoin font-semibold hover:bg-bitcoin/30 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                      {trading ? 'Awaiting approval...' : 'Enable Trading'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-zinc-500 uppercase tracking-wider">Amount (USD)</p>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {PRESETS.map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setAmount(String(d))}
                          className={`px-3 py-1.5 rounded-lg font-mono text-sm transition ${
                            amount === String(d)
                              ? 'bg-bitcoin/30 text-bitcoin border border-bitcoin/50'
                              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
                          }`}
                        >
                          ${d}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="Custom"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="flex-1 font-mono px-4 py-3 rounded-xl bg-zinc-800/80 border border-zinc-700 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-bitcoin/50 focus:border-bitcoin"
                      />
                      <span className="flex items-center px-2 text-zinc-500 text-sm">USD</span>
                    </div>
                    {/* Payout estimate */}
                    {hasValidAmount && (
                      <div className="flex gap-2 text-[11px] font-mono text-zinc-500 px-1">
                        <span className="text-up">
                          Up win: ${calcPayout(amountNum, pool?.totalUp ?? 0, (pool?.totalUp ?? 0) + (pool?.totalDown ?? 0)).toFixed(2)}
                          <span className="text-zinc-600 ml-0.5">
                            ({((pool?.totalUp ?? 0) + (pool?.totalDown ?? 0) > 0
                              ? (calcPayout(amountNum, pool?.totalUp ?? 0, (pool?.totalUp ?? 0) + (pool?.totalDown ?? 0)) / amountNum).toFixed(1)
                              : (1 / (1 - FEE_BPS)).toFixed(1)
                            )}x)
                          </span>
                        </span>
                        <span className="text-zinc-700">|</span>
                        <span className="text-down">
                          Down win: ${calcPayout(amountNum, pool?.totalDown ?? 0, (pool?.totalUp ?? 0) + (pool?.totalDown ?? 0)).toFixed(2)}
                          <span className="text-zinc-600 ml-0.5">
                            ({((pool?.totalUp ?? 0) + (pool?.totalDown ?? 0) > 0
                              ? (calcPayout(amountNum, pool?.totalDown ?? 0, (pool?.totalUp ?? 0) + (pool?.totalDown ?? 0)) / amountNum).toFixed(1)
                              : (1 / (1 - FEE_BPS)).toFixed(1)
                            )}x)
                          </span>
                        </span>
                      </div>
                    )}
                  </div>
                )
              ) : (
                <div className="flex items-center justify-center min-h-[4.5rem] py-2">
                  <p className="text-center text-amber-400/90 text-sm">
                    Connect wallet to trade
                  </p>
                </div>
              )
            ) : (
              <div className="flex items-center justify-center min-h-[4.5rem] py-2">
                <p className="text-center text-zinc-500 text-sm">
                  Waiting for next round...
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
