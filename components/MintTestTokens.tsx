'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { getLocalStorage, isConnected } from '@stacks/connect'

const CONTRACT_ID = process.env.NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID || 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.test-usdcx'
const STORAGE_KEY = 'bitpredix_mint_status'

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
  const [error, setError] = useState<string | null>(null)
  // Quando o user submeteu mint — previne refresh stale de re-habilitar botão
  const mintedAtRef = useRef(0)

  const refresh = useCallback(async () => {
    if (!isConnected()) {
      setStx(null)
      setCanMint(null)
      // NÃO reseta balance — componente já retorna null quando desconectado
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

    // Carrega estado do cache primeiro (para evitar flicker)
    const cached = loadMintStatus(addr)
    if (cached) {
      // Usa cache enquanto não verificou - NUNCA permite mint do cache
      setBalance(cached.balance)
      setCanMint(false) // SEMPRE assume que não pode mintar do cache
    }

    // Se mintou recentemente, pula cache do servidor para pegar dados frescos
    const mintPending = mintedAtRef.current > 0 && Date.now() - mintedAtRef.current < 120_000

    try {
      const url = `/api/mint-status?address=${encodeURIComponent(addr)}${mintPending ? '&nocache=1' : ''}`
      const r = await fetch(url)
      const j = await r.json()
      if (!j.ok) {
        // API retornou erro - NUNCA permite mint em caso de erro
        setError(j.error || 'Falha ao verificar')
        setCanMint(false)
        // Mantém balance anterior se existir
      } else {
        // Sucesso na verificação
        const newCanMint = j.canMint === true
        setError(null)

        if (mintPending && newCanMint) {
          // API retornou stale canMint=true mas user acabou de mintar
          // Mantém canMint=false, não sobrescreve cache
          // Mas atualiza saldo se confirmado > 0 (mint confirmou on-chain)
          if (j.balanceConfirmed !== false) {
            const newBalance = typeof j.balance === 'string' ? j.balance : '0'
            if (Number(newBalance) > 0) {
              setBalance(newBalance)
              mintedAtRef.current = 0
              saveMintStatus(addr, true, newBalance)
            }
          }
        } else {
          setCanMint(newCanMint)
          // Limpa mintPending quando API confirma que mint aconteceu
          if (mintPending) mintedAtRef.current = 0

          if (j.balanceConfirmed !== false) {
            const newBalance = typeof j.balance === 'string' ? j.balance : '0'
            setBalance(newBalance)
            const hasMinted = !newCanMint || Number(newBalance) > 0
            saveMintStatus(addr, hasMinted, newBalance)
          }
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

  // Limpa estado imediatamente ao desconectar a carteira
  useEffect(() => {
    const handleDisconnect = () => {
      setStx(null)
      setBalance('0')
      setCanMint(null)
      mintedAtRef.current = 0
    }
    window.addEventListener('bitpredix:wallet-disconnected', handleDisconnect)
    return () => window.removeEventListener('bitpredix:wallet-disconnected', handleDisconnect)
  }, [])

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
      <span className="text-zinc-500 text-sm hidden sm:inline">
        ${(balanceNum / 1e6).toFixed(2)}
      </span>
    )
  }

  // REGRA 2: Se está carregando, mostra loading (nunca botão de mint)
  if (loading) {
    return (
      <span className="text-zinc-500 text-sm hidden sm:inline">Verificando…</span>
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
      <span className="text-zinc-500 text-sm hidden sm:inline">
        ${(balanceNum / 1e6).toFixed(2)}
      </span>
    )
  }

  // Fallback: mostra saldo (mesmo que seja 0) — mint agora acontece no MarketCard
  return (
    <span className="text-zinc-500 text-sm hidden sm:inline">
      ${(balanceNum / 1e6).toFixed(2)}
    </span>
  )
}
