# Fix Sponsored Transactions - Plano de Implementacao

## Problema
`openContractCall({ sponsored: true })` nao funciona na Xverse (nem na Leather antiga).
A wallet ignora o flag `sponsored` no RPC `stx_callContract` e faz check de balance STX normalmente.
User com 0 STX ve "not enough funds" e nao consegue assinar.

## Causa Raiz
- `@stacks/connect` v8 passa `sponsored: true` nos RPC params para a wallet
- Mas Xverse e Leather (versoes atuais) nao tratam esse parametro no handler de `stx_callContract`
- A wallet tenta construir uma tx normal, checa balance STX, e falha

## Solucao
Construir a transacao sponsored **nos mesmos** (client-side) e usar `openSignTransaction` (`stx_signTransaction`) para a wallet **apenas assinar** — sem checar balance, sem construir a tx.

```
User clica UP/DOWN
       |
       v
Client: makeUnsignedContractCall({ publicKey, sponsored: true, fee: 0 })
       |
       v
Client: openSignTransaction({ txHex })
       |
       v
Wallet abre popup "Sign Transaction" (fee = 0, sem check de STX)
User assina
       |
       v
onFinish: data.stacksTransaction.serialize() → txHex assinado
       |
       v
POST /api/sponsor { txHex }
       |
       v
Backend: sponsorTransaction() + broadcastTransaction()
       |
       v
Retorna { txid }
```

## Prerequisito: publicKey do user
`makeUnsignedContractCall` precisa da `publicKey` do user para construir a tx.
`getLocalStorage()` do `@stacks/connect` **strip a publicKey** (Omit<AddressEntry, 'publicKey'>).
Precisamos capturar e salvar durante a conexao.

---

## PASSO 1: Salvar publicKey na conexao — `components/ConnectWalletButton.tsx`

### 1.1 Modificar `doConnect()`

No path `connect()` (Leather/wallets que suportam `getAddresses`):
```typescript
async function doConnect(): Promise<void> {
  try {
    const res = await connect({ forceWalletSelect: true })
    // connect() retorna o resultado de getAddresses
    // Capturar publicKey se disponivel
    const stxEntry = (res as any)?.addresses?.find(
      (a: any) => a.address?.startsWith('SP') || a.address?.startsWith('ST')
    )
    if (stxEntry?.publicKey) {
      localStorage.setItem('stx_public_key', stxEntry.publicKey)
    }
    return
  } catch {
    // fallback para Xverse
  }

  const res = await request(
    { forceWalletSelect: true, enableLocalStorage: false },
    'stx_getAccounts',
    { network: 'testnet' }
  )
  const stx = res.accounts?.find(
    (a) => typeof a?.address === 'string' && (a.address.startsWith('SP') || a.address.startsWith('ST'))
  )
  if (!stx?.address) throw new Error('Nenhum endereco STX devolvido')

  // Salvar publicKey do stx_getAccounts
  if (stx.publicKey) {
    localStorage.setItem('stx_public_key', stx.publicKey)
  }

  const data = {
    addresses: { stx: [{ address: stx.address }], btc: [] as { address: string }[] },
    version: '1',
    updatedAt: Date.now(),
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }
}
```

### 1.2 Fallback: buscar publicKey sob demanda
Se `localStorage.getItem('stx_public_key')` estiver vazio (user conectou antes do fix), buscar via `request('stx_getAddresses')`. Isso pode abrir popup — aceitavel como fallback unico.

### 1.3 Limpar publicKey no disconnect
No `handleDisconnect()`:
```typescript
localStorage.removeItem('stx_public_key')
```

---

## PASSO 2: Criar `lib/sponsored-tx.ts`

Substitui o `lib/sponsor.ts` atual com funcionalidade completa.

```typescript
import { openSignTransaction } from '@stacks/connect'
import { makeUnsignedContractCall, ClarityValue } from '@stacks/transactions'

const PUBLIC_KEY_STORAGE = 'stx_public_key'

/** Retorna a publicKey salva do user ou null */
export function getSavedPublicKey(): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(PUBLIC_KEY_STORAGE)
}

/** Salva a publicKey no localStorage */
export function savePublicKey(publicKey: string): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(PUBLIC_KEY_STORAGE, publicKey)
  }
}

/** Remove a publicKey (disconnect) */
export function clearPublicKey(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(PUBLIC_KEY_STORAGE)
  }
}

/**
 * Constroi uma tx sponsored unsigned, pede a wallet para assinar,
 * e envia para /api/sponsor para sponsorar e broadcastar.
 * Retorna o txid.
 */
export async function sponsoredContractCall(params: {
  contractAddress: string
  contractName: string
  functionName: string
  functionArgs: ClarityValue[]
  publicKey: string
}): Promise<string> {
  // 1. Construir tx unsigned com sponsored=true e fee=0
  const unsignedTx = await makeUnsignedContractCall({
    contractAddress: params.contractAddress,
    contractName: params.contractName,
    functionName: params.functionName,
    functionArgs: params.functionArgs,
    publicKey: params.publicKey,
    network: 'testnet',
    fee: 0,
    sponsored: true,
    // nonce: omitido — auto-fetch da rede
  })

  const txHex = unsignedTx.serialize()

  // 2. Pedir a wallet para assinar via stx_signTransaction
  const signedHex = await new Promise<string>((resolve, reject) => {
    openSignTransaction({
      txHex,
      network: 'testnet',
      onFinish: (data) => {
        // data.stacksTransaction e o objeto desserializado
        // Serializar de volta para hex
        try {
          const hex = data.stacksTransaction.serialize()
          resolve(hex)
        } catch (e) {
          reject(new Error('Failed to serialize signed transaction'))
        }
      },
      onCancel: () => reject(new Error('Cancelled')),
    })
  })

  // 3. Enviar para /api/sponsor para sponsorar e broadcastar
  const res = await fetch('/api/sponsor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txHex: signedHex }),
  })

  const data = await res.json()

  if (!res.ok || data.error) {
    throw new Error(data.error || `Sponsor failed (${res.status})`)
  }

  return data.txid
}
```

### Notas
- `makeUnsignedContractCall` auto-busca o nonce da rede quando omitido
- `openSignTransaction` usa `stx_signTransaction` — a wallet apenas assina, sem checar STX balance
- `data.stacksTransaction` e um `StacksTransactionWire` — `.serialize()` retorna o hex assinado
- `/api/sponsor` (ja criado) recebe o hex, sponsora com deployer key, e broadcasta

---

## PASSO 3: Modificar `components/MarketCardV4.tsx`

### 3.1 Trocar imports
```typescript
// REMOVER:
import { submitSponsoredTx } from '@/lib/sponsor'

// ADICIONAR:
import { sponsoredContractCall, getSavedPublicKey } from '@/lib/sponsored-tx'
```

### 3.2 Helper para obter publicKey com fallback
```typescript
async function requirePublicKey(): Promise<string> {
  const saved = getSavedPublicKey()
  if (saved) return saved
  // Fallback: pedir para a wallet (pode abrir popup)
  const { request } = await import('@stacks/connect')
  const res = await request('stx_getAddresses', { network: 'testnet' })
  const entry = (res as any)?.addresses?.find(
    (a: any) => a.address?.startsWith('ST') || a.address?.startsWith('SP')
  )
  if (!entry?.publicKey) throw new Error('Could not get public key from wallet. Please reconnect.')
  savePublicKey(entry.publicKey)
  return entry.publicKey
}
```

### 3.3 Modificar `enableTrading()`
```typescript
// DE: openContractCall({ ...params, sponsored: true, onFinish: ... })
// PARA:
const publicKey = await requirePublicKey()
await sponsoredContractCall({
  contractAddress: tokenAddr,
  contractName: tokenName,
  functionName: 'approve',
  functionArgs: [
    contractPrincipalCV(bitpredixAddr, bitpredixName),
    uintCV(MAX_APPROVE_AMOUNT)
  ],
  publicKey,
})
const key = `bitpredix_trading_enabled_${stxAddress}_${BITPREDIX_CONTRACT}`
localStorage.setItem(key, 'true')
setTradingEnabled(true)
```

### 3.4 Modificar `mintTokens()`
```typescript
const publicKey = await requirePublicKey()
await sponsoredContractCall({
  contractAddress: tokenAddr,
  contractName: tokenName,
  functionName: 'mint',
  functionArgs: [],
  publicKey,
})
mintSubmittedRef.current = Date.now()
setCanMint(false)
window.dispatchEvent(new CustomEvent('bitpredix:balance-changed'))
```

### 3.5 Modificar `buy()`
```typescript
const publicKey = await requirePublicKey()
const txid = await sponsoredContractCall({
  contractAddress: bpAddr,
  contractName: bpName,
  functionName: 'place-bet',
  functionArgs: [
    uintCV(round.id),
    stringAsciiCV(side),
    uintCV(amountMicro)
  ],
  publicKey,
})
console.log('Bet sponsored & broadcast:', txid)
```

**Nota**: Post-conditions NAO se aplicam com `openSignTransaction` — a tx ja esta construida.
O `/api/sponsor` valida contrato + funcao, o que e suficiente como seguranca.

---

## PASSO 4: Modificar `components/ClaimButton.tsx`

### 4.1 Trocar imports
```typescript
// REMOVER:
import { submitSponsoredTx } from '@/lib/sponsor'

// ADICIONAR:
import { sponsoredContractCall, getSavedPublicKey } from '@/lib/sponsored-tx'
```

### 4.2 Modificar o claim loop
```typescript
for (const bet of round.bets) {
  if (bet.claimed) continue
  processed++
  setClaimProgress(`Enviando claim ${processed} de ${totalBets}...`)

  try {
    const publicKey = getSavedPublicKey()
    if (!publicKey) throw new Error('Public key not found. Please reconnect wallet.')

    const txId = await sponsoredContractCall({
      contractAddress: contractAddr,
      contractName: contractName,
      functionName: 'claim-round-side',
      functionArgs: [
        uintCV(round.roundId),
        stringAsciiCV(bet.side),
        uintCV(prices.priceStart),
        uintCV(prices.priceEnd)
      ],
      publicKey,
    })
    console.log(`[ClaimButton] Claim tx sponsored (round ${round.roundId} ${bet.side}):`, txId)

    // Espera tx entrar no mempool
    if (processed < totalBets) {
      setClaimProgress(`Aguardando tx ${txId.slice(0, 10)}... no mempool...`)
      const found = await waitForTxInMempool(txId)
      console.log(`[ClaimButton] Tx ${txId.slice(0, 10)} mempool: ${found ? 'found' : 'timeout'}`)
    }
  } catch (e) {
    console.error(`[ClaimButton] Failed to claim round ${round.roundId} ${bet.side}:`, e)
  }
}
```

---

## PASSO 5: Cleanup

### 5.1 Remover `lib/sponsor.ts` (antigo)
O `submitSponsoredTx()` agora esta incorporado dentro de `sponsoredContractCall()` em `lib/sponsored-tx.ts`.
Deletar `lib/sponsor.ts`.

### 5.2 `app/api/sponsor/route.ts` — sem mudanca
O backend continua igual: recebe hex assinado, sponsora, broadcasta. Funciona tanto com hex vindo de `openContractCall` quanto de `openSignTransaction`.

---

## PASSO 6: Testar

### 6.1 Cenarios
1. [ ] **Xverse, 0 STX** — Approve, Mint, Bet, Claim — tudo deve funcionar sem STX
2. [ ] **Leather, 0 STX** — Mesmo cenario
3. [ ] **User ja conectado (sem publicKey salva)** — Fallback `requirePublicKey()` deve pedir e salvar
4. [ ] **Disconnect e reconectar** — publicKey deve ser limpa e re-salva
5. [ ] **Claims sequenciais** — Nonce do sponsor nao colide (waitForTxInMempool)
6. [ ] **Tx para contrato invalido** — Backend rejeita (403)
7. [ ] **Cancel na wallet** — Frontend trata gracefully

### 6.2 Verificacoes tecnicas
- `makeUnsignedContractCall` com `sponsored: true` gera `authType: 5` (Sponsored)
- `openSignTransaction` NAO checa STX balance do user
- `data.stacksTransaction.serialize()` retorna hex assinado corretamente
- `/api/sponsor` aceita hex de `openSignTransaction` da mesma forma

---

## Resumo de mudancas

| # | Arquivo | Acao | Complexidade |
|---|---|---|---|
| 1 | `components/ConnectWalletButton.tsx` | Salvar publicKey durante conexao | Baixa |
| 2 | `lib/sponsored-tx.ts` | **Novo** — build unsigned tx + sign + sponsor | Media |
| 3 | `components/MarketCardV4.tsx` | Usar `sponsoredContractCall()` em 3 funcoes | Baixa |
| 4 | `components/ClaimButton.tsx` | Usar `sponsoredContractCall()` no claim | Baixa |
| 5 | `lib/sponsor.ts` | **Deletar** (substituido por sponsored-tx.ts) | — |
| 6 | `app/api/sponsor/route.ts` | Sem mudanca | — |

## Validacao ja feita (Node.js)
```
makeUnsignedContractCall({ publicKey, sponsored: true, fee: 0 }) → authType: 5 ✓
TransactionSigner.signOrigin(privKey) → assinatura OK ✓
sponsorTransaction({ transaction, sponsorPrivateKey }) → sponsorado OK ✓
Fluxo completo unsigned → sign → sponsor → serialize → OK ✓
Auto-fetch de nonce funciona ✓
```
