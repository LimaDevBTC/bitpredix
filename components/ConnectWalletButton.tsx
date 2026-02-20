'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { connect, disconnect, getLocalStorage, isConnected, request } from '@stacks/connect'
import { usePendingRounds } from '@/lib/usePendingRounds'

const STORAGE_KEY = '@stacks/connect'

function truncateAddress(addr: string, head = 6, tail = 4): string {
  if (addr.length <= head + tail) return addr
  return `${addr.slice(0, head)}...${addr.slice(-tail)}`
}

/**
 * Conecta à carteira. connect() usa getAddresses, que na Xverse pode devolver
 * "invalid parameters"; stx_getAccounts é o método suportado. Tenta getAddresses
 * primeiro; em fallback stx_getAccounts e gravação manual em localStorage.
 */
async function doConnect(): Promise<void> {
  try {
    await connect({ forceWalletSelect: true })
    return
  } catch {
    // Xverse: getAddresses com suporte parcial; stx_getAccounts é suportado.
  }
  const res = await request(
    { forceWalletSelect: true, enableLocalStorage: false },
    'stx_getAccounts',
    { network: 'testnet' }
  )
  const stx = res.accounts?.find(
    (a) => typeof a?.address === 'string' && (a.address.startsWith('SP') || a.address.startsWith('ST'))
  )
  if (!stx?.address) throw new Error('Nenhum endereço STX devolvido')
  const data = {
    addresses: { stx: [{ address: stx.address }], btc: [] as { address: string }[] },
    version: '1',
    updatedAt: Date.now(),
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }
}

export function ConnectWalletButton() {
  const [stxAddress, setStxAddress] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [showDisconnectWarning, setShowDisconnectWarning] = useState(false)
  const [showConnectNotice, setShowConnectNotice] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const prevAddressRef = useRef<string | null>(null)

  const { pendingRounds, totalAtStake } = usePendingRounds()

  const refreshAddress = useCallback(() => {
    if (!isConnected()) {
      setStxAddress(null)
      return
    }
    const data = getLocalStorage()
    const addr = data?.addresses?.stx?.[0]?.address ?? null
    setStxAddress(addr)
  }, [])

  useEffect(() => {
    refreshAddress()
  }, [refreshAddress])

  // Mostra notificacao ao reconectar com saldo pendente
  useEffect(() => {
    if (stxAddress && !prevAddressRef.current && pendingRounds.length > 0) {
      setShowConnectNotice(true)
      // Auto-hide apos 5 segundos
      const timeout = setTimeout(() => setShowConnectNotice(false), 5000)
      return () => clearTimeout(timeout)
    }
    prevAddressRef.current = stxAddress
  }, [stxAddress, pendingRounds.length])

  useEffect(() => {
    if (!dropdownOpen) return
    const onOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [dropdownOpen])

  const handleConnect = async () => {
    setLoading(true)
    setError(null)
    try {
      await doConnect()
      refreshAddress()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao conectar')
    } finally {
      setLoading(false)
    }
  }

  const handleDisconnectClick = () => {
    // Se tem saldo pendente, mostra aviso primeiro
    if (pendingRounds.length > 0) {
      setShowDisconnectWarning(true)
      setDropdownOpen(false)
    } else {
      handleDisconnect()
    }
  }

  const handleDisconnect = () => {
    setDropdownOpen(false)
    setShowDisconnectWarning(false)
    disconnect()
    setStxAddress(null)
    setError(null)
    window.dispatchEvent(new CustomEvent('bitpredix:wallet-disconnected'))
  }

  if (stxAddress) {
    return (
      <>
        {/* Modal de aviso ao desconectar com saldo pendente */}
        {showDisconnectWarning && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
              <div className="text-center mb-4">
                <span className="text-3xl">⚠️</span>
              </div>
              <h3 className="text-lg font-semibold text-zinc-100 text-center mb-2">
                Saldo pendente!
              </h3>
              <p className="text-sm text-zinc-400 text-center mb-4">
                Voce tem <strong className="text-emerald-400">{pendingRounds.length}</strong> round{pendingRounds.length > 1 ? 's' : ''} com{' '}
                <strong className="text-emerald-400">{totalAtStake.toFixed(2)} USDCx</strong> para claim.
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setShowDisconnectWarning(false)}
                  className="w-full px-4 py-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30 font-medium text-sm transition-colors"
                >
                  Voltar e fazer CLAIM
                </button>
                <button
                  onClick={handleDisconnect}
                  className="w-full px-4 py-2 rounded-xl bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300 font-medium text-sm transition-colors"
                >
                  Sair mesmo assim
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Notificacao ao conectar com saldo pendente */}
        {showConnectNotice && (
          <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-top-2 duration-300">
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 shadow-lg max-w-xs">
              <div className="flex items-start gap-3">
                <span className="text-xl">💰</span>
                <div className="flex-1">
                  <p className="text-sm text-emerald-300 font-medium">
                    Voce tem {totalAtStake.toFixed(2)} USDCx pendente!
                  </p>
                  <p className="text-xs text-emerald-400/70 mt-1">
                    Clique em CLAIM para receber.
                  </p>
                </div>
                <button
                  onClick={() => setShowConnectNotice(false)}
                  className="text-zinc-500 hover:text-zinc-300 text-lg leading-none"
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="relative flex items-center gap-1.5 sm:gap-2" ref={dropdownRef}>
          <span
            className="text-zinc-400 font-mono text-xs sm:text-sm max-w-[80px] sm:max-w-[140px] truncate hidden sm:inline"
            title={stxAddress}
          >
            {truncateAddress(stxAddress)}
          </span>
          <div className="relative">
            <button
              type="button"
              onClick={() => setDropdownOpen((o) => !o)}
              className="px-2 sm:px-3 py-1.5 sm:py-2 rounded-xl bg-up/20 text-up border border-up/40 hover:bg-up/30 hover:border-up/60 font-medium text-xs sm:text-sm transition-colors flex items-center gap-1 sm:gap-1.5"
              aria-expanded={dropdownOpen}
              aria-haspopup="true"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-up shrink-0" aria-hidden />
              <span className="hidden sm:inline">Connected</span>
              <span className="sm:hidden">{truncateAddress(stxAddress, 4, 3)}</span>
            </button>
            {dropdownOpen && (
              <div
                className="absolute right-0 top-full mt-1 min-w-[140px] rounded-xl border border-zinc-800 bg-zinc-900 shadow-lg py-1 z-50"
                role="menu"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleDisconnectClick}
                  className="w-full px-4 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors rounded-lg mx-1"
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>
        </div>
      </>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleConnect}
        disabled={loading}
        className="px-4 py-2 rounded-xl bg-bitcoin/20 text-bitcoin border border-bitcoin/40 hover:bg-bitcoin/30 hover:border-bitcoin/60 font-medium text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? 'Connecting…' : 'Connect wallet'}
      </button>
      {error && (
        <span className="text-xs text-red-400/90 max-w-[200px] text-right">
          {error}
        </span>
      )}
    </div>
  )
}
