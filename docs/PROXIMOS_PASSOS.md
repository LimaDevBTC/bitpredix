# Próximos passos — Bitpredix

Documento de organização para as fases seguintes. Detalhes em `docs/PLANO_TESTNET_STACKS.md` e `docs/PRE_DEPLOY_TESTNET.md`.

---

## 1. Estado actual (o que está feito)

### Frontend (app Next.js)
- Página principal: gráfico TradingView (BTC), MarketCard (UP/DOWN, amount, countdown), velocímetro de análises (TradingView), How it works
- APIs: `/api/round`, `/api/rounds`, `/api/btc-price` — estado em memória (simulado)
- Design: dark mode, design system, layout responsivo

### Contratos Clarity
| Contrato     | Ficheiro              | Estado                          |
|-------------|------------------------|----------------------------------|
| **oracle**  | `contracts/oracle.clar`| ✅ `set-price`, `get-price`, sem overwrite; **`ORACLE`** = principal do deployer (dev) |
| **bitpredix** | `contracts/bitpredix.clar` | ✅ Constantes, maps (rounds, positions), **create-round**, **place-bet**, **resolve-round**, **claim-winnings** |
| **test-usdcx** | `contracts/test-usdcx.clar` | ✅ SIP-010, `mint` 1 000 USD/uma vez, `approve`/`transfer-from` (from=contract-caller sem allowance), `get-minted` |

### Infra e config
- `Clarinet.toml` com `sip-010-trait` (local), `test-usdcx`, `oracle`, `bitpredix`
- `settings/Testnet.toml.example`, `.env.example`
- **`settings/Testnet.toml`** criado: carteira **dev** configurada (mnemonic em minúsculas; ficheiro em `.gitignore` — não commitar)
- Fee recipients: **DEV**, **PO** e **CONSULTANT** definidos

### Connect Wallet (primeiro passo frontend on-chain)
- **Connect Wallet** no header via `@stacks/connect` (testnet): `ConnectWalletButton` + `ConnectWalletButtonWrapper` (client-only, `ssr: false`)
- Conectado: endereço truncado + Disconnect; não conectado: "Connect wallet". É o pré-requisito para mint, place-bet, claim.

---

## 2. Pendências

- *(Nenhuma pendência de dados em aberto. FEE_RECIPIENT_DEV, _CONSULTANT e _PO estão definidos.)*
- **Carteira e STX testnet:** mnemonic da carteira **dev** em `settings/Testnet.toml` (em `.gitignore`). **STX em testnet** obtido via faucet; dev testnet `ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK`. ORACLE e SELF já definidos em `oracle.clar` e `bitpredix.clar`. Falta `ORACLE_MNEMONIC` no backend. Ver **`PRE_DEPLOY_TESTNET.md` § 1.2**.

---

## 3. Próximos passos (ordem sugerida)

### Bloco A — Contratos (desbloqueia deploy)

| # | Tarefa | Onde | Ref. |
|---|--------|------|------|
| A1 | ~~Implementar `test-usdcx.clar`~~ | ✅ Feito: SIP-010, mint 1 000 USD/uma vez, approve, transfer-from (from=contract-caller sem allowance), get-minted | `PLANO` § 3.2 |
| A2 | ~~Adicionar test-usdcx ao Clarinet.toml~~ | ✅ Feito: test-usdcx + requirements SIP-010; `sip-010-trait.clar` local para `clarinet check` | `PRE_DEPLOY` § 3 |
| A3 | ~~Completar `bitpredix.clar`~~ | ✅ Feito: constantes (ORACLE, SELF, FEE_BPS, MIN_BET, FEE_RECIPIENT_*), maps (`trading-closes-at`, `price-at-end`, `outcome`, `volume-traded`, `total-shares-up`/`-down`), **create-round** (idempotente), **place-bet** (transfer-from, LMSR 1:1, `get-block-info? time block-height`), **resolve-round** (get-price oracle, fees 10/10/80), **claim-winnings** | `PLANO` § 3.3, `DUVIDAS_ABERTAS` |
| A4 | ~~Substituir placeholder ORACLE em `oracle.clar`~~ | ✅ Feito: `ORACLE` = principal do deployer (carteira dev) | `PRE_DEPLOY` § 1 |

### Bloco B — Clarinet e deploy

| # | Tarefa | Onde | Ref. |
|---|--------|------|------|
| B1 | ~~Criar `settings/Testnet.toml`~~ | ✅ Feito: carteira **dev**, mnemonic em minúsculas; ficheiro em `.gitignore` | `PRE_DEPLOY` § 8 |
| B2 | ~~**STX em testnet**~~ | ✅ Feito: faucet Hiro; carteira dev testnet `ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK` com saldo | `PLANO` Fase 0 |
| B3 | ~~**`clarinet check`** e **`clarinet test`**~~ | ✅ Feito: `tests/test-usdcx.test.ts`, `oracle.test.ts`, `bitpredix.test.ts`; `npm test`; 8 testes com `it.skip` (exigem deployer=ORACLE em Simnet.toml) | `PRE_DEPLOY` § 8 |
| B4 | ~~**`clarinet deployments generate --testnet`** e **`apply`**~~ | ✅ Feito: plano gerado, **apply executado** (oracle, sip-010-trait, test-usdcx, bitpredix em testnet). `.env.local` com CONTRACT_IDs. | `PRE_DEPLOY` § 5, 8 |

### Bloco C — Frontend on-chain (Xverse + contratos)

| # | Tarefa | Onde | Ref. |
|---|--------|------|------|
| C1 | ~~Stacks Connect + Xverse~~ | ✅ Feito: "Connect wallet" no header (`ConnectWalletButton` + wrapper client-only); testnet; pré-requisito para C2–C4 | `PLANO` Fase 3 |
| C2 | ~~**Mint test tokens**~~ | ✅ Feito: «mint test usdc», get-minted+mint(), npm run mint-test | `PLANO` Fase 4 |
| C3 | **place-bet no app** | `approve(bitpredix, amount)` + `place-bet(round-id, side, amount)`; contract IDs em `.env.local` | `PLANO` Fase 4 |
| C4 | **Claim winnings** | `claim-winnings(round-id)` após resolve; modal/feedback | `PLANO` Fase 6 |

### Bloco D — Backend / cron (oráculo)

| # | Tarefa | Onde | Ref. |
|---|--------|------|------|
| D1 | **Cron a cada :00** | (1) Preço Bitstamp (testnet) → `oracle.set-price(round-id, price)`; (2) `bitpredix.resolve-round(round-id)`; (3) `create-round(round-id novo, price-at-start)` | `PLANO` Fase 5, `DUVIDAS_ABERTAS` 5.3 |
| D2 | **Config ORACLE** | Chave/mnemonic do ORACLE em variáveis de ambiente (backend); em testnet = deployer | `PRE_DEPLOY` § 7 |

---

## 4. Dependências entre blocos

```
A1 (test-usdcx) ────────────────────────► A3 (bitpredix.clar; FEE_RECIPIENT_* já definidos)
A2 (Clarinet)     A4 (oracle ORACLE)
       │                  │
       └──────┬───────────┘
              ▼
         B1, B2, B3, B4 (deploy)
              │
              ▼
         C1–C4 (frontend)  e  D1, D2 (cron)
```

- **A** pode avançar em paralelo (A1, A3, A4); A2 depois de A1.
- **B** depende de A (todos os FEE_RECIPIENT_* estão definidos).
- **C** e **D** dependem de B (contratos deployados).

---

## 5. Plano de execução (roadmap)

Ordem sugerida para chegar a **mint → place-bet → resolve → claim** em testnet.

| Fase | O quê | Tarefas | Depende de |
|------|-------|---------|------------|
| **1. Contratos** | test-usdcx, bitpredix completo, Clarinet | A1, A2, A3 | — |
| **2. Deploy** | STX faucet, check/test, generate/apply | B2, B3, B4 | Fase 1 |
| **3. Frontend on-chain** | Mint, place-bet, claim no app | C2, C3, C4 | Fase 2 (contract IDs) |
| **4. Backend (oráculo)** | Cron :00, set-price → resolve → create-round | D1, D2 | Fase 2 |

### Dentro da Fase 1 (contratos)

- **A1 (test-usdcx)** e **A3 (bitpredix)** podem avançar em **paralelo**.
- **A2 (Clarinet.toml):** só depois de A1 (adicionar test-usdcx + requirements SIP-010).

### Ordem de trabalho sugerida

1. **A1** — Implementar `contracts/test-usdcx.clar` (SIP-010, `mint` 1 000 USD uma vez, `approve`/`transfer-from`, `get-minted`). Refs: `PLANO` § 3.2, `DUVIDAS_ABERTAS` § 4, `PRE_DEPLOY` § 4.1.
2. **A2** — Descomentar `[contracts.test-usdcx]` no `Clarinet.toml` e `requirements` SIP-010.
3. **A3** — Completar `contracts/bitpredix.clar`: constantes (TOKEN=` .test-usdcx`, ORACLE, SELF=`'{deployer}.bitpredix'`, FEE_BPS, MIN_BET, FEE_RECIPIENT_*), maps (`trading-closes-at`, `price-at-end`, `outcome`, `volume-traded` em `rounds`), lógica de `create-round`, `place-bet` (transfer-from, LMSR simplificado), `resolve-round` (get-price do oracle, fees 10/10/80), `claim-winnings`. Refs: `PLANO` § 3.3, `DUVIDAS_ABERTAS`, `FUNDS_ARCHITECTURE`.
4. **B2** — ~~STX testnet na carteira dev via [Hiro faucet](https://explorer.hiro.so/sandbox/faucet?chain=testnet) (ou API).~~ ✅ Feito: dev testnet `ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK` com saldo.
5. **B3** — `clarinet check`, `clarinet test`; corrigir erros; testes para test-usdcx, oracle, bitpredix.
6. **B4** — `clarinet deployments generate --testnet --medium-cost`, rever plano, `clarinet deployments apply --testnet`. Anotar `CONTRACT_ID` de test-usdcx, oracle, bitpredix.
7. **C2** — Botão “Mint test tokens” (`test-usdcx.mint`), “Já usou”/“Receber 1 000 USD” via `get-minted`. Contract ID em `.env.local`.
8. **C3** — `approve(bitpredix, amount)` + `place-bet(round-id, side, amount)` no MarketCard; contract IDs em `.env.local`.
9. **D1, D2** — Cron :00 (Bitstamp → `set-price` → `resolve-round` → `create-round`); `ORACLE_MNEMONIC` no backend. Pode começar assim que B4 estiver feito (em paralelo com C2/C3).
10. **C4** — `claim-winnings(round-id)` após resolve; modal/feedback.

### Valores para A3 (bitpredix.clar)

- **ORACLE** = `'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK'` (deployer dev em testnet; confirmado).
- **SELF** = `'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.bitpredix'`.
- **TOKEN** = `.test-usdcx` (no mesmo deployment) ou principal após deploy.
- **FEE_RECIPIENT_DEV** = `'SP22EZVX13VM85AK6D3TRMZCZDT9K5441PMKSDJ6J'`; **FEE_RECIPIENT_PO** = `'SP21SQ28WQRQ10TBK72261QXQAEC67K5Y1YMMYFZV'`; **FEE_RECIPIENT_CONSULTANT** = `'SP2J0T54Z1SZJWAKY0QJ624CQRHB88CYC469RBF4A'`.
- **FEE_BPS** = 300; **MIN_BET** = 1_000_000 (1 USD, 6 decimais).

---

## 6. Onde começar

### Próxima acção imediata

**C3 — place-bet on-chain** e **D1+D2 — Cron oráculo**. Ver **`docs/CRONOGRAMA_ONCHAIN.md`** para o plano detalhado: wallet gate, `/api/round` a ler do contrato, `approve`+`place-bet` com test USDC, e cron para create-round/resolve-round.

### Passo 0 — Instalar Clarinet (obrigatório para contratos e deploy)

**Clarity** é a linguagem dos smart contracts na Stacks; **Clarinet** é a CLI para desenvolver, testar e fazer deploy. Não se “instala Clarity” à parte — o Clarinet já inclui o runtime.

**Linux (binário pré‑compilado):**
```bash
# Exemplo: v3.7.0, glibc (Debian/Ubuntu etc.)
wget -q https://github.com/hirosystems/clarinet/releases/download/v3.7.0/clarinet-linux-x64-glibc.tar.gz -O /tmp/clarinet.tar.gz
tar -xf /tmp/clarinet.tar.gz -C /tmp
chmod +x /tmp/clarinet
sudo mv /tmp/clarinet /usr/local/bin/
clarinet --version
```

**Alternativas:** [Clarity Book – Installing Clarinet](https://book.clarity-lang.org/ch01-01-installing-tools.html) (macOS/Homebrew, Windows, Cargo).

Depois: `clarinet check` na raiz do projeto para validar os `.clar`. Para `check` e `test` locais, o Clarinet usa `settings/Simnet.toml` (e opcionalmente `settings/Devnet.toml`); ambos foram criados com mnemonic de teste. `settings/Testnet.toml` é só para deploy em testnet (copiar de `Testnet.toml.example` e preencher o teu mnemonic; está em `.gitignore`).

---

### Passos seguintes

Ver **§ 5. Plano de execução** para a sequência completa. Em resumo: **A1** → A2 → **A3** (A1 e A3 em paralelo se preferires); depois B2–B4 (deploy); C2–C4 (mint, place-bet, claim) e D1–D2 (cron oráculo).

---

## 7. Referências rápidas

| Doc | Conteúdo |
|-----|----------|
| `docs/DEPLOY_B4_TESTNET.md` | **B4:** apply testnet, CONTRACT_IDs, custos |
| `docs/PLANO_TESTNET_STACKS.md` | Arquitetura, fases 0–7, LMSR, Pyth, Xverse |
| `docs/PRE_DEPLOY_TESTNET.md` | Checklist, constantes, ordem de deploy; **§ 1.2** = carteira, faucet, o que falta configurar |
| `docs/DUVIDAS_ABERTAS.md` | Decisões fechadas (round-id, MIN_BET, fees, cron, etc.) |
| `docs/FUNDS_ARCHITECTURE.md` | approve, transfer-from, escrow, fees 10/10/80 |
