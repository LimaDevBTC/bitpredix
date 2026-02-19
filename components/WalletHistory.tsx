'use client'

import { useState, useEffect, useCallback } from 'react'
import { getLocalStorage, isConnected } from '@stacks/connect'

const DEPLOYER = 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK'
const PAGE_SIZE = 20

interface FunctionArg {
  hex: string
  repr: string
  name: string
  type: string
}

interface ContractCall {
  contract_id: string
  function_name: string
  function_args: FunctionArg[]
}

interface TxResult {
  tx_id: string
  tx_type: string
  tx_status: string
  block_time: number
  block_time_iso: string
  burn_block_time: number
  contract_call: ContractCall
  tx_result?: { hex: string; repr: string }
}

interface ParsedTx {
  txId: string
  type: string
  contract: string
  functionName: string
  status: 'success' | 'pending' | 'failed'
  timestamp: number
  details: string
  args: FunctionArg[]
  resultRepr?: string
}

function getContractLabel(contractId: string): string {
  const name = contractId.split('.')[1] || contractId
  if (name.startsWith('bitpredix-')) return name
  if (name === 'test-usdcx') return 'test-usdcx'
  if (name.startsWith('oracle')) return name
  return name
}

function getFunctionLabel(fn: string): string {
  const labels: Record<string, string> = {
    'mint': 'Mint Tokens',
    'approve': 'Approve Contract',
    'transfer-from': 'Transfer',
    'transfer': 'Transfer',
    'place-bet': 'Place Bet',
    'claim-round': 'Claim Round',
    'claim-round-side': 'Claim Round',
    'get-bet': 'Get Bet',
    'get-user-bets': 'Get User Bets',
  }
  return labels[fn] || fn
}

function getFunctionIcon(fn: string): string {
  if (fn === 'mint') return 'M'
  if (fn === 'approve') return 'A'
  if (fn.startsWith('place-bet')) return 'B'
  if (fn.startsWith('claim-round')) return 'C'
  if (fn.startsWith('transfer')) return 'T'
  return 'TX'
}

function getFunctionColor(fn: string): string {
  if (fn === 'mint') return 'text-purple-400 bg-purple-400/10 border-purple-400/30'
  if (fn === 'approve') return 'text-blue-400 bg-blue-400/10 border-blue-400/30'
  if (fn.startsWith('place-bet')) return 'text-bitcoin bg-bitcoin/10 border-bitcoin/30'
  if (fn.startsWith('claim-round')) return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30'
  if (fn.startsWith('transfer')) return 'text-cyan-400 bg-cyan-400/10 border-cyan-400/30'
  return 'text-zinc-400 bg-zinc-400/10 border-zinc-400/30'
}

function getStatusColor(status: string): string {
  if (status === 'success') return 'text-emerald-400'
  if (status === 'pending') return 'text-yellow-400'
  return 'text-red-400'
}

function getStatusLabel(status: string): string {
  if (status === 'success') return 'Success'
  if (status === 'pending') return 'Pending'
  if (status.includes('abort')) return 'Failed'
  return status
}

function parseArgValue(arg: FunctionArg): string {
  const repr = arg.repr
  // Clarity repr formats: u12345, "UP", 'ST1...address
  if (repr.startsWith('u')) return repr.slice(1)
  if (repr.startsWith('"') && repr.endsWith('"')) return repr.slice(1, -1)
  if (repr.startsWith("'")) return repr.slice(1, 7) + '...' + repr.slice(-4)
  return repr
}

function formatDetails(fn: string, args: FunctionArg[]): string {
  const argMap: Record<string, string> = {}
  for (const a of args) {
    argMap[a.name] = a.repr
  }

  if (fn === 'place-bet') {
    const roundId = argMap['round-id']?.replace('u', '') || '?'
    const side = argMap['side']?.replace(/"/g, '') || '?'
    const amount = argMap['amount']?.replace('u', '') || '0'
    const usd = (parseInt(amount) / 1e6).toFixed(2)
    return `Round ${roundId} · ${side} · $${usd}`
  }

  if (fn === 'claim-round-side' || fn === 'claim-round') {
    const roundId = argMap['round-id']?.replace('u', '') || '?'
    const side = argMap['side']?.replace(/"/g, '') || ''
    return side ? `Round ${roundId} · ${side}` : `Round ${roundId}`
  }

  if (fn === 'approve') {
    const amount = argMap['amount']?.replace('u', '') || '0'
    const spender = argMap['spender'] || ''
    const usd = (parseInt(amount) / 1e6).toFixed(0)
    const contract = spender.split('.')[1] || ''
    return contract ? `${contract} · $${usd}` : `$${usd}`
  }

  if (fn === 'mint') {
    return 'Test tokens'
  }

  if (fn === 'transfer-from' || fn === 'transfer') {
    const amount = argMap['amount']?.replace('u', '') || '0'
    const usd = (parseInt(amount) / 1e6).toFixed(2)
    return `$${usd} USDCx`
  }

  // Fallback: show args summary
  return args.map(a => `${a.name}=${parseArgValue(a)}`).join(', ')
}

function parseTx(tx: TxResult): ParsedTx {
  const cc = tx.contract_call
  const status = tx.tx_status === 'success' ? 'success' :
    tx.tx_status === 'pending' ? 'pending' : 'failed'

  return {
    txId: tx.tx_id,
    type: getFunctionLabel(cc.function_name),
    contract: getContractLabel(cc.contract_id),
    functionName: cc.function_name,
    status,
    timestamp: tx.block_time || tx.burn_block_time || 0,
    details: formatDetails(cc.function_name, cc.function_args || []),
    args: cc.function_args || [],
    resultRepr: tx.tx_result?.repr,
  }
}

function timeAgo(ts: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - ts
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(ts * 1000).toLocaleDateString()
}

export function WalletHistory() {
  const [stxAddress, setStxAddress] = useState<string | null>(null)
  const [transactions, setTransactions] = useState<ParsedTx[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const [expanded, setExpanded] = useState(false)

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
    const interval = setInterval(refreshAddress, 3000)
    return () => clearInterval(interval)
  }, [refreshAddress])

  const fetchHistory = useCallback(async (addr: string, pageOffset: number, append: boolean) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/wallet-history?address=${addr}&limit=${PAGE_SIZE}&offset=${pageOffset}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Unknown error')

      const parsed: ParsedTx[] = (data.results || []).map(parseTx)
      setTransactions(prev => append ? [...prev, ...parsed] : parsed)
      // There may be more if total > current offset + fetched
      setHasMore(pageOffset + PAGE_SIZE < data.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load history')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!stxAddress) {
      setTransactions([])
      setOffset(0)
      return
    }
    setOffset(0)
    fetchHistory(stxAddress, 0, false)
  }, [stxAddress, fetchHistory])

  const loadMore = () => {
    if (!stxAddress || loading) return
    const newOffset = offset + PAGE_SIZE
    setOffset(newOffset)
    fetchHistory(stxAddress, newOffset, true)
  }

  // Not connected or no transactions
  if (!stxAddress) {
    return (
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5 text-sm text-zinc-400">
        <h3 className="font-semibold text-zinc-300 mb-2">Wallet Activity</h3>
        <p className="text-zinc-500 text-xs">Connect your wallet to see your protocol activity.</p>
      </section>
    )
  }

  return (
    <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5 text-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-zinc-300">Wallet Activity</h3>
        <div className="flex items-center gap-2">
          {transactions.length > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {expanded ? 'Collapse' : `Show all (${transactions.length})`}
            </button>
          )}
          <button
            onClick={() => stxAddress && fetchHistory(stxAddress, 0, false)}
            disabled={loading}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-50"
            title="Refresh"
          >
            {loading ? '...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-400/80 mb-3 bg-red-500/5 rounded-lg px-3 py-2 border border-red-500/10">
          {error}
        </div>
      )}

      {transactions.length === 0 && !loading && !error && (
        <p className="text-zinc-500 text-xs">No protocol interactions found for this wallet.</p>
      )}

      {loading && transactions.length === 0 && (
        <div className="flex items-center gap-2 text-zinc-500 text-xs py-4 justify-center">
          <div className="h-3 w-3 border border-zinc-500 border-t-transparent rounded-full animate-spin" />
          Loading history...
        </div>
      )}

      {transactions.length > 0 && (
        <div className="space-y-1.5">
          {(expanded ? transactions : transactions.slice(0, 5)).map((tx) => (
            <div
              key={tx.txId}
              className="flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-900/80 border border-zinc-800/50 hover:border-zinc-700/50 transition-colors group"
            >
              {/* Icon */}
              <div className={`shrink-0 w-8 h-8 rounded-lg border flex items-center justify-center text-xs font-bold ${getFunctionColor(tx.functionName)}`}>
                {getFunctionIcon(tx.functionName)}
              </div>

              {/* Main info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-200 font-medium text-xs">{tx.type}</span>
                  <span className="text-zinc-600 text-[10px]">{tx.contract}</span>
                </div>
                <div className="text-zinc-500 text-xs truncate">{tx.details}</div>
              </div>

              {/* Status + time */}
              <div className="shrink-0 text-right">
                <div className={`text-[10px] font-medium ${getStatusColor(tx.status)}`}>
                  {getStatusLabel(tx.status)}
                </div>
                <div className="text-zinc-600 text-[10px]">
                  {tx.timestamp > 0 ? timeAgo(tx.timestamp) : '...'}
                </div>
              </div>

              {/* Explorer link */}
              <a
                href={`https://explorer.hiro.so/txid/${tx.txId}?chain=testnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors opacity-0 group-hover:opacity-100"
                title="View on Explorer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          ))}

          {/* Load more */}
          {expanded && hasMore && (
            <button
              onClick={loadMore}
              disabled={loading}
              className="w-full py-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Load more'}
            </button>
          )}

          {/* Loading indicator for pagination */}
          {loading && transactions.length > 0 && (
            <div className="flex items-center gap-2 text-zinc-500 text-xs py-2 justify-center">
              <div className="h-3 w-3 border border-zinc-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
      )}
    </section>
  )
}
