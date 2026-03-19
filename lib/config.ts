/**
 * Centralized network + contract config.
 * Fail-fast: if any env var is missing, crash immediately.
 */

export const NETWORK_NAME = (process.env.NEXT_PUBLIC_STACKS_NETWORK || 'testnet') as 'testnet' | 'mainnet'

const _BITPREDIX_CONTRACT = process.env.NEXT_PUBLIC_BITPREDIX_CONTRACT_ID
if (!_BITPREDIX_CONTRACT) throw new Error('NEXT_PUBLIC_BITPREDIX_CONTRACT_ID is required')

const _GATEWAY_CONTRACT = process.env.NEXT_PUBLIC_GATEWAY_CONTRACT_ID
if (!_GATEWAY_CONTRACT) throw new Error('NEXT_PUBLIC_GATEWAY_CONTRACT_ID is required')

const _TOKEN_CONTRACT = process.env.NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID
if (!_TOKEN_CONTRACT) throw new Error('NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID is required')

export const BITPREDIX_CONTRACT = _BITPREDIX_CONTRACT.trim()
export const GATEWAY_CONTRACT = _GATEWAY_CONTRACT.trim()
export const TOKEN_CONTRACT = _TOKEN_CONTRACT.trim()

/** Split "address.name" into [address, name] */
export function splitContractId(contractId: string): [string, string] {
  const [address, name] = contractId.split('.')
  if (!address || !name) throw new Error(`Invalid contract ID: ${contractId}`)
  return [address, name]
}
