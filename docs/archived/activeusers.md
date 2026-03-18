# Active Users Counter — Plano de Implementação

## Arquitetura

### Definição de "ativo"
User que fez poll `/api/round` nos últimos **15 segundos**. Como o client já faz poll a cada 1s, qualquer user com a página aberta mantém o heartbeat automaticamente. TTL de 15s dá margem para hiccups de rede.

### Redis: Sorted Set (ZSET)
```
Key:    active-users
Type:   ZSET
Member: <session ID anônimo, ex: "s_k7f2a9x3">
Score:  Unix timestamp em segundos
```

**Por que ZSET?**
- `ZCOUNT` retorna total de ativos em O(log N) — uma chamada
- `ZREMRANGEBYSCORE` limpa entries expirados eficientemente
- Não precisa de TTL individual por key — entries expiram naturalmente
- Se user fecha o browser sem "disconnect", a entry expira sozinha em 15s

### Operações por poll (pipelined, 1 round-trip Redis)
1. `ZADD active-users <timestamp> <sessionId>` — upsert heartbeat
2. `ZREMRANGEBYSCORE active-users -inf <timestamp - 15>` — prune stale
3. `ZCARD active-users` — count ativos (pós-prune)

**Custo**: ~1-3ms extra por poll (pipelined junto com os reads existentes).

### Onde exibir
**AppHeader** — pill/badge com dot verde pulsante e contagem: `● 12 online`
- Sempre visível, não polui o MarketCard
- Comunicação MarketCard → AppHeader via `CustomEvent` (padrão já usado no projeto)

### Privacidade
- Session ID é random, gerado por tab (`sessionStorage`)
- Nenhum wallet address, IP ou PII vai para o Redis
- Cada tab conta como 1 user ativo (razoável)

---

## Implementação Passo a Passo

### Passo 1: `lib/pool-store.ts` — Adicionar `heartbeatAndCount`

```typescript
export async function heartbeatAndCount(sessionId: string): Promise<number> {
  const kv = getRedis()
  if (!kv) return 1 // fallback: pelo menos o user atual
  const now = Math.floor(Date.now() / 1000)
  const pipe = kv.pipeline()
  pipe.zadd('active-users', { score: now, member: sessionId })
  pipe.zremrangebyscore('active-users', '-inf', now - 15)
  pipe.zcard('active-users')
  const results = await pipe.exec()
  const count = (results[2] as number) ?? 1
  return Math.max(count, 1)
}
```

### Passo 2: `app/api/round/route.ts` — Modificar GET handler

1. Mudar signature de `GET()` para `GET(request: NextRequest)`
2. Extrair `sid` do query param
3. Adicionar `heartbeatAndCount(sid)` no `Promise.all` (parallel)
4. Incluir `activeUsers` na resposta JSON

```typescript
export async function GET(request: NextRequest) {
  // ... existing code ...
  const sid = request.nextUrl.searchParams.get('sid')

  const [optimistic, recentTrades, serverOpenPrice, onChain, activeUsers] = await Promise.all([
    getOptimisticPool(roundId),
    getRecentTrades(roundId),
    getOpenPrice(roundId),
    getOnChainData(roundId),
    sid ? heartbeatAndCount(sid) : Promise.resolve(0),
  ])

  // ... na resposta JSON:
  return noCacheJson({
    // ... existing fields ...
    activeUsers,
  })
}
```

### Passo 3: `components/MarketCardV4.tsx` — Session ID + dispatch event

**Gerar session ID no mount:**
```typescript
const sessionIdRef = useRef<string>('')
useEffect(() => {
  let sid = sessionStorage.getItem('predix_sid')
  if (!sid) {
    sid = 's_' + Math.random().toString(36).slice(2, 10)
    sessionStorage.setItem('predix_sid', sid)
  }
  sessionIdRef.current = sid
}, [])
```

**No fetchPool, appendar sid ao URL:**
```typescript
const sid = sessionIdRef.current
const res = await fetch(`/api/round?_=${Date.now()}${sid ? `&sid=${sid}` : ''}`, { cache: 'no-store' })
```

**Dispatch do count via CustomEvent:**
```typescript
if (typeof data.activeUsers === 'number') {
  window.dispatchEvent(new CustomEvent('predix:active-users', { detail: data.activeUsers }))
}
```

### Passo 4: `components/AppHeader.tsx` — Exibir contagem

**State + listener:**
```typescript
const [activeUsers, setActiveUsers] = useState<number | null>(null)

useEffect(() => {
  const handler = (e: Event) => {
    setActiveUsers((e as CustomEvent).detail)
  }
  window.addEventListener('predix:active-users', handler)
  return () => window.removeEventListener('predix:active-users', handler)
}, [])
```

**Render na nav (entre logo e wallet controls):**
```tsx
{activeUsers !== null && activeUsers > 0 && (
  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-800/60 text-xs text-zinc-400">
    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
    <span>{activeUsers} online</span>
  </div>
)}
```

---

## Edge Cases

| Cenário | Comportamento |
|---|---|
| **Múltiplas tabs** | Cada tab = 1 session (sessionStorage é por tab). Contam separadamente. |
| **User fecha tab** | Entry expira em 15s automaticamente (ZSET score-based). |
| **Redis indisponível** | Retorna 1 (fallback). UI mostra "1 online". |
| **1000+ users** | ZADD/ZCOUNT são O(log N). Prune mantém set enxuto. Sem problemas. |
| **Bots/crawlers** | Não executam JS, não fazem poll, não contam. |
| **Clock skew entre instances** | Timestamp é server-side. 15s de margem absorve qualquer skew. |
| **"0 online" impossível** | `Math.max(count, 1)` + guard no UI. |

## Arquivos a Modificar

| Arquivo | Mudança |
|---|---|
| `lib/pool-store.ts` | Adicionar `heartbeatAndCount()` |
| `app/api/round/route.ts` | GET aceita `sid`, retorna `activeUsers` |
| `components/MarketCardV4.tsx` | Gerar session ID, enviar no poll, dispatch event |
| `components/AppHeader.tsx` | Listener + render badge |
