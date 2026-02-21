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

const BITPREDIX_CONTRACT = process.env.NEXT_PUBLIC_BITPREDIX_CONTRACT_ID || 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.predixv1'
const TOKEN_CONTRACT = process.env.NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID || 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.test-usdcx'
const MAX_APPROVE_AMOUNT = BigInt('1000000000000') // 1 million USD (6 decimals)

type Side = 'UP' | 'DOWN'

const ROUND_DURATION_MS = 60 * 1000  // 60 segundos
const TRADING_WINDOW_MS = 55 * 1000  // Trading fecha 5s antes do fim do round
const MIN_BET_USD = 1

interface RoundInfo {
  id: number
  startAt: number
  endsAt: number
  tradingClosesAt: number
  priceAtStart: number | null
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

export function MarketCardV4() {
  const [round, setRound] = useState<RoundInfo | null>(null)
  const [amount, setAmount] = useState('')
  const [trading, setTrading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [roundBets, setRoundBets] = useState<{ roundId: number; up: number; down: number } | null>(null)
  const [stxAddress, setStxAddress] = useState<string | null>(null)
  const [btcPriceHistory, setBtcPriceHistory] = useState<BtcPricePoint[]>([])
  const [pool, setPool] = useState<PoolData | null>(null)
  const [recentRounds, setRecentRounds] = useState<{ id: string; outcome: 'UP' | 'DOWN' }[]>([])

  const roundId = round?.id ?? null
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
  }, [roundId])

  // Fetch recent round outcomes from Pyth 1-min candle data
  // Re-runs on round change + delayed retry (candle may not be available instantly)
  useEffect(() => {
    let cancelled = false
    const fetchHistory = async () => {
      try {
        const currentRoundId = Math.floor(Date.now() / 60000)
        const from = (currentRoundId - 6) * 60
        const to = currentRoundId * 60
        const res = await fetch(`/api/pyth-price?from=${from}&to=${to}`)
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (cancelled || !data.ok) return

        const timestamps: number[] = data.timestamps || []
        const opens: number[] = data.open || []
        const closes: number[] = data.close || []

        if (timestamps.length === 0) return

        const results: { id: string; outcome: 'UP' | 'DOWN' }[] = []
        for (let i = 0; i < timestamps.length; i++) {
          const roundId = Math.floor(timestamps[i] / 60)
          if (roundId >= currentRoundId) continue
          results.push({
            id: String(roundId),
            outcome: closes[i] > opens[i] ? 'UP' : 'DOWN',
          })
        }

        setRecentRounds(results.slice(-5))
      } catch { /* ignore */ }
    }
    fetchHistory()
    // Retry after 3s — Pyth candle for the just-ended round may not be ready immediately
    const retryId = setTimeout(fetchHistory, 3000)
    return () => { cancelled = true; clearTimeout(retryId) }
  }, [roundId])

  // Estado de allowance (verifica no blockchain via API)
  const [tradingEnabled, setTradingEnabled] = useState<boolean | null>(null)
  const [checkingAllowance, setCheckingAllowance] = useState(false)
  const [tokenBalance, setTokenBalance] = useState(0) // USD (already divided by 1e6)
  const [canMint, setCanMint] = useState(false)
  const [mintingTokens, setMintingTokens] = useState(false)
  const mintSubmittedRef = useRef(0)

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

      // Fetch balance + canMint in parallel (non-blocking)
      fetch(`/api/mint-status?address=${encodeURIComponent(addr)}`)
        .then(r => r.json())
        .then(d => {
          if (d.ok) {
            if (d.balance) setTokenBalance(Number(d.balance) / 1e6)
            if (d.canMint !== true || !mintSubmittedRef.current) setCanMint(d.canMint === true)
          }
        })
        .catch(() => {})

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

  // Atualiza saldo do token após apostas/claims
  useEffect(() => {
    const refreshBalance = () => {
      if (!stxAddress) return
      fetch(`/api/mint-status?address=${encodeURIComponent(stxAddress)}`)
        .then(r => r.json())
        .then(d => {
          if (d.ok) {
            if (d.balance) setTokenBalance(Number(d.balance) / 1e6)
            if (d.canMint !== true || !mintSubmittedRef.current) setCanMint(d.canMint === true)
          }
        })
        .catch(() => {})
    }
    window.addEventListener('bitpredix:balance-changed', refreshBalance)
    return () => window.removeEventListener('bitpredix:balance-changed', refreshBalance)
  }, [stxAddress])

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

  // Mint test tokens (onboarding step after approval)
  const mintTokens = async () => {
    const [tokenAddr, tokenName] = TOKEN_CONTRACT.split('.')
    if (!tokenAddr || !tokenName) {
      setError('Token contract not configured')
      return
    }
    setMintingTokens(true)
    setError(null)
    try {
      await new Promise<void>((resolve, reject) => {
        openContractCall({
          contractAddress: tokenAddr,
          contractName: tokenName,
          functionName: 'mint',
          functionArgs: [],
          network: 'testnet',
          onFinish: () => {
            mintSubmittedRef.current = Date.now()
            setCanMint(false)
            window.dispatchEvent(new CustomEvent('bitpredix:balance-changed'))
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
      setMintingTokens(false)
    }
  }

  // Valida e executa a aposta direto (wallet já serve de confirmação)
  const buy = async (side: Side) => {
    const v = parseFloat(amount)
    if (isNaN(v) || v <= 0) {
      setError('Enter a valid amount')
      return
    }
    if (v < MIN_BET_USD) {
      setError(`Min. $${MIN_BET_USD} to predict`)
      return
    }
    if (!round) {
      setError('No active round')
      return
    }
    if (Date.now() >= round.tradingClosesAt) {
      setError('Predictions closed for this round')
      return
    }
    if (!stxAddress) {
      setError('Connect wallet first')
      return
    }
    if (!tradingEnabled) {
      setError('Enable predictions first (click button below)')
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

  const PRESETS = [1, 5, 10, 50, 100] as const

  const now = Date.now()
  const isTradingOpen = round && now < round.tradingClosesAt
  const canTrade = isTradingOpen && stxAddress && !trading
  const inputsEnabled = stxAddress && tradingEnabled && isTradingOpen && !trading

  // Delta entre preço atual e preço de abertura
  const priceDelta = currentPrice && openPriceRef.current
    ? currentPrice - openPriceRef.current
    : null

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 overflow-hidden">
      {/* Header */}
      <div className="px-3 sm:px-5 py-2.5 sm:py-3 border-b border-zinc-800 flex items-center gap-2 sm:gap-3">
        {/* Pair */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/btc.svg"
            alt="BTC"
            className="w-5 h-5 sm:w-6 sm:h-6"
          />
          <span className="text-sm sm:text-base font-semibold text-zinc-200">BTC/USD</span>
        </div>

        {/* Prices: Open → Current + Delta */}
        <div className="flex items-center gap-1 sm:gap-1.5 flex-1 min-w-0 justify-center">
          <span className="font-mono text-xs text-zinc-500 hidden sm:inline">
            ${round?.priceAtStart?.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            }) ?? '—'}
          </span>
          <span className="text-zinc-600 text-xs hidden sm:inline">→</span>
          <span className="font-mono text-sm sm:text-base font-bold text-bitcoin">
            <BtcPrice />
          </span>
          {priceDelta !== null && (
            <span className={`shrink-0 text-[10px] sm:text-xs font-mono font-medium px-1.5 py-0.5 rounded-md ${
              priceDelta >= 0 ? 'text-up bg-up/10' : 'text-down bg-down/10'
            }`}>
              {priceDelta >= 0 ? '+' : '-'}${Math.abs(priceDelta).toFixed(2)}
            </span>
          )}
        </div>

        {/* Countdown */}
        {round ? (
          <Countdown
            endsAt={round.endsAt}
            serverTimeSkew={0}
            onEnd={() => {}}
            onTick={() => {}}
            className="text-base sm:text-xl font-bold text-amber-400 leading-none tabular-nums shrink-0"
          />
        ) : (
          <span className="text-base sm:text-xl font-bold font-mono text-zinc-600 leading-none shrink-0">—</span>
        )}
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
                <span className="text-zinc-500">Your predictions: </span>
                {roundBets.up > 0 && <span className="text-up font-medium">${roundBets.up} UP</span>}
                {roundBets.up > 0 && roundBets.down > 0 && <span className="text-zinc-600"> | </span>}
                {roundBets.down > 0 && <span className="text-down font-medium">${roundBets.down} DOWN</span>}
              </div>
            ) : isTradingOpen ? (
              <div className="w-full h-full px-4 rounded-lg bg-zinc-800/60 text-zinc-400 text-sm border border-zinc-700/50 flex flex-col justify-center">
                <p className="font-medium text-zinc-300 leading-tight">Market open</p>
                <p className="text-xs text-zinc-500 mt-0.5 leading-tight">
                  Set the amount and choose UP or DOWN to predict
                </p>
              </div>
            ) : (
              <div className="w-full h-full px-4 rounded-lg bg-zinc-800/60 text-amber-400/90 text-sm border border-zinc-700/50 flex items-center justify-center">
                Predictions closed. Next round starting...
              </div>
            )}
          </div>
        </div>

        {/* BTC Price Chart (full width, Polymarket style) */}
        <div className="relative mb-3 sm:mb-4 rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
          {round && (
            <BtcPriceChart
              data={btcPriceHistory}
              openPrice={openPriceRef.current}
              roundStartAt={round.startAt}
              roundEndsAt={round.endsAt}
            />
          )}
          {/* Recent rounds overlay — opacity fades from oldest (left) to newest (right) */}
          {recentRounds.length > 0 && (
            <div className="absolute top-1.5 left-1.5 sm:top-2 sm:left-2 z-10 flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded sm:rounded-md bg-zinc-900/70 backdrop-blur-sm border border-zinc-800/50">
              {recentRounds.map((r, i) => {
                const opacity = 0.3 + (0.7 * (i / Math.max(recentRounds.length - 1, 1)))
                return (
                  <span
                    key={r.id}
                    style={{ opacity }}
                    className={`text-[8px] sm:text-[10px] font-mono font-bold leading-none ${
                      r.outcome === 'UP' ? 'text-up' : 'text-down'
                    }`}
                    title={`${recentRounds.length - i} min ago · ${r.outcome}`}
                  >
                    {r.outcome === 'UP' ? '▲' : '▼'}
                  </span>
                )
              })}
              <span className="text-[7px] sm:text-[8px] text-zinc-500 leading-none ml-0.5">now</span>
            </div>
          )}
        </div>

        {/* Trading Controls */}
        {(() => {
          const needsApproval = stxAddress && !checkingAllowance && tradingEnabled !== true
          const isChecking = stxAddress && checkingAllowance
          const needsMint = stxAddress && tradingEnabled === true && tokenBalance === 0 && canMint
          const showOverlay = needsApproval || isChecking || needsMint
          return (
            <div className="relative">
              {/* Trading controls — always rendered to lock the height; invisible when overlay active */}
              <div className={showOverlay ? 'invisible' : ''}>
                <div className="space-y-3 sm:space-y-4">
                  <div className="flex items-center gap-1">
                    <div className="relative w-[72px] sm:w-20 shrink-0">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 text-xs pointer-events-none">$</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="0"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        disabled={!inputsEnabled}
                        className="w-full font-mono pl-5 pr-1 py-2 rounded-lg bg-zinc-800/80 border border-zinc-700 text-zinc-100 text-xs sm:text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-bitcoin/50 focus:border-bitcoin disabled:opacity-40 disabled:cursor-not-allowed"
                      />
                    </div>
                    {PRESETS.map((d) => (
                      <button
                        key={d}
                        type="button"
                        disabled={!inputsEnabled}
                        onClick={() => setAmount(String(d))}
                        className={`flex-1 sm:flex-none min-w-0 sm:px-3 py-2 rounded-lg font-mono text-xs transition disabled:opacity-40 disabled:cursor-not-allowed ${
                          amount === String(d)
                            ? 'bg-bitcoin/30 text-bitcoin border border-bitcoin/50'
                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
                        }`}
                      >
                        ${d}
                      </button>
                    ))}
                    {tokenBalance > 0 && (
                      <button
                        type="button"
                        disabled={!inputsEnabled}
                        onClick={() => setAmount(String(Math.floor(tokenBalance)))}
                        className={`flex-1 sm:flex-none min-w-0 sm:px-3 py-2 rounded-lg font-mono text-xs transition disabled:opacity-40 disabled:cursor-not-allowed ${
                          amount === String(Math.floor(tokenBalance))
                            ? 'bg-bitcoin/30 text-bitcoin border border-bitcoin/50'
                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
                        }`}
                      >
                        Max
                      </button>
                    )}
                  </div>

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
                          <span>{Math.round(upPct)}% UP</span>
                          <span>${total.toLocaleString('en-US', { maximumFractionDigits: 0 })} pool</span>
                          <span>{Math.round(100 - upPct)}% DOWN</span>
                        </div>
                      </div>
                    )
                  })()}

                  <div className="grid grid-cols-2 gap-2 sm:gap-3">
                    <button
                      onClick={() => buy('UP')}
                      disabled={!canTrade}
                      className="flex flex-col items-center justify-center rounded-xl bg-up py-2.5 sm:py-3 text-white transition hover:bg-up/90 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="text-base sm:text-lg font-bold leading-tight tracking-wide">UP</span>
                      <span className="text-[11px] sm:text-xs font-mono opacity-90 leading-tight">
                        {Math.round((pool?.priceUp ?? 0.5) * 100)}¢ · {((pool?.priceUp ?? 0.5) > 0 ? (1 / (pool?.priceUp ?? 0.5)) : 2).toFixed(1)}x
                      </span>
                    </button>
                    <button
                      onClick={() => buy('DOWN')}
                      disabled={!canTrade}
                      className="flex flex-col items-center justify-center rounded-xl bg-down py-2.5 sm:py-3 text-white transition hover:bg-down/90 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="text-base sm:text-lg font-bold leading-tight tracking-wide">DOWN</span>
                      <span className="text-[11px] sm:text-xs font-mono opacity-90 leading-tight">
                        {Math.round((pool?.priceDown ?? 0.5) * 100)}¢ · {((pool?.priceDown ?? 0.5) > 0 ? (1 / (pool?.priceDown ?? 0.5)) : 2).toFixed(1)}x
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Onboarding overlay — approval or mint step */}
              {showOverlay && (
                <div className="absolute inset-0 flex flex-col justify-between">
                  <div className="flex items-center gap-2.5">
                    {needsMint ? (
                      <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                        <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                        </svg>
                      </div>
                    ) : (
                      <div className="w-7 h-7 rounded-lg bg-bitcoin/10 border border-bitcoin/20 flex items-center justify-center shrink-0">
                        <svg className="w-3.5 h-3.5 text-bitcoin" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                        </svg>
                      </div>
                    )}
                    <div className="min-w-0">
                      {needsMint ? (
                        <>
                          <p className="text-xs sm:text-sm font-medium text-zinc-200 leading-tight">Get test tokens</p>
                          <p className="text-[11px] text-zinc-500 leading-tight mt-0.5">Mint free TUSDC to start predicting</p>
                        </>
                      ) : (
                        <>
                          <p className="text-xs sm:text-sm font-medium text-zinc-200 leading-tight">Approve TUSDC to predict</p>
                          <p className="text-[11px] text-zinc-500 leading-tight mt-0.5">One-time contract approval</p>
                        </>
                      )}
                    </div>
                  </div>

                  {needsMint ? (
                    <button
                      onClick={mintTokens}
                      disabled={mintingTokens}
                      className="w-full flex flex-col items-center justify-center rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 py-2.5 sm:py-3 hover:bg-emerald-500/30 hover:border-emerald-500/60 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                      {mintingTokens ? (
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          <span className="h-4 w-4 border-2 border-emerald-500/40 border-t-emerald-400 rounded-full animate-spin" />
                          Awaiting wallet...
                        </span>
                      ) : (
                        <>
                          <span className="text-base sm:text-lg font-bold leading-tight tracking-wide">Mint TUSDC</span>
                          <span className="text-[11px] sm:text-xs font-mono opacity-70 leading-tight">free test tokens</span>
                        </>
                      )}
                    </button>
                  ) : needsApproval ? (
                    <button
                      onClick={enableTrading}
                      disabled={trading}
                      className="w-full flex flex-col items-center justify-center rounded-xl bg-bitcoin/20 border border-bitcoin/40 text-bitcoin py-2.5 sm:py-3 hover:bg-bitcoin/30 hover:border-bitcoin/60 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                      {trading ? (
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          <span className="h-4 w-4 border-2 border-bitcoin/40 border-t-bitcoin rounded-full animate-spin" />
                          Awaiting wallet...
                        </span>
                      ) : (
                        <>
                          <span className="text-base sm:text-lg font-bold leading-tight tracking-wide">Approve & Start</span>
                          <span className="text-[11px] sm:text-xs font-mono opacity-70 leading-tight">enable predictions</span>
                        </>
                      )}
                    </button>
                  ) : (
                    <div className="w-full flex flex-col items-center justify-center rounded-xl border border-zinc-800 py-2.5 sm:py-3">
                      <span className="flex items-center gap-2 text-sm text-zinc-500">
                        <span className="h-4 w-4 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
                        Checking approval...
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })()}
      </div>
    </div>
  )
}
