/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@stacks/connect',
    '@stacks/transactions',
    '@stacks/network',
    '@stacks/wallet-sdk',
  ],
}

module.exports = nextConfig
