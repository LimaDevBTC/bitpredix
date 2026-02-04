'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { getLocalStorage, openContractCall, isConnected } from '@stacks/connect'
import { Cl, Pc } from '@stacks/transactions'
import { BtcPrice } from './BtcPrice'
import { Countdown } from './Countdown'
import { PriceChart, type PriceDataPoint } from './PriceChart'
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

export function MarketCardV4() {
  const [round, setRound] = useState<RoundInfo | null>(null)
  const [amount, setAmount] = useState('')
  const [trading, setTrading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastTrade, setLastTrade] = useState<{ side: Side; shares: number } | null>(null)
  const [stxAddress, setStxAddress] = useState<string | null>(null)
  const [priceHistory, setPriceHistory] = useState<PriceDataPoint[]>([])

  const lastTradeTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastRoundIdRef = useRef<number | null>(null)
  const openPriceRef = useRef<number | null>(null)

  // Pyth price em tempo real
  const { price: currentPrice, loading: priceLoading } = usePythPrice()

  // Atualiza round a cada segundo
  useEffect(() => {
    const updateRound = () => {
      const newRound = getCurrentRoundInfo()

      // Se mudou de round, reseta
      if (lastRoundIdRef.current !== newRound.id) {
        lastRoundIdRef.current = newRound.id
        openPriceRef.current = currentPrice
        setPriceHistory([{ time: 0, up: 50, down: 50 }])
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

  // Estado de allowance (verifica no blockchain via API)
  const [tradingEnabled, setTradingEnabled] = useState<boolean | null>(null)
  const [checkingAllowance, setCheckingAllowance] = useState(false)

  // Verifica allowance no blockchain
  const checkAllowance = useCallback(async (addr: string) => {
    if (!addr || !BITPREDIX_CONTRACT) {
      setTradingEnabled(false)
      return
    }

    setCheckingAllowance(true)
    try {
      const response = await fetch(`/api/allowance-status?address=${encodeURIComponent(addr)}`)
      const data = await response.json()

      console.log('[MarketCardV4] Allowance check:', data)

      if (data.ok) {
        setTradingEnabled(data.hasAllowance === true)
        // Também salva no localStorage como cache
        const key = `bitpredix_trading_enabled_${addr}_${BITPREDIX_CONTRACT}`
        if (data.hasAllowance) {
          localStorage.setItem(key, 'true')
        }
      } else {
        // API falhou - usa localStorage como fallback
        const key = `bitpredix_trading_enabled_${addr}_${BITPREDIX_CONTRACT}`
        setTradingEnabled(localStorage.getItem(key) === 'true')
      }
    } catch {
      // Erro de rede - usa localStorage como fallback
      const key = `bitpredix_trading_enabled_${addr}_${BITPREDIX_CONTRACT}`
      setTradingEnabled(localStorage.getItem(key) === 'true')
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
          checkAllowance(addr)
        }
      }
    }
    refreshAddress()
    const interval = setInterval(refreshAddress, 2500)
    return () => clearInterval(interval)
  }, [stxAddress, checkAllowance])

  // Adiciona pontos ao historico de precos
  useEffect(() => {
    if (!round || !currentPrice || !openPriceRef.current) return

    const now = Date.now()
    const timeSinceStart = Math.floor((now - round.startAt) / 1000)

    if (timeSinceStart < 0 || timeSinceStart >= 60) return

    // Calcula preco UP/DOWN baseado na variacao
    const priceDiff = currentPrice - openPriceRef.current
    const percentChange = (priceDiff / openPriceRef.current) * 100

    // Simula precos de mercado baseado na variacao
    // Se subiu, UP fica mais caro, DOWN mais barato
    const upPrice = Math.min(95, Math.max(5, 50 + percentChange * 10))
    const downPrice = 100 - upPrice

    setPriceHistory(prev => {
      const lastPoint = prev[prev.length - 1]
      if (lastPoint && lastPoint.time === timeSinceStart) {
        return [...prev.slice(0, -1), { time: timeSinceStart, up: upPrice, down: downPrice }]
      }
      return [...prev, { time: timeSinceStart, up: upPrice, down: downPrice }]
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
    if (!tokenAddr || !tokenName) {
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
            Cl.principal(BITPREDIX_CONTRACT),
            Cl.uint(MAX_APPROVE_AMOUNT)
          ],
          network: 'testnet',
          onFinish: () => {
            // Salva no localStorage como cache imediato
            const key = `bitpredix_trading_enabled_${stxAddress}_${BITPREDIX_CONTRACT}`
            localStorage.setItem(key, 'true')
            setTradingEnabled(true)
            // Re-verifica no blockchain após alguns segundos
            setTimeout(() => {
              if (stxAddress) checkAllowance(stxAddress)
            }, 5000)
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
      // Post-condition: usuário envia exatamente amountMicro de test-usdcx para o contrato
      const [tokenAddr, tokenName] = TOKEN_CONTRACT.split('.')
      const postConditions = tokenAddr && tokenName ? [
        Pc.principal(stxAddress)
          .willSendLte(amountMicro)
          .ft(`${tokenAddr}.${tokenName}`, 'test-usdcx')
      ] : []

      await new Promise<void>((resolve, reject) => {
        openContractCall({
          contractAddress: bpAddr,
          contractName: bpName,
          functionName: 'place-bet',
          functionArgs: [
            Cl.uint(round.id),
            Cl.stringAscii(side),
            Cl.uint(amountMicro)
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

      // Sucesso
      setLastTrade({ side, shares: v })
      setAmount('')

      // Dispara evento para atualizar saldo em outros componentes
      window.dispatchEvent(new CustomEvent('bitpredix:balance-changed'))

      if (lastTradeTimeoutRef.current) clearTimeout(lastTradeTimeoutRef.current)
      lastTradeTimeoutRef.current = setTimeout(() => setLastTrade(null), 5000)

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

  // Precos simulados baseados na variacao do BTC
  const upPrice = priceHistory.length > 0 ? priceHistory[priceHistory.length - 1].up / 100 : 0.5
  const downPrice = 1 - upPrice

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 bg-grid-pattern overflow-hidden">
      {/* Header */}
      <div className="px-3 sm:px-6 py-2.5 sm:py-3.5 border-b border-zinc-800">
        <div className="grid grid-cols-3 gap-2 sm:gap-4 items-start">
          {/* Col 1: Titulo + Round */}
          <div className="min-w-0 space-y-1 sm:space-y-1.5">
            <h2 className="text-sm sm:text-base font-semibold text-zinc-200 leading-tight">
              BTC next minute
            </h2>
            <div className="text-[11px] sm:text-xs text-zinc-500">
              <span className="font-mono text-zinc-400">
                {round ? formatRoundId(round.id) : '—'}
              </span>
            </div>
            <div className="text-[9px] sm:text-[10px] text-emerald-400/80">
              v4 - Pyth Oracle
            </div>
          </div>

          {/* Col 2: BTC Price + Open */}
          <div className="flex flex-col items-center justify-start min-w-0 gap-0.5">
            <p className="text-[9px] sm:text-[10px] text-zinc-500 uppercase tracking-wider font-medium">
              BTC Price
            </p>
            <div className="text-lg sm:text-3xl font-bold text-bitcoin leading-none font-mono">
              <BtcPrice />
            </div>
            <p className="text-[10px] sm:text-xs text-zinc-500 mt-0.5">
              Open:{' '}
              <span className="font-mono text-bitcoin">
                ${round?.priceAtStart?.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2
                }) ?? '—'}
              </span>
            </p>
          </div>

          {/* Col 3: Time Left */}
          <div className="flex flex-col items-end justify-start min-w-0 gap-0.5">
            <p className="text-[9px] sm:text-[10px] text-zinc-500 uppercase tracking-wider font-medium">
              Time Left
            </p>
            {round ? (
              <Countdown
                endsAt={round.endsAt}
                serverTimeSkew={0}
                onEnd={() => {
                  // Round terminou, proximo round comeca automaticamente
                }}
                onTick={() => {}}
                className="text-lg sm:text-3xl font-bold text-amber-400 leading-none tabular-nums"
              />
            ) : (
              <div className="text-lg sm:text-3xl font-bold text-zinc-600 leading-none">
                <span className="font-mono">—</span>
              </div>
            )}
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
            ) : lastTrade ? (
              <div className="w-full h-full px-4 rounded-lg bg-zinc-800/80 text-zinc-400 text-sm flex items-center">
                <span className="text-zinc-500">Bet placed: </span>
                <span className={lastTrade.side === 'UP' ? 'text-up font-medium' : 'text-down font-medium'}>
                  ${lastTrade.shares} on {lastTrade.side}
                </span>
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

        {/* Conteudo principal */}
        <div className="space-y-3 sm:space-y-4 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start">
          {/* Grafico */}
          <div className="lg:min-h-[16rem]">
            {round && priceHistory.length > 0 && (
              <PriceChart
                data={priceHistory}
                roundStartAt={round.startAt}
                roundEndsAt={round.endsAt}
                serverTimeSkew={0}
              />
            )}
          </div>

          {/* Botoes UP/DOWN + amount */}
          <div className="space-y-3 sm:space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:gap-3">
              <button
                onClick={() => buy('UP')}
                disabled={!canTrade}
                className="group relative flex flex-col items-center justify-center rounded-lg border-2 border-up/50 bg-up/5 px-3 py-2 sm:py-3 lg:py-3 transition hover:border-up hover:bg-up/10 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="text-base sm:text-xl lg:text-xl font-mono font-bold text-up">UP</span>
                <span className="text-[11px] sm:text-xs text-zinc-500 mt-0">Price goes up</span>
                <span className="font-mono text-sm lg:text-base font-semibold text-up mt-0.5">
                  {(upPrice * 100).toFixed(1)}¢
                </span>
              </button>
              <button
                onClick={() => buy('DOWN')}
                disabled={!canTrade}
                className="group relative flex flex-col items-center justify-center rounded-lg border-2 border-down/50 bg-down/5 px-3 py-2 sm:py-3 lg:py-3 transition hover:border-down hover:bg-down/10 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="text-base sm:text-xl lg:text-xl font-mono font-bold text-down">DOWN</span>
                <span className="text-[11px] sm:text-xs text-zinc-500 mt-0">Price goes down</span>
                <span className="font-mono text-sm lg:text-base font-semibold text-down mt-0.5">
                  {(downPrice * 100).toFixed(1)}¢
                </span>
              </button>
            </div>

            {/* Input de valor */}
            <div>
              {isTradingOpen ? (
                stxAddress ? (
                  checkingAllowance ? (
                    // Verificando allowance
                    <div className="flex items-center justify-center min-h-[4.5rem] py-2">
                      <div className="flex items-center gap-2 text-zinc-400">
                        <div className="h-4 w-4 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
                        <span className="text-sm">Checking approval status...</span>
                      </div>
                    </div>
                  ) : tradingEnabled !== true ? (
                    // Precisa habilitar trading primeiro
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
                      {hasValidAmount && (
                        <p className="text-xs text-zinc-500">
                          Potential win: <span className="text-emerald-400">${(amountNum / upPrice).toFixed(2)}</span> if UP,{' '}
                          <span className="text-emerald-400">${(amountNum / downPrice).toFixed(2)}</span> if DOWN
                        </p>
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
    </div>
  )
}
