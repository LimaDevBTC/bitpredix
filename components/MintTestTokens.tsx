'use client'

import { useState, useEffect, useCallback } from 'react'
import { getLocalStorage, isConnected, openContractCall } from '@stacks/connect'

const CONTRACT_ID = process.env.NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID

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
      setLoading(false)
      setError(null)
      return
    }
    const data = getLocalStorage()
    const addr = data?.addresses?.stx?.[0]?.address ?? null
    setStx(addr)
    setError(null)

    if (!addr) {
      setCanMint(null)
      setLoading(false)
      return
    }

    try {
      const r = await fetch(`/api/mint-status?address=${encodeURIComponent(addr)}`)
      const j = await r.json()
      if (!j.ok) {
        setError(j.error || 'Falha ao verificar mint')
        setCanMint(null)
      } else {
        setCanMint(j.canMint === true)
        setBalance(typeof j.balance === 'string' ? j.balance : '0')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar')
      setCanMint(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Quando a wallet é conectada noutro componente, re-verificar
  useEffect(() => {
    if (stx !== null) return
    const id = setInterval(refresh, 2500)
    return () => clearInterval(id)
  }, [stx, refresh])

  if (!CONTRACT_ID) return null
  if (!isConnected() || !stx) return null

  if (loading) {
    return (
      <span className="text-zinc-500 text-sm">Verificando mint…</span>
    )
  }

  if (error) {
    return (
      <span className="text-red-400/90 text-sm" title={error}>
        Erro
      </span>
    )
  }

  if (canMint) {
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
