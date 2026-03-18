/**
 * Stacks message signature verification helpers.
 *
 * Re-exports from @stacks/transactions with a Stacks-specific
 * structured message hash (matching @stacks/connect signMessage).
 */

import {
  publicKeyFromSignatureRsv as _publicKeyFromSignatureRsv,
  publicKeyToAddress as _publicKeyToAddress,
  AddressVersion,
} from '@stacks/transactions'
import crypto from 'crypto'

export { AddressVersion }

/**
 * Hash a message the same way Stacks wallets do for signMessage().
 * Format: SHA-256 of "\x17Stacks Signed Message:\n" + varint(len) + message
 *
 * This matches the Stacks structured message signing used by Xverse/Leather.
 */
export function hashMessage(message: string): string {
  const prefix = '\x17Stacks Signed Message:\n'
  const msgBytes = Buffer.from(message, 'utf8')
  const lenBytes = encodeVarint(msgBytes.length)
  const full = Buffer.concat([Buffer.from(prefix, 'utf8'), lenBytes, msgBytes])
  return crypto.createHash('sha256').update(full).digest('hex')
}

function encodeVarint(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n])
  if (n <= 0xffff) {
    const buf = Buffer.alloc(3)
    buf[0] = 0xfd
    buf.writeUInt16LE(n, 1)
    return buf
  }
  const buf = Buffer.alloc(5)
  buf[0] = 0xfe
  buf.writeUInt32LE(n, 1)
  return buf
}

/**
 * Recover public key from RSV-format signature and message hash.
 */
export function publicKeyFromSignatureRsv(messageHash: string, signature: string): string {
  return _publicKeyFromSignatureRsv(messageHash, signature)
}

/**
 * Derive a Stacks address from a public key.
 */
export function publicKeyToAddress(publicKey: string, version: AddressVersion): string {
  return _publicKeyToAddress(version, publicKey)
}
