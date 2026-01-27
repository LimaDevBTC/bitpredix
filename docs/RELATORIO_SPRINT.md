# Relatório de Desenvolvimento — Bitpredix MVP

**Data:** 23 de Janeiro de 2026  
**Versão:** Beta 0.0.1  
**Status:** Em desenvolvimento ativo

---

## Sprint 1 — Foundation

**Período:** 20/01/2026 a 23/01/2026  
**Objetivo:** Entregar base do MVP + deploy inicial

### Entregas

- ✅ **Setup do repositório** — Repositório configurado no GitHub com estrutura completa do projeto
- ✅ **CI/CD e ambiente** — GitHub Actions configurado (`.github/workflows/ci.yml`) com lint e build automatizados
- ✅ **Design system (dark mode premium)** — Sistema de design documentado (`docs/DESIGN_SYSTEM.md`) com Tailwind CSS, dark mode, tipografia (Outfit + JetBrains Mono via `next/font/google`)
- ✅ **Estrutura base do smart contract** — Contratos Clarity criados (`contracts/bitpredix.clar`) com funções base: `create-round`, `place-bet`, `resolve-round`, `claim-winnings`
- ✅ **Frontend inicial (layout + rotas)** — Next.js 16 (App Router, Turbopack), React 19, página principal com MarketCard, rotas de API configuradas

### Detalhes Técnicos

**Stack:**
- Next.js 16.1.4 (Turbopack)
- React 19.0.0
- TypeScript 5.6.3
- Tailwind CSS 3.4.15
- ESLint 9.0.0 (flat config)

**Arquitetura:**
- App Router (Next.js 16)
- API Routes: `/api/round`, `/api/rounds`, `/api/btc-price`, `/api/round/[id]`
- Estado em memória (MVP) — preparado para migração on-chain
- localStorage para posições do usuário (MVP)

---

## Melhorias e Ajustes Adicionais

### AMM (Automated Market Maker)

**Implementação:** LMSR (Logarithmic Market Scoring Rule)

- **Modelo:** Substituição do constant product por LMSR, usado em prediction markets (Kalshi, Gnosis)
- **Liquidez dinâmica:** `b = B0 + volumeTraded` — o impacto de cada trade depende do volume acumulado no round
- **Estado do pool:** `qUp`, `qDown`, `volumeTraded` (substitui reserves + k)
- **Benefício:** Com mais volume, o mesmo $10k move menos o preço, evitando que trades grandes "invertam" o gráfico

### Layout e UX

**Desktop:**
- Container ampliado: `max-w-6xl` (lg) / `max-w-7xl` (xl)
- Layout 2 colunas em `lg+`: gráfico | UP/DOWN + amount
- Botões UP/DOWN reduzidos (padding, font sizes)
- "How it works" sempre abaixo do card (não ao lado)

**Mobile:**
- Layout mantido (coluna única, responsivo)
- Sem alterações no comportamento mobile

**Input de valor:**
- Removido spinner nativo do `input[type="number"]`
- Apenas sugestões ($5, $10, $50, $100, MAX) + digitação direta

### Correções Críticas de Produção

**Preço BTC:**
- Múltiplas fontes (Binance, CoinGecko, Blockchain.info, CryptoCompare) com retries
- Cache in-memory (2 min) como fallback
- Indicador "stale" após falhas consecutivas

**Countdown e gráfico:**
- Uso de `serverNow` + `serverTimeSkew` para eliminar diferença cliente/servidor
- Countdown limitado a 60s (evita 1m50)
- Gráfico com duração fixa 60s, grid horizontal removido

**Open fixo:**
- `fixedOpenRef` preserva `priceAtStart`, `startAt`, `endsAt` da primeira vez que a rodada é vista
- Evita que "Open" mude durante o round (bug crítico corrigido)

**AMM 50/50:**
- Lógica para rejeitar preços que "voltam" para 50/50 sem trades
- Atualização otimista após trade (POST retorna `priceUp`, `priceDown`, `pool`, `serverNow`)

**Modal de resolução:**
- Só aparece quando o countdown encerra (evita "fechamento do nada" em serverless)

---

## Status Geral do Projeto

### Sprint 1 — ✅ Completo

| Item | Status |
|------|--------|
| Setup do repositório | ✅ |
| CI/CD e ambiente | ✅ |
| Design system | ✅ |
| Estrutura base do smart contract | ✅ |
| Frontend inicial | ✅ |

### Sprint 2 — ⬜ Pendente

- Smart contracts on-chain (Stacks/Clarity)
- Wallet connection
- Testes automatizados

### Sprint 3 — ✅ Parcial (4/5)

- ✅ Gráfico BTC em tempo real
- ✅ Interface de apostas
- ✅ Visualização de pools e odds
- ✅ APIs básicas
- ⬜ Schema do banco (estado em memória no MVP)

### Sprints 4–6 — ⬜ Pendentes

- Integração blockchain completa
- Polish & features
- Beta launch

---

## Métricas e Qualidade

**Código:**
- TypeScript em todo o projeto
- ESLint configurado (zero warnings)
- Build passa sem erros

**Documentação:**
- `docs/SPRINT_DELIVERABLES.md` — escopo por sprint
- `docs/AUDIT.md` — auditoria técnica completa
- `docs/DITHUB_PROJECTS.md` — guia de acompanhamento
- `docs/TOKEN_ARCHITECTURE.md` — arquitetura de tokens
- `docs/FUNDS_ARCHITECTURE.md` — arquitetura de fundos
- `docs/DESIGN_SYSTEM.md` — sistema de design

**Deploy:**
- Vercel (produção): https://bitpredix.vercel.app/
- GitHub Actions (CI/CD)
- Repositório: GitHub

---

## Próximos Passos

1. **Persistência:** DB/Redis para estado compartilhado em serverless
2. **Smart contracts:** Migração de lógica em memória para Stacks on-chain
3. **Autenticação:** Wallet connection (Stacks, Leather)
4. **Testes:** Unitários (AMM) e E2E (fluxo completo)
5. **Performance:** Lighthouse, otimizações

---

## Conclusão

O **Sprint 1** foi concluído com sucesso, entregando a base sólida do MVP. O projeto está funcional em produção, com melhorias significativas no AMM (LMSR), layout desktop, e correções críticas de estabilidade. O código está bem documentado e pronto para evoluir para integração blockchain nas próximas sprints.

---

**Desenvolvido por:** Equipe Bitpredix  
**Versão:** 0.0.1 (Beta)  
**Data do relatório:** 23/01/2026
