'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { connect, disconnect, getLocalStorage, isConnected, request } from '@stacks/connect'

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
  const dropdownRef = useRef<HTMLDivElement>(null)

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

  const handleDisconnect = () => {
    setDropdownOpen(false)
    disconnect()
    setStxAddress(null)
    setError(null)
    window.dispatchEvent(new CustomEvent('bitpredix:wallet-disconnected'))
  }

  if (stxAddress) {
    return (
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
                onClick={handleDisconnect}
                className="w-full px-4 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors rounded-lg mx-1"
              >
                Disconnect
              </button>
            </div>
          )}
        </div>
      </div>
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
