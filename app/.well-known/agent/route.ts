import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    name: 'Predix',
    description: '1-minute BTC prediction market on Stacks. Zero gas.',
    version: '0.1.0',
    capabilities: ['market-data', 'trading', 'portfolio', 'analytics'],
    protocols: {
      openapi: '/openapi.json',
      mcp: {
        package: '@predix/mcp',
        transports: ['stdio'],
        stdio: { command: 'npx', args: ['@predix/mcp'] },
      },
    },
    authentication: {
      type: 'api-key',
      header: 'X-Predix-Key',
      registration: '/api/agent/register',
    },
    endpoints: {
      market: '/api/agent/market',
      opportunities: '/api/agent/opportunities',
      build_tx: '/api/agent/build-tx',
      positions: '/api/agent/positions',
      history: '/api/agent/history',
      sponsor: '/api/sponsor',
    },
    limits: {
      free_tier: '30 req/min',
      verified_tier: '120 req/min',
    },
  })
}
