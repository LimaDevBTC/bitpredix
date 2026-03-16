# Predix — AI Agent Integration Guide

You are interacting with **Predix**, a 1-minute BTC prediction market on Stacks testnet.
Users (and agents) bet UP or DOWN on whether BTC price will rise or fall in the next 60 seconds.
All transactions are sponsored — **zero gas fees**.

## TL;DR — Fastest Path to Trading

```
1. GET  /api/agent/market           → see current round, odds, price
2. POST /api/agent/build-tx         → get unsigned tx to sign
3. Sign locally with your private key
4. POST /api/sponsor                → broadcast (zero gas)
5. GET  /api/agent/positions        → check your bets
```

If you have the MCP server (`@predix/mcp-server`), just call `predix_place_bet({ side: "UP", amount: 5 })` and everything happens automatically.

---

## How the Market Works

| Parameter | Value |
|---|---|
| Round duration | 60 seconds |
| Trading window | First 50 seconds (closes ~10s before end) |
| Min bet | $1 USDCx |
| Fee | 3% (2% protocol + 1% velocity jackpot) |
| Payout | `(your_bet / winning_pool) * total_pool * 0.97` |
| Token | test-usdcx (SIP-010, 6 decimals) |
| Network | Stacks testnet |
| Round ID | `Math.floor(unix_timestamp_seconds / 60)` |

**Round lifecycle:**
1. Round starts at `roundId * 60` seconds
2. Trading open for ~50 seconds
3. Trading closes ~10 seconds before round end
4. Round ends at `(roundId + 1) * 60` seconds
5. Settlement: compare close price vs open price → UP wins if close > open
6. Winners claim proportional share of the pool minus 3% fee

**Early window (Velocity Jackpot):** Bets placed in the first 20 seconds are jackpot-eligible. A 1% jackpot fund accumulates and distributes bonus to early bettors on the winning side.

---

## First-Time Setup

Before placing bets, your agent needs tokens and approval. Do this once:

### 1. Mint test tokens
```
POST /api/agent/build-tx
{ "action": "mint", "publicKey": "YOUR_COMPRESSED_PUBLIC_KEY_HEX" }
```
Sign the returned `txHex`, POST to `/api/sponsor`.

### 2. Approve contract spending
```
POST /api/agent/build-tx
{ "action": "approve", "publicKey": "YOUR_COMPRESSED_PUBLIC_KEY_HEX" }
```
Sign the returned `txHex`, POST to `/api/sponsor`.

Wait ~30-60 seconds for each transaction to confirm on testnet before proceeding.

---

## API Reference

Base URL: `https://predix.app` (or your deployment URL)

### GET /api/agent/market

Returns complete market state for the current round. **Poll this every 1-5 seconds** during active trading.

Response:
```json
{
  "ok": true,
  "timestamp": 1710600000000,
  "round": {
    "id": 29494078,
    "startAt": 1710600000000,
    "endsAt": 1710600060000,
    "secondsRemaining": 42,
    "tradingOpen": true,
    "status": "open",
    "openPrice": 97500.12,
    "currentPrice": 97512.34,
    "priceChangePct": 0.0125,
    "pool": {
      "totalUp": 15.5,
      "totalDown": 8.2,
      "totalVolume": 23.7,
      "oddsUp": 0.654,
      "oddsDown": 0.346
    },
    "effectivePayoutUp": 1.53,
    "effectivePayoutDown": 2.89,
    "recentTrades": [],
    "hasCounterparty": true,
    "uniqueWallets": 3,
    "jackpot": {
      "balance": 12.5,
      "earlyUp": 3.0,
      "earlyDown": 1.5
    }
  },
  "contract": {
    "id": "ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.predixv2",
    "gateway": "ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.predixv2-gateway",
    "token": "ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.test-usdcx",
    "minBetUsd": 1,
    "feeBps": 300,
    "roundDurationSec": 60,
    "network": "testnet"
  }
}
```

Key fields for decision-making:
- `round.tradingOpen` — can you bet right now?
- `round.secondsRemaining` — urgency
- `round.pool.oddsUp / oddsDown` — implied probability
- `round.effectivePayoutUp / Down` — what you get per $1 if you win
- `round.priceChangePct` — BTC price movement in current round
- `round.hasCounterparty` — needs bets on both sides for claims to work

### GET /api/agent/opportunities

Pre-computed market signals for faster decision-making.

Response:
```json
{
  "ok": true,
  "round": { "id": 29494078, "tradingOpen": true, "secondsRemaining": 42 },
  "signals": {
    "poolImbalance": {
      "favoredSide": "DOWN",
      "imbalanceRatio": 1.89,
      "payoutUp": 1.53,
      "payoutDown": 2.89,
      "description": "DOWN pool is underweight — higher potential payout (2.89x)"
    },
    "priceDirection": {
      "side": "UP",
      "changePct": 0.012,
      "openPrice": 97500.12,
      "currentPrice": 97512.34,
      "description": "BTC up 0.0120% in current round"
    },
    "volume": {
      "totalUsd": 23.7,
      "level": "medium",
      "uniqueWallets": 3,
      "hasCounterparty": true
    },
    "jackpot": {
      "balanceUsd": 12.5,
      "earlyWindowOpen": true
    }
  },
  "recentOutcomes": ["UP", "DOWN", "UP", "UP", "DOWN"],
  "streak": { "side": "UP", "length": 2 }
}
```

### POST /api/agent/build-tx

Build an unsigned sponsored transaction. Your agent signs it locally (private key never leaves your machine), then POSTs the signed hex to `/api/sponsor`.

Request:
```json
{
  "action": "place-bet",
  "publicKey": "03a1b2c3...66_hex_chars",
  "params": {
    "side": "UP",
    "amount": 5.0
  }
}
```

Actions:
| Action | Params | Description |
|---|---|---|
| `place-bet` | `side` (UP/DOWN), `amount` (USD, min 1), `roundId?` (optional) | Place a bet |
| `claim` | `roundId`, `side` (UP/DOWN) | Claim winnings (Pyth prices fetched automatically) |
| `approve` | none | Approve token spending (one-time) |
| `mint` | none | Mint test tokens |

Response:
```json
{
  "ok": true,
  "txHex": "0x0000...",
  "action": "place-bet",
  "details": {
    "contractId": "ST1QP...predixv2-gateway",
    "functionName": "place-bet",
    "roundId": 29494078,
    "side": "UP",
    "amountMicro": 5000000,
    "isEarly": true
  },
  "instructions": "Sign this transaction with your private key..."
}
```

### POST /api/sponsor

Submit a signed transaction for sponsorship and broadcast. This endpoint adds the gas fee (sponsor pays) and broadcasts to Stacks testnet.

Request:
```json
{ "txHex": "signed-transaction-hex-string" }
```

Response (success):
```json
{ "txid": "0xabc123..." }
```

Response (error):
```json
{ "error": "Trading window closed", "reason": "too_late", "secondsLeft": 8 }
```

Common errors:
- `Trading window closed` — too late in the round, wait for next
- `Early window expired` — early flag rejected (>22s into round)
- `Round without counterparty` — only one wallet betting, claims blocked
- `BadNonce` / `ConflictingNonceInMempool` — retried automatically (up to 3x)

### GET /api/agent/positions?address=ST1ABC...

Your current positions, pending claims, and token balance.

Response:
```json
{
  "ok": true,
  "address": "ST1ABC...",
  "balanceUsd": 95.5,
  "pendingRounds": [
    {
      "roundId": 29494077,
      "up": { "amount": 5.0, "claimed": false },
      "down": null,
      "resolved": true,
      "outcome": "UP",
      "estimatedPayout": 8.73,
      "claimable": true
    }
  ],
  "activeRound": {
    "roundId": 29494078,
    "up": { "amount": 3.0 },
    "down": null
  }
}
```

### GET /api/agent/history?address=ST1ABC...&page=1&pageSize=20

Performance stats and bet history.

Response:
```json
{
  "ok": true,
  "stats": {
    "totalBets": 45,
    "wins": 28,
    "losses": 17,
    "winRate": 0.622,
    "totalVolumeUsd": 230.0,
    "totalPnlUsd": 42.5,
    "roi": 0.185,
    "bestWin": 15.2,
    "worstLoss": -10.0,
    "avgBetSize": 5.11,
    "currentStreak": { "type": "win", "count": 3 }
  },
  "bets": [
    {
      "roundId": 29494077,
      "side": "UP",
      "amountUsd": 5.0,
      "outcome": "UP",
      "resolved": true,
      "pnl": 3.73,
      "timestamp": 1710599940,
      "txId": "0xabc..."
    }
  ]
}
```

---

## Signing Transactions (TypeScript)

```typescript
import {
  deserializeTransaction,
  createStacksPrivateKey,
  TransactionSigner,
} from '@stacks/transactions'

// 1. Get unsigned tx from build-tx endpoint
const { txHex } = await fetch('/api/agent/build-tx', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'place-bet',
    publicKey: 'YOUR_COMPRESSED_PUBLIC_KEY',
    params: { side: 'UP', amount: 5 }
  })
}).then(r => r.json())

// 2. Sign locally
const tx = deserializeTransaction(txHex)
const signer = new TransactionSigner(tx)
signer.signOrigin(createStacksPrivateKey('YOUR_PRIVATE_KEY_HEX'))
const signedHex = tx.serialize()

// 3. Submit for sponsorship
const { txid } = await fetch('/api/sponsor', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ txHex: signedHex })
}).then(r => r.json())
```

### Deriving public key from private key

```typescript
import { createStacksPrivateKey, pubKeyfromPrivKey, publicKeyToString } from '@stacks/transactions'

const pk = createStacksPrivateKey('your-private-key-hex')
const publicKey = publicKeyToString(pubKeyfromPrivKey(pk))
// publicKey is the compressed hex string (66 chars) you pass to build-tx
```

---

## MCP Server (for AI Agents)

If your agent supports MCP (Model Context Protocol), install the Predix MCP server for the easiest integration:

```json
{
  "mcpServers": {
    "predix": {
      "command": "npx",
      "args": ["@predix/mcp-server"],
      "env": {
        "PREDIX_API_URL": "https://predix.app",
        "STACKS_PRIVATE_KEY": "your-private-key-hex"
      }
    }
  }
}
```

Available tools:
| Tool | Description |
|---|---|
| `predix_get_market` | Current round, odds, prices, volume |
| `predix_get_opportunities` | Market signals, pool imbalance, streaks |
| `predix_place_bet` | Place bet (params: side, amount) |
| `predix_get_positions` | Your bets, claimable rounds, balance |
| `predix_claim` | Claim winnings (params: roundId, side) |
| `predix_get_history` | Performance stats and bet records |
| `predix_mint_tokens` | Mint test USDCx (testnet) |
| `predix_approve` | Approve token spending (one-time) |

---

## Strategy Tips for Agents

1. **Check `tradingOpen` before betting.** If false, wait for the next round.
2. **Pool imbalance = opportunity.** If `effectivePayoutDown` is 2.89x but `effectivePayoutUp` is 1.53x, a DOWN bet has higher expected value (assuming 50/50 odds on price movement).
3. **Bet early for jackpot bonus.** The first 20 seconds of each round are jackpot-eligible. The velocity jackpot adds bonus payout to early bettors on the winning side.
4. **Claim promptly.** Use `/api/agent/positions` to find claimable rounds and claim them. Unclaimed rounds accumulate in your pending list (max 50).
5. **Monitor your performance.** Use `/api/agent/history` to track win rate and ROI. Adjust strategy based on results.
6. **Don't bet in the last 10 seconds.** The sponsor will reject bets within 10 seconds of round end.
7. **Counterparty required.** Rounds need bets on both sides (from different wallets) for claims to be processed. Check `hasCounterparty` in market data.

## Timing Constraints

| Window | Seconds into round | Notes |
|---|---|---|
| Early (jackpot eligible) | 0–20s | `isEarly = true` in build-tx |
| Normal trading | 20–50s | Regular bets |
| Closed | 50–60s | Sponsor rejects, contract rejects at 55s |

## Error Handling

- If `/api/sponsor` returns `403` with `reason: "too_late"`, the round ended. Wait for next round.
- If build-tx returns `500`, retry once. Could be a Pyth price fetch timeout (for claims).
- If your transaction fails on-chain, check your USDCx balance and approval status.
- Nonce conflicts are handled automatically by the sponsor endpoint (up to 3 retries).

## Contract Details

| Contract | Address |
|---|---|
| predixv2 | `ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.predixv2` |
| predixv2-gateway | `ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.predixv2-gateway` |
| test-usdcx | `ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.test-usdcx` |

OpenAPI spec available at: `/openapi.json`
