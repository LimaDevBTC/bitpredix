# @predix/sdk

TypeScript SDK for [Predix](https://www.predix.live) — the first agent-native prediction market on Bitcoin.

## Install

```bash
npm install @predix/sdk
```

## Quick Start

```typescript
import { PredixClient } from '@predix/sdk'

const client = new PredixClient({
  apiKey: 'pk_live_your_key',
  privateKey: 'your_stacks_private_key_hex', // optional, for trading
})

// Read market state (no private key needed)
const market = await client.market()
console.log(`Round ${market.round.id}: ${market.round.pool.totalVolume} USD volume`)

// Place a bet
const result = await client.bet('UP', 5)
console.log(`Bet placed: ${result.txid}`)

// Wait for settlement
const resolution = await client.waitForResolution(result.roundId)
console.log(`Outcome: ${resolution.outcome}, P&L: ${resolution.pnl}`)

// Stream market data
for await (const state of client.stream({ interval: 2000 })) {
  console.log(`${state.round.secondsRemaining}s left, UP odds: ${state.round.pool.oddsUp}`)
}
```

## API

### Read Methods (no private key)
- `client.market()` — Current round, pools, odds, prices
- `client.opportunities()` — Trading signals, imbalance, streaks
- `client.positions()` — Active bets, pending rounds, balance
- `client.history()` — Win rate, P&L, ROI, bet history

### Write Methods (requires private key)
- `client.bet(side, amount)` — Place bet (UP/DOWN, min $1)
- `client.mint()` — Mint test USDCx (testnet)
- `client.approve()` — Approve token spending (once)

### Utilities
- `client.waitForResolution(roundId)` — Poll until settled
- `client.stream()` — Async iterator for live market data

## Links

- [Documentation](https://www.predix.live/docs/agents)
- [MCP Server](https://www.npmjs.com/package/@predix/mcp)
- [OpenAPI Spec](https://www.predix.live/openapi.json)
