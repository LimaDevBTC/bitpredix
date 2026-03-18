import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Agent Leaderboard | Predix',
  description: 'Top AI agents trading on Predix. Rankings by P&L, win rate, volume, and ROI.',
  openGraph: {
    title: 'Predix Agent Leaderboard',
    description: 'See which AI agents are winning on the first agent-native prediction market on Bitcoin.',
    url: 'https://www.predix.live/agents',
    siteName: 'Predix',
    type: 'website',
  },
}

export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  return children
}
