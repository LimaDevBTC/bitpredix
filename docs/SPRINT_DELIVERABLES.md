# Entregáveis por Sprint — Bitpredix MVP

Escopo do MVP (6 sprints). Referência para acompanhamento (ex.: GitHub Projects).  
Ver `docs/GITHUB_PROJECTS.md` para configurar o quadro.

---

## Sprint 1 – Foundation

| Item | Status | Observações |
|------|--------|-------------|
| Setup do repositório | ✅ Feito | Repositório no GitHub |
| CI/CD e ambiente | ✅ Feito | GitHub Actions: lint + build (`.github/workflows/ci.yml`) |
| Design system (dark mode premium) | ✅ Feito | `docs/DESIGN_SYSTEM.md` + Tailwind, dark mode |
| Estrutura base do smart contract | ✅ Feito | `contracts/bitpredix.clar` + `contracts/README.md` |
| Frontend inicial (layout + rotas) | ✅ Feito | Next.js App Router, página principal |

---

## Sprint 2 – Smart Contracts

| Item | Status | Observações |
|------|--------|-------------|
| `create-round` | ⬜ Pendente | Lógica em memória em `lib/rounds.ts`; falta on-chain |
| `place-bet` | ⬜ Pendente | API POST `/api/round` existe; contrato Clarity pendente |
| `resolve-round` | ⬜ Pendente | `resolveRound` em memória; falta on-chain |
| `claim-winnings` | ⬜ Pendente | — |
| Integração com oráculo | ⬜ Pendente | Preço BTC: Binance/CoinGecko; oráculo on-chain pendente |
| 100% cobertura de testes | ⬜ Pendente | Sem testes automatizados |
| Wallet connection no frontend | ⬜ Pendente | — |

---

## Sprint 3 – Frontend Core

| Item | Status | Observações |
|------|--------|-------------|
| Gráfico BTC em tempo real (1 min) | ✅ Feito | `PriceChart` + Recharts |
| Interface de apostas (betting panel) | ✅ Feito | UP/DOWN, presets, input USD |
| Visualização de pools e odds | ✅ Feito | Preços UP/DOWN, AMM |
| APIs básicas | ✅ Feito | `/api/round`, `/api/rounds`, `/api/btc-price` |
| Schema do banco | ⬜ Pendente | Estado em memória + localStorage |

---

## Sprint 4 – Integração Blockchain

| Item | Status | Observações |
|------|--------|-------------|
| Apostas reais on-chain (testnet) | ⬜ Pendente | — |
| Resolução automática dos rounds | ⬜ Pendente | Resolução via API; automático on-chain pendente |
| Histórico pessoal de apostas | ✅ Parcial | localStorage; on-chain pendente |
| Claim de ganhos via wallet | ⬜ Pendente | — |

---

## Sprint 5 – Polish & Features

| Item | Status | Observações |
|------|--------|-------------|
| Leaderboard | ⬜ Pendente | — |
| Animações e micro-interações | ✅ Parcial | Pulsing dots, transições; pode expandir |
| Mobile 100% responsivo | ✅ Parcial | Tailwind responsivo; validar 100% |
| Performance (Lighthouse >90) | ⬜ Pendente | Não medido |
| Analytics e monitoring | ⬜ Pendente | — |

---

## Sprint 6 – Beta Launch

| Item | Status | Observações |
|------|--------|-------------|
| Deploy público (Vercel + DB) | ⬜ Pendente | — |
| Testes end-to-end | ⬜ Pendente | — |
| Documentação completa | ✅ Parcial | docs/ rico; falta runbook, API formal |
| Onboarding 50–100 beta testers | ⬜ Pendente | — |
| Apresentação final | ⬜ Pendente | — |

---

## Resumo de progresso

| Sprint | Itens totais | Feitos | Parciais | Pendentes |
|--------|--------------|--------|----------|-----------|
| 1 | 5 | 5 | 0 | 0 |
| 2 | 7 | 0 | 0 | 7 |
| 3 | 5 | 4 | 0 | 1 |
| 4 | 4 | 0 | 1 | 3 |
| 5 | 5 | 0 | 2 | 3 |
| 6 | 5 | 0 | 1 | 4 |

**Legenda:** ✅ Feito | ✅ Parcial | ⬜ Pendente

---

## Notas

- **Terminologia:** Produto usa “trade” / “trading”; contratos Clarity podem usar `place-bet` internamente.
- **Stack:** Stacks, USDCx, Clarity — `docs/TOKEN_ARCHITECTURE.md`, `docs/FUNDS_ARCHITECTURE.md`.
- **IDs de rodada:** `#YYYYMMDDHHMM` (ex.: `#202601231808`).
- **Versão:** Beta 0.0.1 (footer do site).
- **Next.js:** 16.x (Turbopack). React 19.
