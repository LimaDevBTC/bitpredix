# Smart Contracts — Bitpredix

Estrutura base dos contratos Clarity (Stacks) para o prediction market.  
Lógica completa: Sprint 2. Ver `docs/TOKEN_ARCHITECTURE.md` e `docs/FUNDS_ARCHITECTURE.md`.

## Estrutura

```
contracts/
├── README.md           # este arquivo
└── bitpredix.clar      # contrato principal (estrutura base)
```

## Funções públicas (Sprint 2)

| Função | Descrição |
|--------|-----------|
| `create-round` | Inicia nova rodada (round-id, preço abertura) |
| `place-bet` | Usuário aposta UP/DOWN com USDCx |
| `resolve-round` | Oracle marca rodada resolvida (outcome) |
| `claim-winnings` | Usuário resgata ganhos em USDCx |

## Como rodar / testar

- **Clarinet:** recomendado para dev local e testes. Ver [Clarity Crash Course](https://docs.stacks.co/build/clarity-crash-course).
- **Clarity Playground:** [play.hiro.so](https://play.hiro.so/) para prototipar.
- **Deploy:** testnet/mainnet via `clarinet deploy` ou Hiro.

## Dependências previstas

- USDCx (Stacks) para pagamentos.
- Oracle externo ou backend autorizado para `resolve-round`.
