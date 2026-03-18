import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    schema_version: 'v1',
    name_for_human: 'Predix',
    name_for_model: 'predix',
    description_for_human: 'Predict BTC price movements in 1-minute rounds. Zero gas fees.',
    description_for_model:
      'Predix is a prediction market for 1-minute BTC price rounds on Stacks blockchain. ' +
      'Use this to place UP/DOWN bets, check market state, view positions, and analyze opportunities. ' +
      'All transactions are gas-free (sponsored). Testnet only.',
    auth: {
      type: 'service_http',
      authorization_type: 'bearer',
      verification_tokens: {},
    },
    api: {
      type: 'openapi',
      url: 'https://bitpredix.vercel.app/openapi.json',
    },
    logo_url: 'https://bitpredix.vercel.app/icon-512.png',
    contact_email: 'agents@predix.app',
    legal_info_url: 'https://bitpredix.vercel.app/terms',
  })
}
