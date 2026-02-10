'use client'

import { useState, useEffect, useCallback } from 'react'
import { getLocalStorage, isConnected, openContractCall } from '@stacks/connect'

const CONTRACT_ID = process.env.NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID || 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.test-usdcx'
const STORAGE_KEY = 'bitpredix_mint_status'

function parseContractId(id: string): [string, string] {
  const i = id.lastIndexOf('.')
  if (i < 0) return ['', '']
  return [id.slice(0, i), id.slice(i + 1)]
}

// Salva estado no localStorage para persistir entre reloads
function saveMintStatus(address: string, hasMinted: boolean, balance: string) {
  if (typeof window === 'undefined') return
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    data[address] = { hasMinted, balance, timestamp: Date.now() }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch { /* ignore */ }
}

// Carrega estado do localStorage
function loadMintStatus(address: string): { hasMinted: boolean; balance: string } | null {
  if (typeof window === 'undefined') return null
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    const entry = data[address]
    // Cache válido por 1 hora
    if (entry && Date.now() - entry.timestamp < 3600000) {
      return { hasMinted: entry.hasMinted, balance: entry.balance }
    }
  } catch { /* ignore */ }
  return null
}

export function MintTestTokens() {
  const [stx, setStx] = useState<string | null>(null)
  const [canMint, setCanMint] = useState<boolean | null>(null)
  const [balance, setBalance] = useState<string>('0')
  const [loading, setLoading] = useState(true)
  const [minting, setMinting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Flag para indicar que já verificamos pelo menos uma vez com sucesso
  const [verified, setVerified] = useState(false)

  const refresh = useCallback(async () => {
    if (!isConnected()) {
      setStx(null)
      setCanMint(null)
      // NÃO reseta balance — componente já retorna null quando desconectado
      setLoading(false)
      setError(null)
      setVerified(false)
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

    // Carrega estado do cache primeiro (para evitar flicker)
    const cached = loadMintStatus(addr)
    if (cached) {
      // Usa cache enquanto não verificou - NUNCA permite mint do cache
      setBalance(cached.balance)
      setCanMint(false) // SEMPRE assume que não pode mintar do cache
    }

    try {
      const r = await fetch(`/api/mint-status?address=${encodeURIComponent(addr)}`)
      const j = await r.json()
      if (!j.ok) {
        // API retornou erro - NUNCA permite mint em caso de erro
        setError(j.error || 'Falha ao verificar')
        setCanMint(false)
        // Mantém balance anterior se existir
      } else {
        // Sucesso na verificação
        setVerified(true)
        const newCanMint = j.canMint === true
        setCanMint(newCanMint)
        setError(null)

        // Só atualiza saldo com leitura confirmada on-chain
        // balanceConfirmed === false significa que o read falhou e '0' é default
        if (j.balanceConfirmed !== false) {
          const newBalance = typeof j.balance === 'string' ? j.balance : '0'
          setBalance(newBalance)

          // Salva no cache - hasMinted = true se canMint é false OU se tem balance > 0
          const hasMinted = !newCanMint || Number(newBalance) > 0
          saveMintStatus(addr, hasMinted, newBalance)
        }
      }
    } catch {
      // Erro de rede - NUNCA permite mint em caso de erro
      setError('Rede indisponível')
      setCanMint(false)
      // Mantém balance anterior
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Polling para verificar mudanças (conectou/desconectou) e atualizar saldo
  useEffect(() => {
    const id = setInterval(() => {
      // Se desconectou, apenas pula — componente retorna null quando desconectado
      // NÃO reseta balance para evitar flicker
      if (!isConnected()) return
      refresh()
    }, 30000) // 30s para evitar 429 da Hiro API
    return () => clearInterval(id)
  }, [stx, refresh])

  // Escuta eventos de mudança de saldo (após apostas, claims, etc)
  useEffect(() => {
    const handleBalanceChanged = () => {
      // Tenta atualizar em intervalos crescentes para pegar a confirmação on-chain
      // Transações testnet demoram ~30-60s para confirmar
      setTimeout(() => refresh(), 5000)
      setTimeout(() => refresh(), 15000)
      setTimeout(() => refresh(), 30000)
    }
    window.addEventListener('bitpredix:balance-changed', handleBalanceChanged)
    return () => window.removeEventListener('bitpredix:balance-changed', handleBalanceChanged)
  }, [refresh])

  if (!CONTRACT_ID) return null
  if (!isConnected() || !stx) return null

  const balanceNum = Number(balance || '0')
  const hasBalance = balanceNum > 0

  // Carrega cache para verificar se já mintou antes
  const cached = loadMintStatus(stx)
  const cachedHasMinted = cached?.hasMinted === true

  // REGRA 1: Se tem saldo > 0, SEMPRE mostra o saldo
  if (hasBalance) {
    return (
      <span className="text-zinc-500 text-sm">
        {(balanceNum / 1e6).toFixed(2)} TUSDC
      </span>
    )
  }

  // REGRA 2: Se está carregando, mostra loading (nunca botão de mint)
  if (loading) {
    return (
      <span className="text-zinc-500 text-sm">Verificando…</span>
    )
  }

  // REGRA 3: Se tem erro, mostra retry (nunca botão de mint)
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

  // REGRA 4: Se o cache indica que já mintou, mostra saldo (nunca botão)
  if (cachedHasMinted) {
    return (
      <span className="text-zinc-500 text-sm">
        {(balanceNum / 1e6).toFixed(2)} TUSDC
      </span>
    )
  }

  // REGRA 5: Só mostra botão de mint se TODAS as condições são verdadeiras:
  // - canMint é EXPLICITAMENTE true (não null, não false)
  // - Não está carregando
  // - Não tem erro
  // - Não tem saldo
  // - Cache não indica que já mintou
  // - Verificamos com sucesso pelo menos uma vez
  if (canMint === true && verified) {
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
              // Marca como mintou no cache mas mantém saldo atual
              // Saldo real será atualizado via refresh() quando tx confirmar on-chain
              saveMintStatus(stx, true, balance)
              setCanMint(false)
              // Dispara refresh com backoff para pegar confirmação on-chain
              window.dispatchEvent(new CustomEvent('bitpredix:balance-changed'))
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

  // Fallback: mostra saldo (mesmo que seja 0) - NUNCA mostra botão de mint como fallback
  return (
    <span className="text-zinc-500 text-sm">
      {(balanceNum / 1e6).toFixed(2)} TUSDC
    </span>
  )
}
