'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { getLocalStorage, openContractCall, isConnected } from '@stacks/connect'
import { Cl, cvToJSON, hexToCV, cvToHex, Pc, FungibleConditionCode } from '@stacks/transactions'
import { getRoundPrices } from '@/lib/pyth'

const BITPREDIX_CONTRACT = process.env.NEXT_PUBLIC_BITPREDIX_CONTRACT_ID || 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.bitpredix-v5'
const TOKEN_CONTRACT = process.env.NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID || 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.test-usdcx'
const MAX_CLAIMS_PER_TX = 10

interface PendingRound {
  roundId: number
  bet: {
    side: string
    amount: number
    claimed: boolean
  }
}

export function ClaimButton() {
  const [stxAddress, setStxAddress] = useState<string | null>(null)
  const [pendingRounds, setPendingRounds] = useState<PendingRound[]>([])
  const [totalClaimable, setTotalClaimable] = useState(0)
  const [claiming, setClaiming] = useState(false)
  const [claimProgress, setClaimProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollingRef = useRef<NodeJS.Timeout | null>(null)

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
    if (!stxAddress || !BITPREDIX_CONTRACT) return

    try {
      const [contractAddr, contractName] = BITPREDIX_CONTRACT.split('.')
      if (!contractAddr || !contractName) return

      // Chama get-user-pending-rounds via proxy (evita CORS)
      const response = await fetch('/api/stacks-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractId: BITPREDIX_CONTRACT,
          functionName: 'get-user-pending-rounds',
          args: [cvToHex(Cl.principal(stxAddress))],
          sender: stxAddress
        })
      }).catch(() => null) // Silently handle network errors

      if (!response || !response.ok) {
        // Network error - silently ignore, will retry
        return
      }

      const data = await response.json()

      if (!data.okay || !data.result) {
        // Invalid response - silently ignore
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

      // Busca detalhes de cada aposta
      const rounds: PendingRound[] = []
      for (const roundId of roundIds) {
        try {
          const betResponse = await fetch('/api/stacks-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contractId: BITPREDIX_CONTRACT,
              functionName: 'get-bet',
              args: [
                cvToHex(Cl.uint(roundId)),
                cvToHex(Cl.principal(stxAddress))
              ],
              sender: stxAddress
            })
          }).catch(() => null) // Silently handle network errors

          if (betResponse && betResponse.ok) {
            const betData = await betResponse.json()
            if (betData.okay && betData.result) {
              const betCV = hexToCV(betData.result)
              const betJSON = cvToJSON(betCV)

              if (betJSON?.value) {
                rounds.push({
                  roundId,
                  bet: {
                    side: betJSON.value.side?.value || '',
                    amount: parseInt(betJSON.value.amount?.value || '0'),
                    claimed: betJSON.value.claimed?.value === 'true'
                  }
                })
              }
            }
          }
        } catch {
          // Silently ignore errors fetching individual bets
        }
      }

      // Filtra apenas nao-claimed
      const unclaimed = rounds.filter(r => !r.bet.claimed)
      setPendingRounds(unclaimed)

      // Calcula total estimado (simplificado - assume 50% de chance de ganho)
      // Na pratica, o usuario pode ter ganho ou perdido
      const total = unclaimed.reduce((sum, r) => sum + r.bet.amount, 0)
      setTotalClaimable(total / 1e6) // Converte de 6 decimais para USD
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

      let processed = 0
      for (const batch of batches) {
        for (const round of batch) {
          setClaimProgress(`Processando ${processed + 1} de ${pendingRounds.length}...`)

          try {
            // Busca precos do Pyth para este round
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
              processed++
              continue // Skip this round if we can't get prices
            }

            setClaimProgress(`Enviando claim ${processed + 1} de ${pendingRounds.length}...`)

            // Post-conditions: permite que o contrato envie tokens para o usuario
            // Como nao sabemos o valor exato do payout, usamos willSendGte(0)
            const [tokenAddr, tokenName] = TOKEN_CONTRACT.split('.')
            console.log('[ClaimButton] TOKEN_CONTRACT:', TOKEN_CONTRACT, 'tokenAddr:', tokenAddr, 'tokenName:', tokenName)

            // Post-condition: contrato enviara >= 0 tokens (permite qualquer transferencia do contrato)
            const postConditions = tokenAddr && tokenName ? [
              Pc.principal(BITPREDIX_CONTRACT)
                .willSendGte(1) // Minimo 1 unidade (não 0)
                .ft(`${tokenAddr}.${tokenName}`, 'test-usdcx')
            ] : []

            console.log('[ClaimButton] postConditions:', postConditions, 'length:', postConditions.length)

            // Chama claim-round no contrato
            const txId = await new Promise<string>((resolve, reject) => {
              openContractCall({
                contractAddress: contractAddr,
                contractName: contractName,
                functionName: 'claim-round',
                functionArgs: [
                  Cl.uint(round.roundId),
                  Cl.uint(prices.priceStart),
                  Cl.uint(prices.priceEnd)
                ],
                postConditions, // Post-conditions explicitas para permitir transferencia
                network: 'testnet',
                onFinish: (data) => {
                  console.log('[ClaimButton] Claim tx submitted:', data.txId)
                  resolve(data.txId)
                },
                onCancel: () => {
                  reject(new Error('Transaction cancelled by user'))
                }
              })
            })

            // Tx foi enviada - remove otimisticamente da lista de pendentes
            setPendingRounds(prev => prev.filter(r => r.roundId !== round.roundId))
            console.log(`[ClaimButton] Round ${round.roundId} removed from pending (optimistic)`)

            processed++
          } catch (e) {
            console.error(`[ClaimButton] Failed to claim round ${round.roundId}:`, e)
            // Continua para o proximo round mesmo se um falhar
            processed++
          }
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
    <div className="relative">
      <button
        onClick={handleClaim}
        disabled={claiming}
        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/20
                   border border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/30
                   hover:border-emerald-500/70 disabled:opacity-50 disabled:cursor-not-allowed
                   transition-colors text-sm font-medium"
        title={`Claim ${pendingRounds.length} pending round${pendingRounds.length > 1 ? 's' : ''}`}
      >
        {claiming ? (
          <>
            <div className="h-4 w-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
            <span className="hidden sm:inline">{claimProgress || 'Claiming...'}</span>
            <span className="sm:hidden">...</span>
          </>
        ) : (
          <>
            <span aria-hidden="true">🔔</span>
            <span className="hidden sm:inline">CLAIM</span>
            <span className="bg-emerald-500/30 px-1.5 py-0.5 rounded text-xs font-mono">
              {pendingRounds.length}
            </span>
          </>
        )}
      </button>

      {/* Tooltip com valor estimado */}
      {!claiming && totalClaimable > 0 && (
        <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 whitespace-nowrap
                        text-xs text-emerald-400/80 bg-zinc-900/90 px-2 py-1 rounded
                        border border-emerald-500/20 pointer-events-none">
          ~{totalClaimable.toFixed(2)} USDCx at stake
        </div>
      )}

      {error && (
        <div className="absolute top-full mt-1 left-0 right-0 text-xs text-red-400
                        bg-red-500/10 px-2 py-1 rounded border border-red-500/20">
          {error}
        </div>
      )}
    </div>
  )
}
