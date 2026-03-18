/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@stacks/connect',
  ],
  serverExternalPackages: [
    '@stacks/transactions',
    '@stacks/network',
    '@stacks/wallet-sdk',
    '@stacks/common',
    '@stacks/encryption',
    'c32check',
    '@noble/secp256k1',
    '@noble/hashes',
  ],
  async rewrites() {
    return [
      // Standards expect .json extension for discovery manifests
      { source: '/.well-known/agent.json', destination: '/.well-known/agent' },
      { source: '/.well-known/ai-plugin.json', destination: '/.well-known/ai-plugin' },
    ]
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "connect-src 'self' https://api.testnet.hiro.so https://api.mainnet.hiro.so https://hermes.pyth.network https://benchmarks.pyth.network wss://hermes.pyth.network",
              "img-src 'self' data: https://cdn.jsdelivr.net",
              "font-src 'self'",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
