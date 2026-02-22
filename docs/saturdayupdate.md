# Saturday Update — 5 UX Improvements

## Context
5 frontend-only improvements for the Predix prediction market app. No smart contract changes needed.

---

## Item 1: Soma nos botoes de preset de valor
**Arquivo:** `components/MarketCardV4.tsx`
**Complexidade:** Trivial

### Problema
Botoes de preset ($1, $5, $10, $50, $100) substituem o valor do input. O user espera que cliques consecutivos somem.

### Mudancas

**Linha 664** — mudar onClick de set para soma:
```typescript
// DE:
onClick={() => setAmount(String(d))}
// PARA:
onClick={() => setAmount(String((parseFloat(amount) || 0) + d))}
```

**Linhas 666-667** — remover highlight "active" que compara `amount === String(d)` (nao faz sentido com soma). Pode trocar por highlight quando `parseFloat(amount) > 0`.

**Linha 678 (Max)** — manter comportamento atual (seta valor absoluto do balance).

### Verificacao
- Input vazio, clica $10 → mostra 10
- Input 10, clica $10 → mostra 20
- Input 20, clica $5 → mostra 25
- Max continua setando o balance total

---

## Item 2: Reduzir margem do chart em mobile
**Arquivo:** `components/BtcPriceChart.tsx`
**Complexidade:** Trivial

### Problema
Espaco sobrando entre o preco no eixo Y e a borda direita do card em mobile.

### Mudancas

**Linha 95** — `rightOffset` responsivo:
```typescript
// DE:
rightOffset: 40,
// PARA:
rightOffset: containerRef.current.clientWidth < 640 ? 15 : 40,
```

**Linha 100** — `scaleMargins` responsivo (opcional):
```typescript
// DE:
scaleMargins: { top: 0.15, bottom: 0.15 },
// PARA:
scaleMargins: {
  top: containerRef.current.clientWidth < 640 ? 0.10 : 0.15,
  bottom: containerRef.current.clientWidth < 640 ? 0.10 : 0.15,
},
```

### Verificacao
- Mobile (< 640px): preco mais proximo da borda direita
- Desktop: sem mudanca visual

---

## Item 3: Corrigir tabela de historico do usuario
**Arquivo:** `components/ProfilePage.tsx`
**Complexidade:** Media

### Problema
`BetRow` (linhas 199-291) usa flex com larguras fixas (`w-12`, `w-16`, `w-20`) que quebram em mobile:
- "DOWN ↓" em `w-12` quebra em 2 linhas
- "DOWN ✗" em `w-16` quebra em 2 linhas
- Larguras acumuladas excedem viewport em telas < 375px

### Mudancas

Criar layout mobile separado (mesmo padrao do `LeaderboardTable.tsx`):

**Mobile (`sm:hidden`)** — layout compacto em 2 linhas:
```tsx
<button onClick={onToggle} className="sm:hidden w-full px-3 py-2.5 text-left hover:bg-zinc-800/20 transition-colors">
  {/* Linha 1: Side + Amount + P&L */}
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-2">
      <span className={`text-xs font-medium ${bet.side === 'UP' ? 'text-up' : 'text-down'}`}>
        {bet.side} {bet.side === 'UP' ? '\u2191' : '\u2193'}
      </span>
      <span className="text-zinc-300 font-mono text-xs">${formatUsd(bet.amountUsd)}</span>
    </div>
    <span className={`text-xs font-mono font-medium ${
      !bet.resolved ? 'text-zinc-500' : bet.pnl >= 0 ? 'text-up' : 'text-down'
    }`}>
      {!bet.resolved ? '-' : `${bet.pnl >= 0 ? '+' : ''}$${formatUsd(Math.abs(bet.pnl))}`}
    </span>
  </div>
  {/* Linha 2: Time + Outcome */}
  <div className="flex items-center justify-between mt-1">
    <span className="text-[10px] text-zinc-500">{timeAgo(bet.timestamp)}</span>
    <span className={`text-[10px] ${
      !bet.resolved ? 'text-zinc-500' :
      bet.outcome === bet.side ? 'text-up' : 'text-down'
    }`}>
      {!bet.resolved ? 'pending' : `${bet.outcome === bet.side ? 'Won \u2713' : 'Lost \u2717'}`}
    </span>
  </div>
</button>
```

**Desktop (`hidden sm:flex`)** — manter layout atual, adicionar `whitespace-nowrap` nas colunas Side e Outcome:
```tsx
<button onClick={onToggle} className="hidden sm:flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-zinc-800/20 transition-colors">
  {/* ... layout atual mantido, com whitespace-nowrap nas colunas problematicas */}
</button>
```

### Verificacao
- Mobile: cada bet ocupa 2 linhas compactas, nada extrapola viewport
- Desktop: layout identico ao atual
- "DOWN ↓" nunca quebra em 2 linhas

---

## Item 4: Preview do efeito da aposta na pool
**Arquivo:** `components/MarketCardV4.tsx`
**Complexidade:** Media

### Problema
User nao sabe como sua aposta vai afetar a pool e as odds antes de confirmar.

### Mudancas

**4.1 — Calcular projecoes** (dentro do bloco da pool bar, linhas 690-706):
```typescript
const betAmount = parseFloat(amount) || 0
const total = (pool?.totalUp ?? 0) + (pool?.totalDown ?? 0)
const upPct = total > 0 ? ((pool?.totalUp ?? 0) / total) * 100 : 50

// Projecoes se apostar em UP
const projUpIfUp = (pool?.totalUp ?? 0) + betAmount
const projTotalIfUp = projUpIfUp + (pool?.totalDown ?? 0)
const projUpPctIfUp = projTotalIfUp > 0 ? (projUpIfUp / projTotalIfUp) * 100 : 50
const projMultiplierUp = projUpIfUp > 0 ? projTotalIfUp / projUpIfUp : 2

// Projecoes se apostar em DOWN
const projDownIfDown = (pool?.totalDown ?? 0) + betAmount
const projTotalIfDown = (pool?.totalUp ?? 0) + projDownIfDown
const projDownPctIfDown = projTotalIfDown > 0 ? (projDownIfDown / projTotalIfDown) * 100 : 50
const projMultiplierDown = projDownIfDown > 0 ? projTotalIfDown / projDownIfDown : 2
```

**4.2 — Pool bar preview** (abaixo da barra atual):
```tsx
{betAmount > 0 && (
  <div className="flex justify-between text-[10px] font-mono mt-0.5 text-zinc-600">
    <span className="text-up/50">{Math.round(projUpPctIfUp)}% if UP</span>
    <span className="text-down/50">{Math.round(projDownPctIfDown)}% if DOWN</span>
  </div>
)}
```

**4.3 — Multiplicador projetado nos botoes UP/DOWN** (linhas 714-717):
```tsx
{/* Dentro do botao UP */}
<span className="text-[11px] sm:text-xs font-mono opacity-90 leading-tight">
  {Math.round((pool?.priceUp ?? 0.5) * 100)}c {'\u00b7'} {currentMultiplierUp}x
  {betAmount > 0 && (
    <span className="opacity-60"> {'\u2192'} {projMultiplierUp.toFixed(1)}x</span>
  )}
</span>

{/* Dentro do botao DOWN — mesma logica com projMultiplierDown */}
```

### Verificacao
- Input vazio: sem projecao visivel (comportamento atual)
- Input com valor: botoes mostram multiplicador atual → projetado
- Pool bar mostra projecao de porcentagem para cada lado
- Valores atualizam em tempo real conforme o user digita

---

## Item 5: Dados globais na pagina de rounds
**Arquivos:** `lib/round-indexer.ts` + `app/api/round-history/route.ts` + `components/RoundExplorer.tsx`
**Complexidade:** Media

### Problema
A pagina de historico de rounds so mostra "X rounds indexed". Faltam metricas globais do app.

### Mudancas

**5.1 — Backend: `lib/round-indexer.ts`**

Adicionar interface e funcao `getGlobalStats()`:
```typescript
interface GlobalStats {
  totalVolume: number
  totalRounds: number
  resolvedRounds: number
  upWins: number
  downWins: number
  uniqueWallets: number
  largestPool: number
  avgPoolSize: number
}

export function getGlobalStats(): GlobalStats {
  let totalVolume = 0
  let totalRounds = 0
  let resolvedRounds = 0
  let upWins = 0
  let downWins = 0
  const uniqueWallets = new Set<string>()
  let largestPool = 0

  for (const round of roundsIndex.values()) {
    if (round.totalPoolUsd === 0) continue
    totalRounds++
    totalVolume += round.totalPoolUsd
    if (round.totalPoolUsd > largestPool) largestPool = round.totalPoolUsd
    if (round.resolved) {
      resolvedRounds++
      if (round.outcome === 'UP') upWins++
      else if (round.outcome === 'DOWN') downWins++
    }
    for (const bet of round.bets) {
      if (bet.status === 'success') uniqueWallets.add(bet.user)
    }
  }

  return {
    totalVolume,
    totalRounds,
    resolvedRounds,
    upWins,
    downWins,
    uniqueWallets: uniqueWallets.size,
    largestPool,
    avgPoolSize: totalRounds > 0 ? totalVolume / totalRounds : 0,
  }
}
```

**5.2 — API: `app/api/round-history/route.ts`**

Adicionar handler para `?stats=global` (antes da logica de paginacao):
```typescript
if (searchParams.get('stats') === 'global') {
  return NextResponse.json({ ...getGlobalStats(), ok: true })
}
```

**5.3 — Frontend: `components/RoundExplorer.tsx`**

Adicionar componente `StatCard` (inline, no mesmo arquivo):
```tsx
function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</div>
      <div className="text-sm font-mono text-zinc-200 mt-0.5">{value}</div>
    </div>
  )
}
```

Adicionar state e fetch:
```typescript
const [stats, setStats] = useState<GlobalStats | null>(null)

useEffect(() => {
  fetch('/api/round-history?stats=global')
    .then(r => r.json())
    .then(data => data.ok && setStats(data))
}, [])
```

Substituir a "Stats bar" (linhas 218-224) por grid de cards:
```tsx
{stats && (
  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
    <StatCard label="Total Volume" value={`$${formatCompact(stats.totalVolume)}`} />
    <StatCard label="Rounds Played" value={String(stats.totalRounds)} />
    <StatCard label="Unique Traders" value={String(stats.uniqueWallets)} />
    <StatCard label="UP Win Rate" value={`${stats.resolvedRounds > 0 ? ((stats.upWins / stats.resolvedRounds) * 100).toFixed(0) : 0}%`} />
  </div>
)}
```

Helper `formatCompact` (se nao existir):
```typescript
function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toFixed(0)
}
```

### Verificacao
- 4 stat cards no topo (2x2 mobile, 4 em linha desktop)
- Stats carregam independente dos rounds paginados
- Dados calculados de TODOS os rounds indexados

---

## Resumo

| # | Item | Arquivo(s) | Complexidade |
|---|------|-----------|-------------|
| 1 | Soma nos presets | `MarketCardV4.tsx` | Trivial |
| 2 | Margem chart mobile | `BtcPriceChart.tsx` | Trivial |
| 3 | Tabela historico responsiva | `ProfilePage.tsx` | Media |
| 4 | Preview pool | `MarketCardV4.tsx` | Media |
| 5 | Stats globais | `round-indexer.ts`, `route.ts`, `RoundExplorer.tsx` | Media |

## Ordem de implementacao
1 → 2 → 3 → 4 → 5

## Itens adiados (proxima sessao)
- Modelo de pool (conversa mais profunda)
- Sponsored transactions (Opcao A com `@stacks/transactions.sponsorTransaction`)
