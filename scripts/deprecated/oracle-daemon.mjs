#!/usr/bin/env node
/**
 * Daemon do oráculo: corre runOneTick (set-price → resolve → create-round) em ciclo,
 * a cada minuto, para haver sempre rounds no bitpredix.
 *
 * Manter este processo a correr (num terminal ou em background) para os rounds
 * aparecerem "automaticamente" na app.
 *
 * Uso:
 *   ORACLE_PRIVATE_KEY=0x... npm run oracle-daemon
 *   # Ou ORACLE_MNEMONIC (12/24 palavras) — deriva a chave; útil se a carteira não exporta private key.
 *   ORACLE_MNEMONIC="word1 word2 ... word12" npm run oracle-daemon
 *   (Aspas obrigatórias: sem elas o shell interpreta as palavras como comandos.)
 *
 * CONTRACT_IDs: .env.local (NEXT_PUBLIC_ORACLE_CONTRACT_ID, NEXT_PUBLIC_BITPREDIX_CONTRACT_ID).
 */

import { runOneTick } from './cron-oracle.mjs'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function msUntilNextTick() {
  const now = Date.now()
  const currentMinuteStart = Math.floor(now / 60_000) * 60_000
  const nextMinuteStart = currentMinuteStart + 60_000
  const runAt = nextMinuteStart + 5_000 // :05 do próximo minuto
  return Math.max(2_000, runAt - now)
}

async function loop() {
  console.log('[oracle-daemon] Iniciado. O primeiro round pode levar até ~6 min (set-price + 60 s + resolve + create-round + confirmação).')
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await runOneTick()
    } catch (e) {
      console.error('[oracle-daemon] Erro no tick:', e.message || e)
      // não sair: esperar 60s e tentar de novo
      await sleep(60_000)
      continue
    }
    const wait = msUntilNextTick()
    console.log('[oracle-daemon] Próximo tick em', Math.round(wait / 1000), 's')
    await sleep(wait)
  }
}

loop().catch((e) => {
  console.error(e)
  process.exit(1)
})
