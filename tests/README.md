# Testes Clarity (Clarinet + Vitest)

Execute com:

```bash
npm test
```

- **test-usdcx.test.ts** — SIP-010: get-name, get-symbol, get-decimals, get-balance, get-total-supply, get-minted, mint (1× por user), transfer, approve, transfer-from.
- **oracle.test.ts** — get-price (none), set-price (só ORACLE, sem overwrite), não-ORACLE falha err u2.
- **bitpredix.test.ts** — create-round, place-bet, resolve-round, claim-winnings (fluxo completo).

## Testes com `it.skip` (exigem deployer = ORACLE)

Os contratos usam `ORACLE = 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK'`. No simnet, o deployer padrão (`abandon...about`) não coincide.

Para rodar **todos** os testes: em `settings/Simnet.toml` use o mesmo mnemonic que em `settings/Testnet.toml` em `[accounts.deployer]`, de forma a o endereço ser o ORACLE. Depois remova o `.skip` dos testes marcados.

## Contas no simnet

`simnet.getAccounts()`: `deployer` (obrigatório), `wallet_1` e `wallet_2` se definidos em `settings/Simnet.toml`.
