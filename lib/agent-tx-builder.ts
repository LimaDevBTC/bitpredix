/**
 * Agent Transaction Builder — server-side unsigned tx construction
 *
 * Builds unsigned sponsored transactions that agents sign locally
 * with their private key, then POST to /api/sponsor.
 */

import {
  makeUnsignedContractCall,
  uintCV,
  stringAsciiCV,
  boolCV,
  contractPrincipalCV,
  PostConditionMode,
} from '@stacks/transactions'

import { BITPREDIX_CONTRACT, GATEWAY_CONTRACT, TOKEN_CONTRACT, NETWORK_NAME, splitContractId } from '@/lib/config'

interface BuildTxResult {
  txHex: string
  details: {
    contractId: string
    functionName: string
    [key: string]: unknown
  }
}

/**
 * Build unsigned place-bet tx via gateway contract.
 * Agent signs this, then POSTs to /api/sponsor.
 */
export async function buildPlaceBetTx(
  publicKey: string,
  side: 'UP' | 'DOWN',
  amountUsd: number,
  roundId?: number,
): Promise<BuildTxResult> {
  const rid = roundId ?? Math.floor(Date.now() / 1000 / 60)
  const amountMicro = Math.round(amountUsd * 1e6)
  const isEarly = Date.now() - rid * 60 * 1000 < 20_000

  const [gwAddr, gwName] = splitContractId(GATEWAY_CONTRACT)

  const tx = await makeUnsignedContractCall({
    contractAddress: gwAddr,
    contractName: gwName,
    functionName: 'place-bet',
    functionArgs: [
      uintCV(rid),
      stringAsciiCV(side),
      uintCV(amountMicro),
      boolCV(isEarly),
    ],
    publicKey,
    network: NETWORK_NAME,
    fee: 0,
    sponsored: true,
    postConditionMode: PostConditionMode.Allow,
  })

  return {
    txHex: tx.serialize(),
    details: {
      contractId: GATEWAY_CONTRACT,
      functionName: 'place-bet',
      roundId: rid,
      side,
      amountMicro,
      isEarly,
    },
  }
}

/**
 * Build unsigned approve tx (token approval for the market contract).
 */
export async function buildApproveTx(publicKey: string): Promise<BuildTxResult> {
  const [tokenAddr, tokenName] = splitContractId(TOKEN_CONTRACT)
  const [predixAddr, predixName] = splitContractId(BITPREDIX_CONTRACT)

  const MAX_APPROVE = BigInt('1000000000000') // 1M USDCx

  const tx = await makeUnsignedContractCall({
    contractAddress: tokenAddr,
    contractName: tokenName,
    functionName: 'approve',
    functionArgs: [
      contractPrincipalCV(predixAddr, predixName),
      uintCV(MAX_APPROVE),
    ],
    publicKey,
    network: NETWORK_NAME,
    fee: 0,
    sponsored: true,
    postConditionMode: PostConditionMode.Allow,
  })

  return {
    txHex: tx.serialize(),
    details: {
      contractId: TOKEN_CONTRACT,
      functionName: 'approve',
      spender: BITPREDIX_CONTRACT,
      amount: Number(MAX_APPROVE),
    },
  }
}

/**
 * Build unsigned mint tx (mint test tokens for agent).
 */
export async function buildMintTx(publicKey: string): Promise<BuildTxResult> {
  const [tokenAddr, tokenName] = splitContractId(TOKEN_CONTRACT)

  const tx = await makeUnsignedContractCall({
    contractAddress: tokenAddr,
    contractName: tokenName,
    functionName: 'mint',
    functionArgs: [],
    publicKey,
    network: NETWORK_NAME,
    fee: 0,
    sponsored: true,
    postConditionMode: PostConditionMode.Allow,
  })

  return {
    txHex: tx.serialize(),
    details: {
      contractId: TOKEN_CONTRACT,
      functionName: 'mint',
    },
  }
}

