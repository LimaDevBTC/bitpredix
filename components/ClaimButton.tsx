'use client'

// === VERSION CHECK: v2024-02-04-A ===
console.log('🔥 ClaimButton LOADED - version v2024-02-04-A 🔥')

import { useState, useEffect, useCallback, useRef } from 'react'
import { getLocalStorage, openContractCall, isConnected } from '@stacks/connect'
import { uintCV, standardPrincipalCV, stringAsciiCV, cvToJSON, hexToCV, cvToHex, PostConditionMode } from '@stacks/transactions'
import { getRoundPrices } from '@/lib/pyth'

const BITPREDIX_CONTRACT = process.env.NEXT_PUBLIC_BITPREDIX_CONTRACT_ID || 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.predixv1'
const TOKEN_CONTRACT = process.env.NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID || 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.test-usdcx'
const MAX_CLAIMS_PER_TX = 10
const STACKS_API_BASE = 'https://api.testnet.hiro.so'

// Espera uma tx aparecer no mempool antes de enviar a proxima (evita nonce collision)
async function waitForTxInMempool(txId: string, maxWaitMs = 30000): Promise<boolean> {
  const pollInterval = 2500
  const startTime = Date.now()

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const res = await fetch(`${STACKS_API_BASE}/extended/v1/tx/${txId}`)
      if (res.ok) {
        const data = await res.json()
        if (data.tx_status === 'pending' || data.tx_status === 'success') {
          return true
        }
      }
    } catch {
      // API unreachable — fallback to delay
    }
    await new Promise(r => setTimeout(r, pollInterval))
  }
  // Timeout — proceed anyway with a safety delay
  await new Promise(r => setTimeout(r, 5000))
  return false
}

interface PendingBet {
  side: 'UP' | 'DOWN'
  amount: number
  claimed: boolean
}

interface PendingRound {
  roundId: number
  bets: PendingBet[]
}

export function ClaimButton() {
  const [stxAddress, setStxAddress] = useState<string | null>(null)
  const [pendingRounds, setPendingRounds] = useState<PendingRound[]>([])
  const [totalClaimable, setTotalClaimable] = useState(0)
  const [claiming, setClaiming] = useState(false)
  const [, setClaimProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollingRef = useRef<NodeJS.Timeout | null>(null)

  // Cache de rounds que já foram enviados para claim (evita duplicatas)
  const claimedRoundsRef = useRef<Set<number>>(new Set())

  // Busca endereco da carteira
  const refreshAddress = useCallback(() => {
    if (!isConnected()) {
      setStxAddress(null)
      return
    }
    const data = getLocalStorage()
    setStxAddress(data?.addresses?.stx?.[0]?.address ?? null)
  }, [])

  useEffect(() => {
    refreshAddress()
    // Verifica a cada 2.5s se conectou/desconectou
    const interval = setInterval(refreshAddress, 2500)
    return () => clearInterval(interval)
  }, [refreshAddress])

  // Busca rounds pendentes do contrato
  const fetchPendingRounds = useCallback(async () => {
    if (!stxAddress || !BITPREDIX_CONTRACT) {
      setPendingRounds([])
      setTotalClaimable(0)
      return
    }

    try {
      const [contractAddr, contractName] = BITPREDIX_CONTRACT.split('.')
      if (!contractAddr || !contractName) return

      console.log('[ClaimButton] Fetching pending rounds for', stxAddress)

      // Chama get-user-pending-rounds via proxy (evita CORS)
      const response = await fetch('/api/stacks-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractId: BITPREDIX_CONTRACT,
          functionName: 'get-user-pending-rounds',
          args: [cvToHex(standardPrincipalCV(stxAddress))],
          sender: stxAddress
        })
      }).catch(() => null) // Silently handle network errors

      if (!response || !response.ok) {
        // Network error - limpa estado e retry depois
        console.log('[ClaimButton] Network error fetching pending rounds')
        return
      }

      const data = await response.json()
      console.log('[ClaimButton] get-user-pending-rounds response:', data)

      if (!data.okay || !data.result) {
        // Invalid response - limpa estado
        console.log('[ClaimButton] Invalid response, clearing pending rounds')
        setPendingRounds([])
        setTotalClaimable(0)
        return
      }

      // Parse o resultado Clarity
      const resultCV = hexToCV(data.result)
      const resultJSON = cvToJSON(resultCV)

      // Extrai lista de round IDs
      const roundIds: number[] = resultJSON?.value?.['round-ids']?.value?.map(
        (r: { value: string }) => parseInt(r.value)
      ) || []

      if (roundIds.length === 0) {
        setPendingRounds([])
        setTotalClaimable(0)
        return
      }

      // Busca detalhes de cada aposta (ambos os lados: UP e DOWN)
      const rounds: PendingRound[] = []
      for (const roundId of roundIds) {
        const bets: PendingBet[] = []
        for (const side of ['UP', 'DOWN'] as const) {
          try {
            const betResponse = await fetch('/api/stacks-read', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contractId: BITPREDIX_CONTRACT,
                functionName: 'get-bet',
                args: [
                  cvToHex(uintCV(roundId)),
                  cvToHex(standardPrincipalCV(stxAddress)),
                  cvToHex(stringAsciiCV(side))
                ],
                sender: stxAddress
              })
            }).catch(() => null)

            if (betResponse && betResponse.ok) {
              const betData = await betResponse.json()
              if (betData.okay && betData.result) {
                const betCV = hexToCV(betData.result)
                const betJSON = cvToJSON(betCV)

                // cvToJSON wraps optional(tuple(...)) — .value.value to unwrap both layers
                const tupleValue = betJSON?.value?.value
                if (tupleValue) {
                  bets.push({
                    side,
                    amount: parseInt(tupleValue.amount?.value || '0'),
                    claimed: tupleValue.claimed?.value === true
                  })
                }
              }
            }
          } catch {
            // Silently ignore errors fetching individual bets
          }
        }
        if (bets.length > 0) {
          rounds.push({ roundId, bets })
        }
      }

      // Filtra: rounds ja terminados, com pelo menos 1 bet nao-claimed, nao no cache
      const now = Math.floor(Date.now() / 1000)
      const unclaimed = rounds.filter(r => {
        const roundEndTime = (r.roundId + 1) * 60
        const hasEnded = now > roundEndTime
        const alreadySubmitted = claimedRoundsRef.current.has(r.roundId)
        const hasUnclaimedBet = r.bets.some(b => !b.claimed)

        if (!hasEnded) {
          console.log(`[ClaimButton] Round ${r.roundId} not ended yet (ends at ${roundEndTime}, now ${now})`)
        }
        if (alreadySubmitted) {
          console.log(`[ClaimButton] Round ${r.roundId} already submitted for claim, skipping`)
        }

        return hasUnclaimedBet && hasEnded && !alreadySubmitted
      })
      setPendingRounds(unclaimed)

      // Calcula total estimado
      const total = unclaimed.reduce((sum, r) => sum + r.bets.reduce((s, b) => s + b.amount, 0), 0)
      setTotalClaimable(total / 1e6)
    } catch (e) {
      console.error('[ClaimButton] Error fetching pending rounds:', e)
    }
  }, [stxAddress])

  // Polling para atualizar rounds pendentes
  useEffect(() => {
    if (!stxAddress) {
      setPendingRounds([])
      setTotalClaimable(0)
      return
    }

    fetchPendingRounds()
    pollingRef.current = setInterval(fetchPendingRounds, 30000) // A cada 30s

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
      }
    }
  }, [stxAddress, fetchPendingRounds])

  // Handler do claim
  const handleClaim = async () => {
    if (pendingRounds.length === 0 || claiming) return

    setClaiming(true)
    setError(null)
    setClaimProgress(`Processando 0 de ${pendingRounds.length}...`)

    const [contractAddr, contractName] = BITPREDIX_CONTRACT.split('.')
    if (!contractAddr || !contractName) {
      setError('Contract not configured')
      setClaiming(false)
      return
    }

    try {
      // Processa em batches
      const batches: PendingRound[][] = []
      for (let i = 0; i < pendingRounds.length; i += MAX_CLAIMS_PER_TX) {
        batches.push(pendingRounds.slice(i, i + MAX_CLAIMS_PER_TX))
      }

      // Conta total de bets para progresso
      const totalBets = pendingRounds.reduce((sum, r) => sum + r.bets.filter(b => !b.claimed).length, 0)
      let processed = 0

      for (const batch of batches) {
        for (const round of batch) {
          // Busca precos do Pyth para este round (uma vez por round)
          setClaimProgress(`Buscando precos round ${round.roundId}...`)
          let prices
          try {
            prices = await getRoundPrices(round.roundId)
            console.log(`[ClaimButton] Round ${round.roundId} prices:`, {
              priceStart: prices.priceStart,
              priceEnd: prices.priceEnd,
              startUSD: (prices.priceStart / 100).toFixed(2),
              endUSD: (prices.priceEnd / 100).toFixed(2)
            })
          } catch (priceError) {
            console.error(`[ClaimButton] Failed to get prices for round ${round.roundId}:`, priceError)
            setClaimProgress(`Precos indisponiveis para round ${round.roundId}, pulando...`)
            processed += round.bets.filter(b => !b.claimed).length
            continue
          }

          // Claim cada side separadamente, esperando mempool entre txs
          for (const bet of round.bets) {
            if (bet.claimed) continue

            processed++
            setClaimProgress(`Enviando claim ${processed} de ${totalBets}...`)

            try {
              const txId = await new Promise<string>((resolve, reject) => {
                openContractCall({
                  contractAddress: contractAddr,
                  contractName: contractName,
                  functionName: 'claim-round-side',
                  functionArgs: [
                    uintCV(round.roundId),
                    stringAsciiCV(bet.side),
                    uintCV(prices.priceStart),
                    uintCV(prices.priceEnd)
                  ],
                  postConditionMode: PostConditionMode.Allow,
                  network: 'testnet',
                  onFinish: (data) => {
                    console.log(`[ClaimButton] Claim tx submitted (round ${round.roundId} ${bet.side}):`, data.txId)
                    resolve(data.txId)
                  },
                  onCancel: () => {
                    reject(new Error('Transaction cancelled by user'))
                  }
                })
              })

              // Espera tx entrar no mempool antes de enviar a proxima
              // (evita nonce collision no Stacks)
              if (processed < totalBets) {
                setClaimProgress(`Aguardando tx ${txId.slice(0, 10)}... no mempool...`)
                const found = await waitForTxInMempool(txId)
                console.log(`[ClaimButton] Tx ${txId.slice(0, 10)} mempool status: ${found ? 'found' : 'timeout, proceeding'}`)
              }
            } catch (e) {
              console.error(`[ClaimButton] Failed to claim round ${round.roundId} ${bet.side}:`, e)
            }
          }

          // Tx(s) enviada(s) para este round - adiciona ao cache
          claimedRoundsRef.current.add(round.roundId)
          setPendingRounds(prev => prev.filter(r => r.roundId !== round.roundId))
          console.log(`[ClaimButton] Round ${round.roundId} removed from pending (added to claimed cache)`)
        }
      }

      // Atualiza saldo apos claims
      setClaimProgress(null)
      window.dispatchEvent(new CustomEvent('bitpredix:balance-changed'))

      // Verifica se ainda ha rounds pendentes apos alguns segundos
      // (pode ter novos rounds desde que o claim comecou)
      setTimeout(fetchPendingRounds, 10000)
    } catch (e) {
      console.error('[ClaimButton] Claim error:', e)
      setError(e instanceof Error ? e.message : 'Claim failed')
    } finally {
      setClaiming(false)
      setClaimProgress(null)
    }
  }

  // Nao mostra se nao conectado ou sem rounds pendentes
  if (!stxAddress || pendingRounds.length === 0) {
    return null
  }

  return (
    <div className="relative group">
      <button
        onClick={handleClaim}
        disabled={claiming}
        className="relative flex items-center justify-center w-8 h-8 rounded-lg
                   text-up hover:bg-up/15
                   disabled:opacity-50 disabled:cursor-not-allowed
                   transition-colors"
        title={`Claim ${pendingRounds.length} pending round${pendingRounds.length > 1 ? 's' : ''}`}
      >
        {claiming ? (
          <div className="h-4 w-4 border-2 border-up border-t-transparent rounded-full animate-spin" />
        ) : (
          <>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-up text-[10px] font-bold text-black leading-none">
              {pendingRounds.length}
            </span>
          </>
        )}
      </button>

      {/* Tooltip on hover */}
      {!claiming && (
        <div className="absolute top-full mt-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap
                        text-[11px] text-up/80 bg-zinc-900/95 px-2 py-1 rounded
                        border border-zinc-700/50 pointer-events-none
                        opacity-0 group-hover:opacity-100 transition-opacity">
          {totalClaimable > 0 ? `~${totalClaimable.toFixed(2)} USDCx` : 'Claim'}
        </div>
      )}

      {error && (
        <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] text-red-400
                        bg-red-500/10 px-2 py-1 rounded border border-red-500/20">
          {error}
        </div>
      )}
    </div>
  )
}
