# B4 — Deploy em testnet

Deploy concluído: 4 contratos publicados em testnet; `.env.local` com CONTRACT_IDs.

---

## 1. O que está feito

- **`clarinet deployments generate --testnet`** — plano em `deployments/default.testnet-plan.yaml`
- **`clarinet deployments apply --testnet`** — 4 contratos publicados em testnet
- **Ordem aplicada:** oracle → sip-010-trait → test-usdcx → bitpredix
- **Deployer:** `ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK`
- **`.env.local`** — CONTRACT_IDs preenchidos

---

## 2. TxIDs do apply (referência)

| Contrato | TxID |
|----------|------|
| oracle | `b7b73201178832bc0be064f68ba8057bf6f085568da534ca5a47dbcd062a9e7e` |
| sip-010-trait | `affbc927346e7daf1568c6ec29ec0197590b5afa8340edf1f451cbb10a74669b` |
| test-usdcx | `327dbe156cd66f8baab88568491ad4bfde4aa77c4a56971eb093d411452e2a92` |
| bitpredix | `8755a842372402d7571e0c799756989a58d9186224798f9979fe0dde155d744f` |

Explorer testnet: `https://explorer.hiro.so/txid/<TxID>?chain=testnet`

---

## 3. Como repetir o apply

```bash
printf 'Y\n' | clarinet deployments apply --testnet -d --no-dashboard
```

(`-d` = usar plano em disco; `--no-dashboard` = logs em vez de UI)

---

## 4. CONTRACT_IDs (em `.env.local`)

Com o deployer `ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK`:

| Variável | Valor |
|----------|-------|
| `NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID` | `ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.test-usdcx` |
| `NEXT_PUBLIC_ORACLE_CONTRACT_ID` | `ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.oracle` |
| `NEXT_PUBLIC_BITPREDIX_CONTRACT_ID` | `ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.bitpredix` |

Já preenchidos em `.env.local`. O `sip-010-trait` não é usado pela app.

---

## 5. Custos (estimativas no plano)

| Contrato | cost (uSTX) |
|----------|-------------|
| sip-010-trait | 1 199 107 |
| oracle | 1 199 107 |
| test-usdcx | 1 202 138 |
| bitpredix | 1 205 169 |
| **Total** | ~4,8 M uSTX |

Garantir saldo suficiente na carteira deployer (faucet se necessário).

---

## 6. Próximos passos

- **C2** — Botão “Mint test tokens” no frontend (`test-usdcx.mint`), com CONTRACT_ID em `.env.local`
- **C3** — `approve` + `place-bet` no MarketCard
- **D1, D2** — Cron e `ORACLE_MNEMONIC` no backend
