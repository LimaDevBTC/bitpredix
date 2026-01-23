import type { Metadata } from 'next'
import './globals.css'

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
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: 'html,body{background:#09090b!important;color:#f4f4f5!important;min-height:100vh}' }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Outfit:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-zinc-950 text-zinc-100 font-sans antialiased">
        {children}
      </body>
    </html>
  )
}
