'use client'

import { useState, useEffect, useCallback } from 'react'
import { getLocalStorage, isConnected, openContractCall } from '@stacks/connect'

const CONTRACT_ID = process.env.NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID || 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.test-usdcx'

function parseContractId(id: string): [string, string] {
  const i = id.lastIndexOf('.')
  if (i < 0) return ['', '']
  return [id.slice(0, i), id.slice(i + 1)]
}

export function MintTestTokens() {
  const [stx, setStx] = useState<string | null>(null)
  const [canMint, setCanMint] = useState<boolean | null>(null)
  const [balance, setBalance] = useState<string>('0')
  const [loading, setLoading] = useState(true)
  const [minting, setMinting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!isConnected()) {
      setStx(null)
      setCanMint(null)
      setBalance('0')
      setLoading(false)
      setError(null)
      return
    }
    const data = getLocalStorage()
    const addr = data?.addresses?.stx?.[0]?.address ?? null
    setStx(addr)

    if (!addr) {
      setCanMint(null)
      setLoading(false)
      return
    }

    try {
      const r = await fetch(`/api/mint-status?address=${encodeURIComponent(addr)}`)
      const j = await r.json()
      if (!j.ok) {
        // Se já tem balance anterior, mantém o estado atual
        if (balance !== '0') {
          setLoading(false)
          return
        }
        setError(j.error || 'Falha ao verificar')
        setCanMint(false) // Assume que já mintou para evitar mint duplicado
      } else {
        setCanMint(j.canMint === true)
        setBalance(typeof j.balance === 'string' ? j.balance : '0')
        setError(null)
      }
    } catch {
      // Erro de rede - se já tem balance, ignora silenciosamente
      if (balance === '0') {
        setError('Rede indisponível')
        setCanMint(false) // Assume que já mintou para evitar mint duplicado
      }
    } finally {
      setLoading(false)
    }
  }, [balance])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Polling para verificar mudanças (conectou/desconectou)
  useEffect(() => {
    const id = setInterval(() => {
      // Se desconectou, limpa estado
      if (!isConnected()) {
        setStx(null)
        setCanMint(null)
        setBalance('0')
        setLoading(false)
        return
      }
      // Se conectado mas stx é null, atualiza
      if (!stx) {
        refresh()
      }
    }, 2500)
    return () => clearInterval(id)
  }, [stx, refresh])

  // Escuta eventos de mudança de saldo (após apostas, claims, etc)
  useEffect(() => {
    const handleBalanceChanged = () => {
      // Espera um pouco para a transação ser confirmada na rede
      setTimeout(() => {
        refresh()
      }, 3000)
    }
    window.addEventListener('bitpredix:balance-changed', handleBalanceChanged)
    return () => window.removeEventListener('bitpredix:balance-changed', handleBalanceChanged)
  }, [refresh])

  if (!CONTRACT_ID) return null
  if (!isConnected() || !stx) return null

  if (loading) {
    return (
      <span className="text-zinc-500 text-sm">Verificando mint…</span>
    )
  }

  if (error) {
    return (
      <button
        onClick={() => {
          setLoading(true)
          setError(null)
          refresh()
        }}
        className="text-amber-400/90 text-sm hover:text-amber-300 transition"
        title={error}
      >
        ⟳ Retry
      </button>
    )
  }

  // Só mostra botão de mint se temos certeza que pode mintar (canMint === true)
  // Se canMint é null (não verificado), assume que já mintou para evitar mint duplicado
  if (canMint === true) {
    return (
      <button
        type="button"
        onClick={() => {
          const [contractAddress, contractName] = parseContractId(CONTRACT_ID)
          if (!contractAddress || !contractName) return
          setMinting(true)
          setError(null)
          openContractCall({
            contractAddress,
            contractName,
            functionName: 'mint',
            functionArgs: [],
            network: 'testnet',
            onFinish: () => {
              setMinting(false)
              refresh()
            },
            onCancel: () => {
              setMinting(false)
            },
          })
        }}
        disabled={minting}
        className="px-3 py-2 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30 hover:border-emerald-500/60 font-medium text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {minting ? 'A assinar…' : 'mint test usdc'}
      </button>
    )
  }

  return (
    <span className="text-zinc-500 text-sm">
      {(Number(balance || '0') / 1e6).toFixed(2)} TUSDC
    </span>
  )
}
