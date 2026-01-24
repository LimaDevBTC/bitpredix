'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { BtcPrice } from './BtcPrice'
import { Countdown } from './Countdown'
import { ResolutionModal } from './ResolutionModal'
import { PriceChart, type PriceDataPoint } from './PriceChart'
import { RoundHistory } from './RoundHistory'
import { saveTrade, getPositionForRound } from '@/lib/positions'

type Side = 'UP' | 'DOWN'

interface Round {
  id: string
  startAt: number
  endsAt: number
  priceAtStart: number
  priceAtEnd?: number
  outcome?: Side
  status: string
  pool: { reserveUp: number; reserveDown: number; k?: number }
}

function formatRoundId(ts: number) {
  const d = new Date(ts)
  // Formato: #YYYYMMDDHHMM (único globalmente, estilo profissional)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hour = String(d.getHours()).padStart(2, '0')
  const minute = String(d.getMinutes()).padStart(2, '0')
  return `#${year}${month}${day}${hour}${minute}`
}

/** Estimativa de shares (fórmula AMM, client-side). */
function estimateShares(pool: Round['pool'], side: Side, amountUsd: number, priceUp: number, priceDown: number): number {
  const k = pool.k ?? pool.reserveUp * pool.reserveDown
  const reserveIn = side === 'UP' ? pool.reserveDown : pool.reserveUp
  const reserveOut = side === 'UP' ? pool.reserveUp : pool.reserveDown
  const reserveInNew = reserveIn + amountUsd
  const reserveOutNew = k / reserveInNew
  const shares = reserveOut - reserveOutNew
  if (shares <= 0 || !isFinite(shares)) {
    return amountUsd / (side === 'UP' ? priceUp : priceDown)
  }
  return shares
}

export function MarketCard() {
  const [round, setRound] = useState<Round | null>(null)
  const [priceUp, setPriceUp] = useState(0.5)
  const [priceDown, setPriceDown] = useState(0.5)
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(true)
  const [trading, setTrading] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [resolutionData, setResolutionData] = useState<Round | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastTrade, setLastTrade] = useState<{ side: Side; shares: number; price: number } | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(999)
  const resolvingRoundIdRef = useRef<string | null>(null)
  const [priceHistory, setPriceHistory] = useState<PriceDataPoint[]>([])
  const lastRoundIdRef = useRef<string | null>(null)
  const lastTradeTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const displayedRoundIdRef = useRef<string | null>(null)
  const hadNon50ForCurrentRoundRef = useRef(false)
  const lastAcceptedDeviationRef = useRef(0)

  const FETCH_TIMEOUT_MS = 20000
  const TRADING_CLOSE_SECONDS = 0

  useEffect(() => {
    if (round?.id) setSecondsLeft(999)
  }, [round?.id])

  // Reseta histórico quando uma nova rodada começa
  useEffect(() => {
    if (round?.id && lastRoundIdRef.current !== round.id && round.status === 'TRADING') {
      lastRoundIdRef.current = round.id
      // Começa apenas com 50/50, o primeiro ponto real será adicionado pelo fetchRound
      // IMPORTANTE: Resetar apenas quando realmente é uma nova rodada (não quando resolve)
      setPriceHistory([{ time: 0, up: 50, down: 50 }])
    }
  }, [round?.id, round?.status])
  
  // Limpa histórico quando rodada termina (para evitar mostrar dados antigos)
  useEffect(() => {
    if (round?.status === 'RESOLVED' && lastRoundIdRef.current === round.id) {
      // Quando a rodada resolve, mantém o histórico mas para de adicionar novos pontos
      // O gráfico vai mostrar até o último ponto real antes da resolução
    }
  }, [round?.status, round?.id])

  // Adiciona ponto ao histórico de preços
  const addPricePoint = useCallback((round: Round, priceUp: number, priceDown: number) => {
    if (!round || round.id !== lastRoundIdRef.current) return // Ignora se não for a rodada atual
    if (round.status !== 'TRADING') return // Não adiciona pontos se rodada não está em trading
    
    const now = Date.now()
    const timeSinceStart = Math.floor((now - round.startAt) / 1000)
    
    // Não adiciona pontos após o fim da rodada
    if (timeSinceStart >= 60) return
    
    setPriceHistory((prev) => {
      // Garante que estamos trabalhando com dados da rodada atual
      if (prev.length === 0 || prev[0].time !== 0) {
        // Se histórico está vazio ou não começa em 0, reseta
        return [{ time: 0, up: 50, down: 50 }, { time: timeSinceStart, up: priceUp * 100, down: priceDown * 100 }]
      }
      
      // Evita duplicar pontos no mesmo segundo (atualiza o último se necessário)
      const lastPoint = prev[prev.length - 1]
      if (lastPoint && lastPoint.time === timeSinceStart) {
        return [...prev.slice(0, -1), { time: timeSinceStart, up: priceUp * 100, down: priceDown * 100 }]
      }
      
      // Adiciona novo ponto
      return [...prev, { time: timeSinceStart, up: priceUp * 100, down: priceDown * 100 }]
    })
  }, [])

  const fetchRound = useCallback(async () => {
    const ctrl = new AbortController()
    const to = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch('/api/round', { signal: ctrl.signal })
      const data = await res.json()
      if (data.ok) {
        const roundId = data.round?.id ?? null
        const sameRound = roundId != null && roundId === displayedRoundIdRef.current
        const pu = typeof data.priceUp === 'number' ? data.priceUp : 0.5
        const pd = typeof data.priceDown === 'number' ? data.priceDown : 0.5
        const incomingDeviation = Math.abs(pu - 0.5)
        const incomingIs50 = incomingDeviation < 0.01
        const movesToward50 = sameRound && incomingDeviation < lastAcceptedDeviationRef.current
        const skipPrices =
          sameRound &&
          (incomingIs50 ? hadNon50ForCurrentRoundRef.current : movesToward50)

        if (roundId != null && roundId !== displayedRoundIdRef.current) {
          displayedRoundIdRef.current = roundId
          hadNon50ForCurrentRoundRef.current = false
          lastAcceptedDeviationRef.current = 0
        }

        setRound(data.round)
        if (!skipPrices) {
          setPriceUp(pu)
          setPriceDown(pd)
          if (data.round && data.priceUp !== undefined && data.priceDown !== undefined) {
            addPricePoint(data.round, pu, pd)
          }
          if (!incomingIs50) hadNon50ForCurrentRoundRef.current = true
          lastAcceptedDeviationRef.current = Math.max(lastAcceptedDeviationRef.current, incomingDeviation)
        }
        setError(null)
        setResolving(false)

        if (data.resolvedRound) {
          setResolutionData(data.resolvedRound)
          resolvingRoundIdRef.current = null
        } else if (resolvingRoundIdRef.current && data.round?.id !== resolvingRoundIdRef.current) {
          const rRes = await fetch(`/api/round/${resolvingRoundIdRef.current}`)
          const rData = await rRes.json()
          if (rData.ok && rData.round?.outcome) {
            setResolutionData(rData.round)
          }
          resolvingRoundIdRef.current = null
        }
      } else {
        setResolving(false)
        setError(data.error ?? 'Failed to load round')
      }
    } catch (e) {
      setResolving(false)
      setError(e instanceof Error && e.name === 'AbortError' ? 'Request timed out. Try again.' : 'Failed to load round')
    } finally {
      clearTimeout(to)
      setLoading(false)
    }
  }, [addPricePoint])

  useEffect(() => {
    fetchRound()
    const id = setInterval(fetchRound, 3000)
    return () => {
      clearInterval(id)
      if (lastTradeTimeoutRef.current) {
        clearTimeout(lastTradeTimeoutRef.current)
      }
    }
  }, [fetchRound])

  const onCountdownEnd = () => {
    if (!round) return
    setResolving(true)
    resolvingRoundIdRef.current = round.id
    setTimeout(() => fetchRound(), 3000)
  }

  const BUY_TIMEOUT_MS = 15000
  const MIN_TRADING_DELAY_MS = 2000 // Delay mínimo de 2 segundos para mostrar "Transação pendente"

  const buy = async (side: Side) => {
    const v = parseFloat(amount)
    if (isNaN(v) || v <= 0) {
      setError('Enter a valid amount in USD')
      return
    }
    if (v < MIN_AMOUNT_USD) {
      setError(`Min. $${MIN_AMOUNT_USD.toFixed(2)} to buy shares`)
      return
    }
    // Verificação dupla: frontend (secondsLeft) e tempo real (endsAt)
    if (round && (Date.now() >= round.endsAt - TRADING_CLOSE_SECONDS * 1000)) {
      setError('Trading has closed for this round.')
      return
    }
    setTrading(true)
    setError(null)
    const startTime = Date.now()
    const ctrl = new AbortController()
    const to = setTimeout(() => ctrl.abort(), BUY_TIMEOUT_MS)
    try {
      const res = await fetch('/api/round', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ side, amountUsd: v, roundId: round?.id }),
        signal: ctrl.signal,
      })
      const data = await res.json()
      if (data.ok) {
        hadNon50ForCurrentRoundRef.current = true
        saveTrade({ roundId: data.roundId, side, shares: data.sharesReceived, amountUsd: v })
        setLastTrade({ side, shares: data.sharesReceived, price: data.pricePerShare })
        setAmount('')
        
        if (lastTradeTimeoutRef.current) {
          clearTimeout(lastTradeTimeoutRef.current)
        }
        lastTradeTimeoutRef.current = setTimeout(() => {
          setLastTrade(null)
        }, 5000)
        
        fetchRound()
        
        // Garante que "Transação pendente" seja mostrada por pelo menos MIN_TRADING_DELAY_MS
        const elapsed = Date.now() - startTime
        const remainingDelay = Math.max(0, MIN_TRADING_DELAY_MS - elapsed)
        setTimeout(() => {
          setTrading(false)
        }, remainingDelay)
      } else {
        setError(data.error ?? 'Trade error')
        fetchRound()
        // Em caso de erro, também mantém o delay mínimo
        const elapsed = Date.now() - startTime
        const remainingDelay = Math.max(0, MIN_TRADING_DELAY_MS - elapsed)
        setTimeout(() => {
          setTrading(false)
        }, remainingDelay)
      }
    } catch (e) {
      setError(e instanceof Error && e.name === 'AbortError' ? 'Request timed out. Try again.' : 'Network error')
      fetchRound()
      // Em caso de erro, também mantém o delay mínimo
      const elapsed = Date.now() - startTime
      const remainingDelay = Math.max(0, MIN_TRADING_DELAY_MS - elapsed)
      setTimeout(() => {
        setTrading(false)
      }, remainingDelay)
    } finally {
      clearTimeout(to)
      // Não seta trading = false aqui, deixa o setTimeout acima fazer isso
    }
  }

  const MIN_AMOUNT_USD = 0.5
  const PRESETS = [5, 10, 50, 100] as const
  const MAX_AMOUNT = 10000 // Valor máximo para o botão MAX

  const amountNum = parseFloat(amount)
  const hasValidAmount = !isNaN(amountNum) && amountNum > 0 && round?.pool
  const estUp = hasValidAmount ? estimateShares(round!.pool, 'UP', amountNum, priceUp, priceDown) : 0
  const estDown = hasValidAmount ? estimateShares(round!.pool, 'DOWN', amountNum, priceUp, priceDown) : 0
  const pos = round ? getPositionForRound(round.id) : null
  const belowMin = amountNum > 0 && amountNum < MIN_AMOUNT_USD
  const meetsMin = amountNum >= MIN_AMOUNT_USD

  const isTradingPhase = round?.status === 'TRADING' && !resolving
  const canTrade = isTradingPhase && secondsLeft > TRADING_CLOSE_SECONDS

  if (loading && !round) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-6 sm:p-8 animate-pulse">
        <p className="text-zinc-500 text-sm mb-4">Loading market…</p>
        <div className="h-8 w-48 bg-zinc-700 rounded mb-4" />
        <div className="h-32 bg-zinc-700 rounded" />
      </div>
    )
  }

  return (
    <>
      {resolutionData && (
        <ResolutionModal
          round={resolutionData}
          onClose={() => setResolutionData(null)}
        />
      )}

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 bg-grid-pattern overflow-hidden">
        {/* Header — mesmo layout 3 colunas em mobile e desktop */}
        <div className="px-3 sm:px-6 py-3 sm:py-4 border-b border-zinc-800">
          <div className="grid grid-cols-3 gap-2 sm:gap-4 items-start">
            {/* Col 1: Título + Round + Recent */}
            <div className="min-w-0 space-y-1 sm:space-y-1.5">
              <h2 className="text-sm sm:text-base font-semibold text-zinc-200 leading-tight">BTC next minute</h2>
              <div className="text-[11px] sm:text-xs text-zinc-500">
                <span className="font-mono text-zinc-400">{round ? formatRoundId(round.startAt) : '—'}</span>
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <span className="text-[9px] sm:text-[10px] text-zinc-600 uppercase tracking-wider shrink-0">Recent:</span>
                <RoundHistory />
              </div>
            </div>

            {/* Col 2: BTC Price + Open */}
            <div className="flex flex-col items-center justify-start min-w-0 gap-0.5">
              <p className="text-[9px] sm:text-[10px] text-zinc-500 uppercase tracking-wider font-medium">BTC Price</p>
              <div className="text-lg sm:text-3xl font-bold text-bitcoin leading-none font-mono">
                <BtcPrice />
              </div>
              <p className="text-[10px] sm:text-xs text-zinc-500 mt-0.5">
                Open: <span className="font-mono text-bitcoin">${round?.priceAtStart?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '—'}</span>
              </p>
            </div>

            {/* Col 3: Time Left */}
            <div className="flex flex-col items-end justify-start min-w-0 gap-0.5">
              <p className="text-[9px] sm:text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Time Left</p>
              {isTradingPhase && round ? (
                <Countdown
                  endsAt={round.endsAt}
                  onEnd={onCountdownEnd}
                  onTick={(l) => setSecondsLeft(l)}
                  className="text-lg sm:text-3xl font-bold text-amber-400 leading-none tabular-nums"
                />
              ) : (
                <div className="text-lg sm:text-3xl font-bold text-zinc-600 leading-none">
                  <span className="font-mono">—</span>
                  <span className="block text-xs mt-0.5 h-4 text-transparent" aria-hidden="true">&#8203;</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          {/* Espaço FIXO para mensagens - altura constante para evitar mudanças no layout */}
          <div className="h-20 mb-4 flex items-stretch">
            <div className="w-full flex items-center">
              {error ? (
                // Prioridade 1: Erro
                <div className="w-full h-full px-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center justify-between gap-2">
                  <span className="flex-1">{error}</span>
                  <button
                    onClick={() => { setError(null); fetchRound(); }}
                    className="px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 text-xs font-medium shrink-0"
                  >
                    Try again
                  </button>
                </div>
              ) : resolving ? (
                // Prioridade 2: Resolvendo
                <div className="w-full h-full px-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm flex items-center gap-3">
                  <div className="h-5 w-5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin shrink-0" />
                  <p className="font-medium">Resolving… checking closing price</p>
                </div>
              ) : trading ? (
                // Prioridade 3: Transação pendente
                <div className="w-full h-full px-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm flex items-center gap-3">
                  <div className="h-5 w-5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin shrink-0" />
                  <p className="font-medium">Transaction pending… awaiting approval</p>
                </div>
              ) : lastTrade ? (
                // Prioridade 4: Último trade (mostra por 5 segundos após aprovação)
                <div className="w-full h-full px-4 rounded-lg bg-zinc-800/80 text-zinc-400 text-sm flex items-center">
                  <span className="text-zinc-500">Bought </span>
                  <span className={lastTrade.side === 'UP' ? 'text-up font-medium' : 'text-down font-medium'}>
                    {lastTrade.shares.toFixed(2)} {lastTrade.side}
                  </span>
                  <span className="text-zinc-500"> @ {(lastTrade.price * 100).toFixed(1)}¢</span>
                </div>
              ) : pos && (pos.sharesUp > 0 || pos.sharesDown > 0) && (isTradingPhase || resolving) ? (
                // Prioridade 5: Saldo de shares (após lastTrade desaparecer)
                (() => {
                  const totalCost = pos.costUp + pos.costDown
                  const pnlIfUp = pos.sharesUp - totalCost
                  const pnlIfDown = pos.sharesDown - totalCost
                  return (
                    <div className="w-full h-full px-4 rounded-lg bg-zinc-800/60 text-zinc-400 text-sm border border-zinc-700/50 flex flex-col justify-center">
                      <p className="font-medium text-zinc-300 leading-tight">Your shares</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5">
                        <span className="text-xs"><span className="text-up font-medium">UP</span> {pos.sharesUp.toFixed(2)}</span>
                        <span className="text-xs"><span className="text-down font-medium">DOWN</span> {pos.sharesDown.toFixed(2)}</span>
                        <span className="text-xs text-zinc-500">· At risk: ${totalCost.toFixed(2)}</span>
                      </div>
                      <p className="text-[10px] text-zinc-500 mt-0.5 leading-tight">
                        If UP: <span className={pnlIfUp >= 0 ? 'text-up' : 'text-down'}>{pnlIfUp >= 0 ? '+' : ''}{pnlIfUp.toFixed(2)}</span>
                        {' · '}
                        If DOWN: <span className={pnlIfDown >= 0 ? 'text-up' : 'text-down'}>{pnlIfDown >= 0 ? '+' : ''}{pnlIfDown.toFixed(2)}</span>
                      </p>
                    </div>
                  )
                })()
              ) : isTradingPhase ? (
                // Prioridade 6: Apostas abertas (quando não há posição e está em trading)
                <div className="w-full h-full px-4 rounded-lg bg-zinc-800/60 text-zinc-400 text-sm border border-zinc-700/50 flex flex-col justify-center">
                  <p className="font-medium text-zinc-300 leading-tight">Market open</p>
                  <p className="text-xs text-zinc-500 mt-0.5 leading-tight">Choose UP or DOWN and enter the amount to trade</p>
                </div>
              ) : (
                // Espaço reservado vazio (mantém altura fixa)
                <div className="w-full h-full flex items-center justify-center" aria-hidden="true">
                  <span className="text-transparent text-sm">—</span>
                </div>
              )}
            </div>
          </div>

          {/* Conteúdo principal - sempre visível, mesmo durante resolução */}
          <div className="space-y-4">
            {/* Gráfico de preços - sempre visível quando há dados da rodada atual */}
            {round && priceHistory.length > 0 && lastRoundIdRef.current === round.id && (
              <div className="mb-4">
                <PriceChart
                  data={priceHistory}
                  roundStartAt={round.startAt}
                  roundEndsAt={round.endsAt}
                />
              </div>
            )}

              <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-4">
                <button
                  onClick={() => buy('UP')}
                  disabled={!canTrade || trading || resolving}
                  className="group relative flex flex-col items-center justify-center rounded-xl border-2 border-up/50 bg-up/5 px-4 py-6 transition hover:border-up hover:bg-up/10 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-up/50 disabled:hover:bg-up/5"
                >
                  <span className="text-2xl sm:text-3xl font-mono font-bold text-up">UP</span>
                  <span className="text-sm text-zinc-500 mt-1">Price goes up</span>
                  <span className="font-mono text-lg font-semibold text-up mt-2">{(priceUp * 100).toFixed(1)}¢</span>
                </button>
                <button
                  onClick={() => buy('DOWN')}
                  disabled={!canTrade || trading || resolving}
                  className="group relative flex flex-col items-center justify-center rounded-xl border-2 border-down/50 bg-down/5 px-4 py-6 transition hover:border-down hover:bg-down/10 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-down/50 disabled:hover:bg-down/5"
                >
                  <span className="text-2xl sm:text-3xl font-mono font-bold text-down">DOWN</span>
                  <span className="text-sm text-zinc-500 mt-1">Price goes down</span>
                  <span className="font-mono text-lg font-semibold text-down mt-2">{(priceDown * 100).toFixed(1)}¢</span>
                </button>
              </div>

            {/* Input de valor - sempre visível, desabilitado durante resolução */}
            <div className="min-h-[8rem]">
              {isTradingPhase && !resolving ? (
                  <div className="space-y-2">
                    {canTrade ? (
                      <>
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
                          <button
                            type="button"
                            onClick={() => setAmount(String(MAX_AMOUNT))}
                            className={`px-3 py-1.5 rounded-lg font-mono text-sm transition ${
                              amount === String(MAX_AMOUNT)
                                ? 'bg-bitcoin/30 text-bitcoin border border-bitcoin/50'
                                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
                            }`}
                          >
                            MAX
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            placeholder="Custom"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="flex-1 font-mono px-4 py-3 rounded-xl bg-zinc-800/80 border border-zinc-700 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-bitcoin/50 focus:border-bitcoin"
                          />
                          <span className="flex items-center px-2 text-zinc-500 text-sm">USD</span>
                        </div>
                        <div className="min-h-[1.5rem]">
                          {belowMin && (
                            <p className="text-xs text-amber-400/90">Min. ${MIN_AMOUNT_USD.toFixed(2)} to buy shares</p>
                          )}
                          {hasValidAmount && meetsMin && (
                            <p className="text-xs text-zinc-500 font-mono">
                              You get <span className="text-zinc-300">~{estUp.toFixed(2)} UP</span> or <span className="text-zinc-300">~{estDown.toFixed(2)} DOWN</span>
                            </p>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center justify-center min-h-[8rem]">
                        <p className="text-center text-amber-400/90 text-sm">
                          {secondsLeft === 0 ? 'Round ending…' : `Trading closed. Round ends in ${secondsLeft}s.`}
                        </p>
                      </div>
                    )}
                  </div>
                ) : resolving ? (
                  <div className="flex items-center justify-center min-h-[8rem]">
                    <p className="text-center text-zinc-500 text-sm">Resolving round…</p>
                  </div>
                ) : round?.status !== 'RESOLVED' ? (
                  <div className="flex items-center justify-center min-h-[8rem]">
                    <p className="text-center text-zinc-500 text-sm">Waiting for next round…</p>
                  </div>
                ) : (
                  <div className="flex items-center justify-center min-h-[8rem]">
                    <p className="text-center text-zinc-500 text-sm">Round resolved. Next round starting soon…</p>
                  </div>
                )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
