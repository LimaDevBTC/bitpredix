import type { Metadata } from 'next'
import { Outfit, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const outfit = Outfit({ subsets: ['latin'], variable: '--font-sans' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'Bitpredix — Prediction Market | Bitcoin Next Minute',
  description:
    'Prediction market for Bitcoin price in the next minute. UP or DOWN. Polymarket-style AMM.',
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
        {children}
      </body>
    </html>
  )
}
