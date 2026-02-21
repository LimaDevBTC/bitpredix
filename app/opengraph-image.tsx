import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Predix — Predict Bitcoin. Every Minute.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const logoSrc = fetch(new URL('../public/logo.png', import.meta.url)).then(
  (res) => res.arrayBuffer()
)

export default async function OGImage() {
  const logoData = await logoSrc

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(145deg, #09090b 0%, #18181b 50%, #09090b 100%)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Subtle grid background */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            opacity: 0.06,
            backgroundImage:
              'linear-gradient(rgba(244,244,245,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(244,244,245,0.3) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />

        {/* Green glow top-right */}
        <div
          style={{
            position: 'absolute',
            top: '-80px',
            right: '100px',
            width: '300px',
            height: '300px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(34,197,94,0.15) 0%, transparent 70%)',
            display: 'flex',
          }}
        />

        {/* Red glow bottom-left */}
        <div
          style={{
            position: 'absolute',
            bottom: '-80px',
            left: '100px',
            width: '300px',
            height: '300px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(239,68,68,0.15) 0%, transparent 70%)',
            display: 'flex',
          }}
        />

        {/* Official logo */}
        <img
          // @ts-expect-error -- Satori accepts ArrayBuffer as img src
          src={logoData}
          width={580}
          height={326}
          style={{ marginBottom: '16px' }}
        />

        {/* Tagline */}
        <div
          style={{
            fontSize: '32px',
            color: '#a1a1aa',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          Predict Bitcoin. Every Minute.
        </div>

        {/* UP/DOWN badges */}
        <div
          style={{
            display: 'flex',
            gap: '20px',
            marginTop: '40px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: 'rgba(34,197,94,0.12)',
              border: '1px solid rgba(34,197,94,0.3)',
              borderRadius: '12px',
              padding: '10px 24px',
            }}
          >
            <div
              style={{
                width: 0,
                height: 0,
                borderLeft: '8px solid transparent',
                borderRight: '8px solid transparent',
                borderBottom: '12px solid #22C55E',
                display: 'flex',
              }}
            />
            <span style={{ fontSize: '22px', fontWeight: 700, color: '#22C55E' }}>UP</span>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '12px',
              padding: '10px 24px',
            }}
          >
            <div
              style={{
                width: 0,
                height: 0,
                borderLeft: '8px solid transparent',
                borderRight: '8px solid transparent',
                borderBottom: '12px solid #EF4444',
                display: 'flex',
                transform: 'rotate(180deg)',
              }}
            />
            <span style={{ fontSize: '22px', fontWeight: 700, color: '#EF4444' }}>DOWN</span>
          </div>
        </div>

        {/* Bottom bar */}
        <div
          style={{
            position: 'absolute',
            bottom: '32px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '16px',
            color: '#71717a',
          }}
        >
          <span>On-chain prediction market</span>
          <span style={{ color: '#3f3f46' }}>·</span>
          <span>Powered by Stacks</span>
          <span style={{ color: '#3f3f46' }}>·</span>
          <span>predix.live</span>
        </div>
      </div>
    ),
    { ...size }
  )
}
