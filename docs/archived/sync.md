# Pool & Trade Tape Sync — Opcao C: Vercel KV + Polling

## Problema

O sistema de sync usa `globalThis` (memoria) para pool cache, trade buffer e SSE pub/sub. No Vercel, cada request pode cair em instancia serverless diferente — ~50% das vezes o broadcast SSE nao atinge ninguem.

## Solucao

Substituir todo estado em memoria por **Vercel KV** (Upstash Redis bundled) e trocar SSE por **polling a 1s**. Qualquer instancia le/escreve no mesmo Redis.

```
Device A (aposta)              Vercel (qualquer instancia)           Device B (observador)
────────────────               ───────────────────────────           ─────────────────────
1. buy() → tx broadcast
2. POST /api/pool-update ───→  KV HSET pool:{roundId} up/down
                               KV LPUSH trades:{roundId} trade
                               KV SET sponsor-nonce:{addr} nonce

                               GET /api/round (1s polling)
                               ← KV HGET pool:{roundId}
                               ← KV LRANGE trades:{roundId}
                               ← merge com on-chain (Math.max)
Device A ←──────────────────── { pool, recentTrades } ──────────→ Device B
```

---

## Estrutura de Keys no KV

| Key | Tipo | TTL | Conteudo |
|-----|------|-----|----------|
| `pool:{roundId}` | Hash | 5min | `{ up: number, down: number }` (micro-units, absolutos) |
| `trades:{roundId}` | List | 2min | `[{ side, amount, tradeId, ts }, ...]` max 30 entries |
| `open-price:{roundId}` | String | 5min | Price em micro-units (first-write-wins) |
| `sponsor-nonce` | String | 2min | `{ nonce: bigint, ts: number }` |

> TTLs generosos (5min) porque rounds duram 60s. KV limpa automaticamente.

---

## Plano de Implementacao

### PASSO 1: Configurar Vercel KV

1. Dashboard Vercel → Storage → Create KV Store
2. Conectar ao projeto (auto-gera `KV_REST_API_URL` e `KV_REST_API_TOKEN` em env vars)
3. Instalar SDK:

```bash
npm install @vercel/kv
```

---

### PASSO 2: Criar `lib/pool-store.ts` — Abstrai KV

Substitui `lib/pool-cache.ts`. Todas as funcoes sao async (Redis e I/O).

```typescript
import { kv } from '@vercel/kv'

// ── Pool (totais otimistas) ──

export async function addOptimisticBet(
  roundId: number,
  side: 'UP' | 'DOWN',
  amountMicro: number,
  tradeId: string
) {
  const key = `pool:${roundId}`
  const field = side === 'UP' ? 'up' : 'down'

  // HINCRBY e atomico — nao precisa de lock
  await kv.hincrby(key, field, amountMicro)
  await kv.expire(key, 300) // 5min TTL

  // Registra trade
  const trade = JSON.stringify({
    side,
    amount: amountMicro,
    tradeId,
    ts: Date.now()
  })
  await kv.lpush(`trades:${roundId}`, trade)
  await kv.ltrim(`trades:${roundId}`, 0, 29) // max 30
  await kv.expire(`trades:${roundId}`, 120)   // 2min TTL
}

export async function getOptimisticPool(roundId: number): Promise<{ up: number; down: number }> {
  const data = await kv.hgetall(`pool:${roundId}`)
  if (!data) return { up: 0, down: 0 }
  return {
    up: Number(data.up || 0),
    down: Number(data.down || 0)
  }
}

export async function getRecentTrades(roundId: number): Promise<Array<{
  side: string; amount: number; tradeId: string; ts: number
}>> {
  const raw = await kv.lrange(`trades:${roundId}`, 0, 29)
  if (!raw || raw.length === 0) return []

  const now = Date.now()
  return raw
    .map((item: any) => typeof item === 'string' ? JSON.parse(item) : item)
    .filter((t: any) => now - t.ts < 60_000) // ultimos 60s
}

// ── Open Price (first-write-wins) ──

export async function setOpenPrice(roundId: number, price: number): Promise<boolean> {
  // NX = only set if not exists (first-write-wins)
  const result = await kv.set(`open-price:${roundId}`, price, { nx: true, ex: 300 })
  return result === 'OK'
}

export async function getOpenPrice(roundId: number): Promise<number | null> {
  return kv.get(`open-price:${roundId}`)
}

// ── Sponsor Nonce ──

export async function getSponsorNonce(): Promise<{ nonce: bigint; ts: number } | null> {
  const data: any = await kv.get('sponsor-nonce')
  if (!data) return null
  if (Date.now() - data.ts > 120_000) return null // expired 2min
  return { nonce: BigInt(data.nonce), ts: data.ts }
}

export async function setSponsorNonce(nonce: bigint): Promise<void> {
  await kv.set('sponsor-nonce', { nonce: nonce.toString(), ts: Date.now() }, { ex: 120 })
}

export async function clearSponsorNonce(): Promise<void> {
  await kv.del('sponsor-nonce')
}
```

**Notas**:
- `HINCRBY` e atomico no Redis — duas instancias incrementando ao mesmo tempo nao perdem dados
- `LPUSH + LTRIM` mantem lista boundada automaticamente
- `SET NX` garante first-write-wins para open price
- Todas as funcoes tem TTL — nao precisa de cleanup manual

---

### PASSO 3: Atualizar `app/api/pool-update/route.ts`

Trocar chamadas ao `pool-cache.ts` e `pool-broadcast.ts` por `pool-store.ts`.

```typescript
// ANTES:
import { addOptimisticBet, getOptimisticPool } from '@/lib/pool-cache'
import { broadcastPoolUpdate } from '@/lib/pool-broadcast'

// DEPOIS:
import { addOptimisticBet } from '@/lib/pool-store'

export async function POST(req: Request) {
  const { roundId, side, amountMicro, tradeId } = await req.json()

  if (!roundId || !side || !amountMicro) {
    return Response.json({ error: 'missing fields' }, { status: 400 })
  }

  const finalTradeId = tradeId || `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

  await addOptimisticBet(roundId, side, amountMicro, finalTradeId)

  // NAO precisa broadcast — polling busca do KV automaticamente
  return Response.json({ ok: true, tradeId: finalTradeId })
}
```

> **Removido**: `broadcastPoolUpdate()` — nao ha mais SSE.

---

### PASSO 4: Atualizar `app/api/round/route.ts`

Trocar `pool-cache.ts` por `pool-store.ts`. Agora le do KV (compartilhado).

```typescript
// ANTES:
import { getOptimisticPool, getRecentTrades, getOpenPrice } from '@/lib/pool-cache'

// DEPOIS:
import { getOptimisticPool, getRecentTrades, getOpenPrice } from '@/lib/pool-store'

// MUDAR: todas as chamadas para await (eram sync, agora sao async)

// Exemplo no handler GET:
const optimistic = await getOptimisticPool(roundId)   // era sync
const recentTrades = await getRecentTrades(roundId)    // era sync
const serverPrice = await getOpenPrice(roundId)        // era sync

// Resto da logica de merge (Math.max) permanece igual
const totalUp = Math.max(onChainUp, optimistic.up)
const totalDown = Math.max(onChainDown, optimistic.down)
```

**Importante**: Adicionar `recentTrades` ao response se ainda nao estiver la (confirmar — ja esta no response atual).

---

### PASSO 5: Atualizar `app/api/sponsor/route.ts`

Trocar nonce tracking de `globalThis` por KV.

```typescript
// ANTES:
const g = globalThis as any
g.__sponsorNonce = ...
g.__sponsorNonceTs = ...

// DEPOIS:
import { getSponsorNonce, setSponsorNonce, clearSponsorNonce } from '@/lib/pool-store'

// No handler:
const tracked = await getSponsorNonce()
if (tracked) {
  // usar tracked.nonce
}

// Apos broadcast sucesso:
await setSponsorNonce(usedNonce + 1n)

// Apos falha:
await clearSponsorNonce()
```

**NOTA sobre lock**: O `globalThis.__sponsorLock` (serialize broadcasts) tambem precisa de solucao cross-instance. Opcoes:
1. **Redis SETNX lock** com TTL curto (500ms) — evita broadcasts simultaneos
2. **Aceitar race condition** — nonce conflicts sao raros e o client retenta

**Recomendacao**: Usar Redis lock simples:
```typescript
async function acquireSponsorLock(timeout = 3000): Promise<boolean> {
  const acquired = await kv.set('sponsor-lock', '1', { nx: true, px: timeout })
  return acquired === 'OK'
}

async function releaseSponsorLock(): Promise<void> {
  await kv.del('sponsor-lock')
}
```

---

### PASSO 6: Atualizar Frontend — `components/MarketCardV4.tsx`

#### 6.1 Remover SSE completamente

Deletar todo o bloco do `useEffect` que abre `EventSource('/api/pool-stream')` (~linhas 351-457):
- Remove `EventSource` connection
- Remove `lastSSEMessageRef` health check
- Remove `reconnectSSERef`
- Remove heartbeat/reconnect logic
- Remove `clientIdRef` (nao precisa mais — sem SSE echo)

#### 6.2 Aumentar frequencia do polling

```typescript
// ANTES: polling a cada 3s (baseline), 2s (burst)
const POLL_INTERVAL = 3000
const BURST_INTERVAL = 2000

// DEPOIS: polling a cada 1s sempre (KV e rapido o suficiente)
const POLL_INTERVAL = 1000
```

> Vercel KV (Upstash Redis) tem latencia ~1-5ms por request. 1 req/s por client e desprezivel.

#### 6.3 Trade tape via polling

O polling de `/api/round` ja retorna `recentTrades`. Garantir que o merge usa `tradeId` para dedup:

```typescript
// No callback do polling:
if (data.recentTrades?.length) {
  for (const trade of data.recentTrades) {
    if (!shownTradeIdsRef.current.has(trade.tradeId)) {
      shownTradeIdsRef.current.add(trade.tradeId)
      pushTradeTape({ side: trade.side, amount: trade.amount / 1e6 })
    }
  }
}
```

#### 6.4 Open price via polling

Adicionar `openPrice` ao response de `/api/round` (se nao estiver la) e consumir no frontend:

```typescript
// No callback do polling:
if (data.openPrice && !openPriceRef.current) {
  openPriceRef.current = data.openPrice
  localStorage.setItem(`opv3_${roundId}`, String(data.openPrice))
}
```

#### 6.5 Manter updates otimistas locais

O update local imediato (quando o proprio user aposta) NAO muda — continua fazendo:
- `setPool()` otimista imediato
- `pushTradeTape()` imediato
- `POST /api/pool-update` para persistir no KV

---

### PASSO 7: Remover arquivos obsoletos

| Arquivo | Acao |
|---------|------|
| `lib/pool-broadcast.ts` | **DELETAR** — nao ha mais SSE pub/sub |
| `lib/pool-cache.ts` | **DELETAR** — substituido por `pool-store.ts` |
| `app/api/pool-stream/route.ts` | **DELETAR** — nao ha mais SSE endpoint |

---

### PASSO 8: Fallback para dev local (sem KV)

Para `next dev` funcionar sem Vercel KV configurado, adicionar fallback em `pool-store.ts`:

```typescript
let kvInstance: any = null

async function getKV() {
  if (kvInstance) return kvInstance

  // Se KV_REST_API_URL esta configurado, usar Vercel KV
  if (process.env.KV_REST_API_URL) {
    const { kv } = await import('@vercel/kv')
    kvInstance = kv
    return kv
  }

  // Fallback: in-memory (funciona local, mesmo problema em prod)
  // Usar as funcoes de pool-cache.ts como fallback
  console.warn('[pool-store] KV_REST_API_URL not set — using in-memory fallback')
  kvInstance = createInMemoryFallback()
  return kvInstance
}
```

Ou mais simples: rodar Upstash Redis local via Docker / usar `.env.local` apontando para um KV de dev.

---

## Checklist de Implementacao

- [ ] Configurar Vercel KV (dashboard Vercel → Storage → KV)
- [ ] `npm install @vercel/kv`
- [ ] Criar `lib/pool-store.ts` (HINCRBY, LPUSH, SET NX, sponsor nonce)
- [ ] Atualizar `app/api/pool-update/route.ts` → usar `pool-store.ts`, remover broadcast
- [ ] Atualizar `app/api/round/route.ts` → usar `pool-store.ts` (async), incluir openPrice e recentTrades no response
- [ ] Atualizar `app/api/sponsor/route.ts` → nonce tracking via KV + Redis lock
- [ ] Atualizar `components/MarketCardV4.tsx`:
  - [ ] Remover SSE (`EventSource`, refs, reconnect, heartbeat)
  - [ ] Polling a 1s
  - [ ] Trade tape via polling com dedup
  - [ ] Open price via polling
- [ ] Deletar `lib/pool-broadcast.ts`
- [ ] Deletar `lib/pool-cache.ts`
- [ ] Deletar `app/api/pool-stream/route.ts`
- [ ] Testar local com KV de dev
- [ ] Testar multi-device em producao com apostas rapidas
- [ ] Monitorar uso de KV no dashboard Vercel (free tier: 30k requests/dia)

---

## Riscos e Mitigacoes

| Risco | Mitigacao |
|-------|-----------|
| Latencia KV (~5ms) adiciona delay ao polling | 1s polling cycle absorve isso facilmente |
| Free tier KV (30k req/dia) | Com 1 req/s, 1 user = 86k/dia. Precisamos rate-limit ou tier pago se muitos users |
| Race condition no sponsor nonce | Redis lock com SETNX + TTL 3s |
| Dev local sem KV | Fallback in-memory ou KV de dev (Upstash free) |
| Polling a 1s = mais requests que SSE | Compensado por remover SSE long-lived connections (que custam mais no Vercel) |

## Estimativa de Requests KV

Por device por round (60s):
- 60x GET `/api/round` → 60x `HGET` + 60x `LRANGE` + 60x `GET` = **180 reads**
- 1x aposta media → 1x `HINCRBY` + 1x `LPUSH` + 1x `LTRIM` + 1x `EXPIRE` = **4 writes**
- Total: ~184 requests/device/round

Free tier 30k/dia = ~163 device-rounds/dia. Para MVP testnet e mais que suficiente.
