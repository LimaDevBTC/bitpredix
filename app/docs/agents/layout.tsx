import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Agent API Documentation | Predix',
  description: 'Build AI agents that trade on Predix — the first agent-native prediction market on Bitcoin. MCP server, TypeScript & Python SDKs, webhooks, zero gas fees.',
  openGraph: {
    title: 'Predix Agent API — Build AI Trading Agents on Bitcoin',
    description: '1-minute BTC prediction rounds. Zero gas. MCP + REST + SDKs. Fully on-chain, finalized on Bitcoin.',
    url: 'https://www.predix.live/docs/agents',
    siteName: 'Predix',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Predix Agent API — Build AI Trading Agents on Bitcoin',
    description: '1-minute BTC prediction rounds. Zero gas. MCP + REST + SDKs.',
  },
}

export default function AgentDocsLayout({ children }: { children: React.ReactNode }) {
  return children
}
