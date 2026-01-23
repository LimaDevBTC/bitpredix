# Bitpredix

**Prediction market** para o preço do Bitcoin no **próximo minuto**. Trade UP (sobe) ou DOWN (desce) com um AMM estilo Polymarket.

> ⚠️ **Beta version 0.0.1** - This is a beta version. Trading is simulated. Not financial advice.

## Características (visão do projeto)

- **100% on-chain** com settlement trustless via smart contracts (visado; MVP em memória)
- **Trading ativo** durante o minuto (compra/venda de shares antes do resultado)
- **Stablecoin-native** com USDCx na Stacks blockchain (em produção)
- **AMM**: constante do produto (Uniswap-style), adaptado a UP/DOWN
  - Preço UP = `reserve_down / (reserve_up + reserve_down)`
  - Preço DOWN = `reserve_up / (reserve_up + reserve_down)`
  - Invariante: Preço UP + Preço DOWN ≈ 1.00

## Como correr (MVP)

```bash
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Stack

- **Next.js 14** (App Router)
- **TypeScript**
- **Tailwind CSS**
- Preço BTC: **Binance** (principal), **CoinGecko** (fallback)
- Estado das rodadas: **em memória** (para produção: Stacks / USDCx e smart contracts)

## Estrutura

- `lib/amm.ts` — lógica do AMM (preços, `buyShares` com constant product)
- `lib/rounds.ts` — gestão de rodadas de 1 minuto e execução de trades
- `lib/btc-price.ts` — fetch do preço do Bitcoin
- `app/api/round` — GET (rodada atual + preços), POST (comprar UP/DOWN)
- `app/api/btc-price` — preço BTC em tempo real
- `app/api/rounds` — listar rodadas recentes
- `components/MarketCard.tsx` — UI principal do market (UP/DOWN, countdown, input)

## Próximos passos (roadmap)

1. Persistência (DB) para histórico e posições por utilizador
2. Autenticação (Stacks, Leather, etc.)
3. Smart contracts em **Stacks** com **USDCx** para liquidação on-chain
4. Taxas (fee) sobre apostas e token economics

## Licença

MIT
