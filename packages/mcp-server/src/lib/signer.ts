/**
 * Local transaction signing for agents
 *
 * Signs unsigned sponsored transactions with the agent's private key.
 * Private key never leaves the agent's machine.
 */

import {
  deserializeTransaction,
  createStacksPrivateKey,
  pubKeyfromPrivKey,
  publicKeyToString,
  TransactionSigner,
} from '@stacks/transactions'

/**
 * Derive compressed public key hex from a private key hex string.
 */
export function getPublicKey(privateKey: string): string {
  const pk = createStacksPrivateKey(privateKey)
  return publicKeyToString(pubKeyfromPrivKey(pk))
}

/**
 * Sign an unsigned sponsored transaction hex with the given private key.
 * Returns the signed transaction hex ready for /api/sponsor.
 */
export function signTransaction(unsignedTxHex: string, privateKey: string): string {
  const tx = deserializeTransaction(unsignedTxHex)
  const signer = new TransactionSigner(tx)
  signer.signOrigin(createStacksPrivateKey(privateKey))
  return tx.serialize()
}
