# Contrato de Parceria — BITPredix

**Rio de Janeiro, 20/01/2026**

---

## Partes

| Papel | Nome | Participação nos lucros |
|-------|------|-------------------------|
| Desenvolvedor responsável Web3 | Edson Carlos Almeida Lima | 10% |
| Coordenador do projeto Web3 | Douglas Miranda | 10% |
| Investidor inicial do projeto Web3 | Gerson Lerner | 80% |

---

## Objeto

Parceria para desenvolver o projeto **BITPredix**, plataforma de previsão do preço do Bitcoin em intervalo de tempo de **1 minuto**.

---

## Modelo de investimento

- **USDT 1.000** por sprint (6 sprints)
- **Total:** USDT 6.000

### Liberação do pagamento

Pagamento liberado somente após:

- [ ] Entregáveis do sprint completos  
- [ ] Código no GitHub  
- [ ] Testes passando  
- [ ] Demo em vídeo  
- [ ] Sprint review validada  

---

## Escopo do MVP (6 semanas)

### Sprint 1 – Foundation

| Item | Status | Observações |
|------|--------|-------------|
| Setup do repositório | ✅ Feito | GitHub: LimaDevBTC/bitpredix |
| CI/CD e ambiente | ✅ Feito | GitHub Actions: lint + build (`.github/workflows/ci.yml`) |
| Design system (dark mode premium) | ✅ Feito | `docs/DESIGN_SYSTEM.md` + Tailwind, dark mode |
| Estrutura base do smart contract | ✅ Feito | `contracts/bitpredix.clar` + `contracts/README.md` |
| Frontend inicial (layout + rotas) | ✅ Feito | Next.js App Router, página principal |

**GitHub Projects:** Ver `docs/GITHUB_PROJECTS.md` para acompanhar o desenvolvimento sem código.

### Sprint 2 – Smart Contracts

| Item | Status | Observações |
|------|--------|-------------|
| `create-round` | ⬜ Pendente | Lógica em memória em `lib/rounds.ts`; falta on-chain |
| `place-bet` | ⬜ Pendente | API POST `/api/round` existe; contrato Clarity pendente |
| `resolve-round` | ⬜ Pendente | `resolveRound` em memória; falta on-chain |
| `claim-winnings` | ⬜ Pendente | — |
| Integração com oráculo | ⬜ Pendente | Preço BTC: Binance/CoinGecko; oráculo on-chain pendente |
| 100% cobertura de testes | ⬜ Pendente | Sem testes automatizados |
| Wallet connection no frontend | ⬜ Pendente | — |

### Sprint 3 – Frontend Core

| Item | Status | Observações |
|------|--------|-------------|
| Gráfico BTC em tempo real (1 min) | ✅ Feito | `PriceChart` + Recharts |
| Interface de apostas (betting panel) | ✅ Feito | UP/DOWN, presets, input USD |
| Visualização de pools e odds | ✅ Feito | Preços UP/DOWN, AMM |
| APIs básicas | ✅ Feito | `/api/round`, `/api/rounds`, `/api/btc-price` |
| Schema do banco | ⬜ Pendente | Estado em memória + localStorage |

### Sprint 4 – Integração Blockchain

| Item | Status | Observações |
|------|--------|-------------|
| Apostas reais on-chain (testnet) | ⬜ Pendente | — |
| Resolução automática dos rounds | ⬜ Pendente | Resolução via API; automático on-chain pendente |
| Histórico pessoal de apostas | ✅ Parcial | localStorage; on-chain pendente |
| Claim de ganhos via wallet | ⬜ Pendente | — |

### Sprint 5 – Polish & Features

| Item | Status | Observações |
|------|--------|-------------|
| Leaderboard | ⬜ Pendente | — |
| Animações e micro-interações | ✅ Parcial | Pulsing dots, transições; pode expandir |
| Mobile 100% responsivo | ✅ Parcial | Tailwind responsivo; validar 100% |
| Performance (Lighthouse >90) | ⬜ Pendente | Não medido |
| Analytics e monitoring | ⬜ Pendente | — |

### Sprint 6 – Beta Launch

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

## Notas importantes

1. **Terminologia:** O produto usa “trade” / “trading” (prediction market). Os contratos mencionam “place-bet”; na implementação pode-se usar `place-trade` ou manter `place-bet` apenas no contrato, conforme definido em conjunto.

2. **Stack alvo:** Stacks, USDCx, Clarity — conforme `docs/TOKEN_ARCHITECTURE.md` e `docs/FUNDS_ARCHITECTURE.md`.

3. **IDs de rodada:** Formato `#YYYYMMDDHHMM` (ex.: `#202601231808`) para unicidade global.

4. **Versão atual:** Beta 0.0.1 (footer do site).

---

## Assinaturas

```
_____________________________
Edson Carlos Almeida Lima
Desenvolvedor responsável Web3

_____________________________
Douglas Miranda
Coordenador do projeto Web3

_____________________________
Gerson Lerner
Investidor inicial do projeto Web3
```
