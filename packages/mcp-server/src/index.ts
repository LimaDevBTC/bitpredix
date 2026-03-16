#!/usr/bin/env node

/**
 * Predix MCP Server — AI Agent integration for the Predix prediction market
 *
 * Tools:
 *   predix_get_market        — Current round state, odds, prices, volume
 *   predix_get_opportunities — Market signals and betting opportunities
 *   predix_place_bet         — Place a bet (UP or DOWN) on current round
 *   predix_get_positions     — View current positions and claimable rounds
 *   predix_claim             — Claim winnings from a resolved round
 *   predix_get_history       — View historical performance and stats
 *   predix_mint_tokens       — Mint test tokens (testnet only)
 *   predix_approve           — Approve token spending for the contract
 *
 * Config (env vars):
 *   PREDIX_API_URL       — Base URL (default: https://predix.app)
 *   STACKS_PRIVATE_KEY   — Agent's Stacks private key (hex)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { fetchApi } from './lib/client.js'
import type {
  MarketResponse,
  BuildTxResponse,
  PositionsResponse,
  HistoryResponse,
  OpportunitiesResponse,
  SponsorResponse,
} from './lib/client.js'
import { getPublicKey, signTransaction } from './lib/signer.js'
import { getStxAddress } from '@stacks/wallet-sdk'
import { createStacksPrivateKey, pubKeyfromPrivKey } from '@stacks/transactions'

function getPrivateKey(): string {
  const key = process.env.STACKS_PRIVATE_KEY
  if (!key) throw new Error('STACKS_PRIVATE_KEY env var not set')
  return key
}

function getAgentAddress(): string {
  const pk = createStacksPrivateKey(getPrivateKey())
  const pubKey = pubKeyfromPrivKey(pk)
  return getStxAddress({ account: { stxPrivateKey: getPrivateKey(), dataPrivateKey: '', appsKey: '', salt: '', index: 0 } as Parameters<typeof getStxAddress>[0]['account'], network: 'testnet' })
}

/**
 * Full bet flow: build-tx → sign locally → sponsor
 */
async function executeBet(side: 'UP' | 'DOWN', amount: number): Promise<{ txid: string; details: Record<string, unknown> }> {
  const privateKey = getPrivateKey()
  const publicKey = getPublicKey(privateKey)

  // 1. Build unsigned tx
  const buildRes = await fetchApi<BuildTxResponse>('/api/agent/build-tx', {
    method: 'POST',
    body: JSON.stringify({ action: 'place-bet', publicKey, params: { side, amount } }),
  })

  // 2. Sign locally
  const signedHex = signTransaction(buildRes.txHex, privateKey)

  // 3. Sponsor + broadcast
  const sponsorRes = await fetchApi<SponsorResponse>('/api/sponsor', {
    method: 'POST',
    body: JSON.stringify({ txHex: signedHex }),
  })

  return { txid: sponsorRes.txid, details: buildRes.details }
}

async function executeClaim(roundId: number, side: 'UP' | 'DOWN'): Promise<{ txid: string }> {
  const privateKey = getPrivateKey()
  const publicKey = getPublicKey(privateKey)

  const buildRes = await fetchApi<BuildTxResponse>('/api/agent/build-tx', {
    method: 'POST',
    body: JSON.stringify({ action: 'claim', publicKey, params: { roundId, side } }),
  })

  const signedHex = signTransaction(buildRes.txHex, privateKey)

  const sponsorRes = await fetchApi<SponsorResponse>('/api/sponsor', {
    method: 'POST',
    body: JSON.stringify({ txHex: signedHex }),
  })

  return { txid: sponsorRes.txid }
}

async function executeAction(action: 'approve' | 'mint'): Promise<{ txid: string }> {
  const privateKey = getPrivateKey()
  const publicKey = getPublicKey(privateKey)

  const buildRes = await fetchApi<BuildTxResponse>('/api/agent/build-tx', {
    method: 'POST',
    body: JSON.stringify({ action, publicKey, params: {} }),
  })

  const signedHex = signTransaction(buildRes.txHex, privateKey)

  const sponsorRes = await fetchApi<SponsorResponse>('/api/sponsor', {
    method: 'POST',
    body: JSON.stringify({ txHex: signedHex }),
  })

  return { txid: sponsorRes.txid }
}

// ---- MCP Server Setup ----

const server = new McpServer({
  name: 'predix',
  version: '0.1.0',
})

// -- predix_get_market --
server.tool(
  'predix_get_market',
  'Get current Predix prediction market state: round info, pool sizes, odds, BTC price, payout multipliers, and contract details. Use this to understand the current market before placing a bet.',
  {},
  async () => {
    const data = await fetchApi<MarketResponse>('/api/agent/market')
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

// -- predix_get_opportunities --
server.tool(
  'predix_get_opportunities',
  'Get market signals and betting opportunities: pool imbalance (which side pays more), BTC price direction, volume level, jackpot info, and recent outcome streaks. Use this to find favorable bets.',
  {},
  async () => {
    const data = await fetchApi<OpportunitiesResponse>('/api/agent/opportunities')
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

// -- predix_place_bet --
server.tool(
  'predix_place_bet',
  'Place a bet on the current 1-minute BTC price round. Bet UP if you think BTC price will go up, DOWN if you think it will go down. Amount is in USD (minimum $1). The transaction is sponsored (zero gas fee). Make sure to call predix_approve first if this is your first bet.',
  {
    side: z.enum(['UP', 'DOWN']).describe('Bet direction: UP (price will increase) or DOWN (price will decrease)'),
    amount: z.number().min(1).describe('Bet amount in USD (minimum $1)'),
  },
  async ({ side, amount }) => {
    const result = await executeBet(side, amount)
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          txid: result.txid,
          side,
          amount,
          ...result.details,
          note: 'Bet placed! Transaction is being processed on Stacks testnet. Use predix_get_positions to check status.',
        }, null, 2)
      }]
    }
  }
)

// -- predix_get_positions --
server.tool(
  'predix_get_positions',
  'View your current positions: active bets in the current round, pending claims from resolved rounds, and your USDCx token balance. Use this to find rounds you can claim winnings from.',
  {},
  async () => {
    const address = getAgentAddress()
    const data = await fetchApi<PositionsResponse>(`/api/agent/positions?address=${address}`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

// -- predix_claim --
server.tool(
  'predix_claim',
  'Claim winnings from a resolved round. You must specify the roundId and the side you bet on. Use predix_get_positions first to find claimable rounds.',
  {
    roundId: z.number().describe('The round ID to claim from'),
    side: z.enum(['UP', 'DOWN']).describe('The side you bet on (UP or DOWN)'),
  },
  async ({ roundId, side }) => {
    const result = await executeClaim(roundId, side)
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          txid: result.txid,
          roundId,
          side,
          note: 'Claim submitted! Winnings will be transferred to your wallet.',
        }, null, 2)
      }]
    }
  }
)

// -- predix_get_history --
server.tool(
  'predix_get_history',
  'View your betting history and performance stats: win rate, P&L, ROI, total volume, streaks, and individual bet records. Use this to evaluate your strategy.',
  {
    page: z.number().optional().default(1).describe('Page number (default 1)'),
    pageSize: z.number().optional().default(20).describe('Results per page (default 20, max 50)'),
  },
  async ({ page, pageSize }) => {
    const address = getAgentAddress()
    const data = await fetchApi<HistoryResponse>(`/api/agent/history?address=${address}&page=${page}&pageSize=${pageSize}`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

// -- predix_mint_tokens --
server.tool(
  'predix_mint_tokens',
  'Mint test USDCx tokens (testnet only). Call this to get tokens for betting. Each mint gives you test tokens to use on the platform.',
  {},
  async () => {
    const result = await executeAction('mint')
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          txid: result.txid,
          note: 'Mint transaction submitted. Tokens will appear in your balance after confirmation (~30-60s on testnet).',
        }, null, 2)
      }]
    }
  }
)

// -- predix_approve --
server.tool(
  'predix_approve',
  'Approve the Predix contract to spend your USDCx tokens. This is required before placing your first bet. Only needs to be done once.',
  {},
  async () => {
    const result = await executeAction('approve')
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          txid: result.txid,
          note: 'Approval transaction submitted. You can place bets after confirmation (~30-60s on testnet).',
        }, null, 2)
      }]
    }
  }
)

// ---- Start Server ----

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('Predix MCP Server running on stdio')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
