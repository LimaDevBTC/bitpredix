/**
 * Stacks transaction signing utilities.
 * Private key never leaves the agent's machine.
 */

import {
  deserializeTransaction,
  createStacksPrivateKey,
  pubKeyfromPrivKey,
  publicKeyToHex,
  TransactionSigner,
} from '@stacks/transactions'
import { getStxAddress } from '@stacks/wallet-sdk'

export function getPublicKey(privateKeyHex: string): string {
  const pk = createStacksPrivateKey(privateKeyHex)
  return publicKeyToHex(pubKeyfromPrivKey(pk))
}

export function getAddress(privateKeyHex: string, network: 'testnet' | 'mainnet' = 'testnet'): string {
  return getStxAddress({
    account: {
      stxPrivateKey: privateKeyHex,
      dataPrivateKey: '',
      appsKey: '',
      salt: '',
      index: 0,
    } as Parameters<typeof getStxAddress>[0]['account'],
    network,
  })
}

export function signTransaction(txHex: string, privateKeyHex: string): string {
  const tx = deserializeTransaction(txHex)
  const signer = new TransactionSigner(tx)
  signer.signOrigin(createStacksPrivateKey(privateKeyHex))
  return tx.serialize()
}
