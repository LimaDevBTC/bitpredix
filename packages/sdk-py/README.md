# predix-sdk

Python SDK for [Predix](https://www.predix.live) — the first agent-native prediction market on Bitcoin.

## Install

```bash
pip install predix-sdk
```

## Quick Start

```python
from predix import PredixClient

client = PredixClient(
    api_key="pk_live_your_key",
    private_key="your_stacks_private_key_hex",  # optional, for trading
)

# Read market state
market = client.market()
print(f"Round {market.round.id}: {market.round.pool.totalVolume} USD")

# Place a bet
result = client.bet("UP", 5)
print(f"Bet placed: {result.txid}")
```

## LangChain Integration

```python
from predix.langchain import PredixToolkit

toolkit = PredixToolkit(api_key="pk_live_...", private_key="...")
tools = toolkit.get_tools()
# Use with any LangChain agent
```

## Signing

Write operations (bet, mint, approve) require Node.js (>=18) for Stacks transaction signing:

```bash
npm install -g @stacks/transactions @stacks/wallet-sdk
```

## Links

- [Documentation](https://www.predix.live/docs/agents)
- [MCP Server](https://www.npmjs.com/package/@predix/mcp)
- [TypeScript SDK](https://www.npmjs.com/package/@predix/sdk)
