import type { Metadata } from 'next'
import { Outfit, JetBrains_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { AppHeader } from '@/components/AppHeader'
import './globals.css'

const outfit = Outfit({ subsets: ['latin'], variable: '--font-sans' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-mono' })

const SITE_URL = 'https://www.predix.live'

export const metadata: Metadata = {
  title: {
    default: 'Predix — Predict Bitcoin. Every Minute.',
    template: '%s | Predix',
  },
  description:
    'Predict if Bitcoin goes UP or DOWN in the next 60 seconds. On-chain prediction market powered by Stacks.',
  metadataBase: new URL(SITE_URL),
  applicationName: 'Predix',
  keywords: ['bitcoin', 'prediction market', 'crypto', 'stacks', 'btc', 'trading', 'on-chain'],
  authors: [{ name: 'Predix' }],
  creator: 'Predix',
  openGraph: {
    type: 'website',
    siteName: 'Predix',
    title: 'Predix — Predict Bitcoin. Every Minute.',
    description: 'Predict if Bitcoin goes UP or DOWN in the next 60 seconds. On-chain prediction market powered by Stacks.',
    url: SITE_URL,
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Predix — Predict Bitcoin. Every Minute.',
    description: 'Predict if Bitcoin goes UP or DOWN in the next 60 seconds. On-chain prediction market powered by Stacks.',
  },
  robots: {
    index: true,
    follow: true,
  },
  other: {
    'theme-color': '#09090b',
    'color-scheme': 'dark',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${outfit.variable} ${jetbrainsMono.variable}`}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: 'html,body{background:#09090b!important;color:#f4f4f5!important;min-height:100vh}' }} />
      </head>
      <body className="min-h-screen bg-zinc-950 text-zinc-100 font-sans antialiased">
        <AppHeader />
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
