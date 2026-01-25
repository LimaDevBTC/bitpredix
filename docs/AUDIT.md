# Auditoria do Projeto Bitpredix

**Data:** 23 de Janeiro de 2026  
**Escopo:** AMM, API, frontend, produção (Vercel), detalhes gerais

---

## 1. Resumo executivo

- **AMM:** Liquidez inicial reduzida (10k → 2k), curva mais responsiva; POST do trade passa a retornar `priceUp`, `priceDown`, `pool` e `serverNow`; UI aplica resposta do trade de forma otimista.
- **Produção:** Uso de `serverNow` + `serverTimeSkew` para countdown/gráfico; `endsAt` normalizado para 60s; modal de resolução apenas quando o countdown encerra.
- **Pendências:** Persistência de estado (DB/Redis) em serverless, testes automatizados do AMM, pequenos ajustes de UX/lint.

---

## 2. AMM (Automated Market Maker)

### 2.1 Modelo atual: LMSR

- **LMSR** (Logarithmic Market Scoring Rule): usado em prediction markets (Kalshi, Gnosis). O impacto de cada trade **depende explicitamente da liquidez**.
- **Estado do pool:** `qUp`, `qDown` (net shares vendidas), `volumeTraded` (USD acumulado no round).
- **Liquidez:** `b = B0 + volumeTraded`. Com mais volume, o **mesmo $10k move menos** o preço.
- **Preços:** `priceUp = exp(qUp/b) / (exp(qUp/b) + exp(qDown/b))`, `priceDown = 1 - priceUp`.
- **Compras:** Dado `amountUsd`, resolve-se (busca binária) `Δq` tal que o custo LMSR da compra = `amountUsd`; o usuário recebe `Δq` shares e `volumeTraded` aumenta.

### 2.2 Ajustes feitos

| Item | Antes | Depois |
|------|--------|--------|
| Modelo | Constant product (reserves, k fixo) | **LMSR** (b = B0 + volumeTraded) |
| Impacto vs liquidez | $10k impactava igual com 10k ou 100k de liquidez | Mesmo $10k impacta **menos** quanto maior `volumeTraded` |
| Resposta ao trade | Só via GET (poll) | POST retorna `priceUp`, `priceDown`, `pool`, `serverNow`; UI aplica na hora |

### 2.3 Limitações conhecidas

1. **Estado em memória:** Em Vercel (serverless), cada instância tem seu próprio `round`/pool. Um GET pode vir de instância que não executou o trade → já mitigado com atualização otimista a partir do POST.
2. **Sem venda:** Só há compra de UP/DOWN. Não existe “sell” ou liquidação antecipada.
3. **Sem fees:** O AMM não aplica spread/fee (planejado para versão futura).
4. **estimateShares:** O preview “You get ~X UP/DOWN” usa `amm.estimateShares` (LMSR). Pode divergir se o pool mudar entre o preview e o trade.

### 2.4 Sugestões futuras

- Liquidez configurável via env (ex. `AMM_INITIAL_LIQUIDITY`).
- Testes unitários para `buyShares`, `getPriceUp`/`getPriceDown` e casos extremos (valores muito altos/baixos).
- Opcional: LMSR ou outro modelo, se for necessário comportamento diferente da curva.

---

## 3. API

### 3.1 Endpoints

| Rota | Método | Função |
|------|--------|--------|
| `/api/round` | GET | Rodada atual, preços, `serverNow` |
| `/api/round` | POST | Comprar shares; retorna também `priceUp`, `priceDown`, `pool`, `serverNow` |
| `/api/round/[id]` | GET | Rodada por ID; `endsAt` normalizado |
| `/api/rounds` | GET | Lista de rodadas recentes |
| `/api/btc-price` | GET | Preço BTC (múltiplas fontes, cache 2 min) |

### 3.2 Ajustes e boas práticas

- **GET /api/round:** Sempre retorna `serverNow` para cálculo de skew no cliente.
- **POST /api/round:** Retorna estado pós-trade (`priceUp`, `priceDown`, `pool`) para atualização otimista.
- **endsAt:** Sempre `startAt + 60_000` nas respostas, mesmo que o round em memória tenha valor diferente.

### 3.3 Pendências

- Rate limiting nos endpoints.
- Validação mais rígida de `amountUsd` (máximo, casas decimais).
- Em produção com múltiplas instâncias, persistir rounds/trades em DB ou Redis para consistência total.

---

## 4. Frontend

### 4.1 Componentes principais

| Componente | Função |
|------------|--------|
| `MarketCard` | Mercado, UP/DOWN, input, mensagens, histórico de preços |
| `PriceChart` | Gráfico UP/DOWN; usa `serverTimeSkew` e duração fixa 60s |
| `Countdown` | Timer até `endsAt`; usa `serverTimeSkew`; limitado a 60s |
| `ResolutionModal` | Resultado da rodada |
| `BtcPrice` | Preço BTC; indica “stale” após falhas |

### 4.2 Estado e fluxo

- **Preços/pool:** Atualizados por GET (poll) e **otimisticamente** por POST (trade).
- **Resolução:** Modal só abre quando o **countdown** chega a 0 (evita “fechamento do nada” em serverless).
- **Gráfico:** Só aceita pontos com `timeSinceStart` em `[0, 60)`, usa `serverNow` quando disponível.

### 4.3 Detalhes a ajustar

- **Lint:** `@next/next/no-html-link-for-pages` em `page.tsx` (usar `Link` em vez de `<a href="/">`).
- **estimateShares:** Hoje local em `MarketCard`; garantir que usa sempre o `pool` mais recente (já ajudado pela atualização otimista do pool no trade).
- **Acessibilidade:** Revisar labels, roles e contraste em modais e botões.

---

## 5. Produção (Vercel)

### 5.1 Problemas comuns e mitigações

| Problema | Mitigação |
|----------|-----------|
| Countdown 1m50 / tempo errado | `serverNow` + `serverTimeSkew`; countdown limitado a 60s |
| Gráfico “linha no meio” | Grid horizontal desligado; duração fixa 60s; `timeSinceStart` validado |
| Preço “travado” após trade | POST retorna preços/pool; UI aplica na hora |
| Modal de resolução “do nada” | Só mostra quando o countdown encerra (fluxo explícito) |
| AMM 50/50 voltando sem trade | Rejeição de preços “em direção ao 50” + atualização otimista do trade |
| Preço BTC falhando | Múltiplas fontes, retries, cache 2 min, indicador “stale” |

### 5.2 Limitações de arquitetura

- Estado **em memória** por instância. Trades e rounds não são compartilhados entre funções.
- Para MVP, a atualização otimista + lógica de “não regredir” o preço melhoram muito a experiência, mas **persistência compartilhada** (DB/Redis) é o caminho para produção robusta.

---

## 6. Checklist de melhorias

### Alto impacto

- [ ] Persistir rounds e pools em DB ou Redis (serverless).
- [ ] Testes unitários para AMM (`lib/amm.ts`).
- [ ] Testes E2E para fluxo: abrir rodada → trade → resolução.

### Médio impacto

- [ ] Corrigir lint `no-html-link-for-pages` em `page.tsx`.
- [ ] Liquidez inicial configurável via env.
- [ ] Rate limiting nas APIs.
- [ ] Revisão de acessibilidade (ARIA, foco, contraste).

### Baixo impacto

- [ ] Atualizar `PROJECT_ANALYSIS.md` e `TOKEN_ARCHITECTURE.md` (ex.: liquidez 10k → 2k).
- [ ] Documentar formato exato do `pool` nas respostas da API.

---

## 7. Referências

- `lib/amm.ts` — Lógica do AMM.
- `lib/rounds.ts` — Gestão de rodadas.
- `docs/PROJECT_ANALYSIS.md` — Análise geral do projeto.
- `docs/FUNDS_ARCHITECTURE.md` — Arquitetura de fundos (futuro on-chain).
