/**
 * Hook para verificar rounds pendentes de claim
 * Compartilhado entre ClaimButton e ConnectWalletButton
 */

import { useState, useEffect, useCallback } from 'react'
import { getLocalStorage, isConnected } from '@stacks/connect'
import { Cl, cvToJSON, hexToCV, cvToHex } from '@stacks/transactions'

const BITPREDIX_CONTRACT = process.env.NEXT_PUBLIC_BITPREDIX_CONTRACT_ID || ''

export interface PendingRoundInfo {
  roundId: number
  side: string
  amount: number
}

export interface UsePendingRoundsResult {
  pendingRounds: PendingRoundInfo[]
  totalAtStake: number
  loading: boolean
  refresh: () => Promise<void>
}

export function usePendingRounds(): UsePendingRoundsResult {
  const [pendingRounds, setPendingRounds] = useState<PendingRoundInfo[]>([])
  const [totalAtStake, setTotalAtStake] = useState(0)
  const [loading, setLoading] = useState(false)

  const fetchPendingRounds = useCallback(async () => {
    if (!isConnected() || !BITPREDIX_CONTRACT) {
      setPendingRounds([])
      setTotalAtStake(0)
      return
    }

    const data = getLocalStorage()
    const stxAddress = data?.addresses?.stx?.[0]?.address
    if (!stxAddress) {
      setPendingRounds([])
      setTotalAtStake(0)
      return
    }

    setLoading(true)

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
        // Network error or API error - silently ignore, will retry
        return
      }

      const responseData = await response.json()

      if (!responseData.okay || !responseData.result) {
        return
      }

      // Parse o resultado Clarity
      const resultCV = hexToCV(responseData.result)
      const resultJSON = cvToJSON(resultCV)

      // Extrai lista de round IDs
      const roundIds: number[] = resultJSON?.value?.['round-ids']?.value?.map(
        (r: { value: string }) => parseInt(r.value)
      ) || []

      if (roundIds.length === 0) {
        setPendingRounds([])
        setTotalAtStake(0)
        return
      }

      // Busca detalhes de cada aposta
      const rounds: PendingRoundInfo[] = []
      let total = 0

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

              if (betJSON?.value && betJSON.value.claimed?.value !== 'true') {
                const amount = parseInt(betJSON.value.amount?.value || '0')
                rounds.push({
                  roundId,
                  side: betJSON.value.side?.value || '',
                  amount
                })
                total += amount
              }
            }
          }
        } catch {
          // Silently ignore errors fetching individual bets
        }
      }

      setPendingRounds(rounds)
      setTotalAtStake(total / 1e6) // Converte para USD
    } catch (e) {
      console.error('[usePendingRounds] Error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPendingRounds()

    // Polling a cada 30 segundos
    const interval = setInterval(fetchPendingRounds, 30000)
    return () => clearInterval(interval)
  }, [fetchPendingRounds])

  return {
    pendingRounds,
    totalAtStake,
    loading,
    refresh: fetchPendingRounds
  }
}
