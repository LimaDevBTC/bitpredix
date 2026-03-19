#!/usr/bin/env node

/**
 * End-to-end smoke test for the Predix Agent API.
 *
 * Tests every agent endpoint against the live API (or a custom base URL).
 * Validates response shapes, status codes, and auth enforcement.
 *
 * Usage:
 *   node scripts/test-agent-flow.mjs                          # public endpoints only
 *   PREDIX_API_KEY=pk_... node scripts/test-agent-flow.mjs    # full flow with auth
 *   PREDIX_BASE_URL=http://localhost:3000 node scripts/test-agent-flow.mjs
 *
 * Exit codes:
 *   0 — all tests passed
 *   1 — one or more tests failed
 */

const BASE_URL = process.env.PREDIX_BASE_URL || 'https://www.predix.live'
const API_KEY = process.env.PREDIX_API_KEY || ''

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

const results = []
let passCount = 0
let failCount = 0
let skipCount = 0

function log(icon, msg) {
  console.log(`  ${icon}  ${msg}`)
}

async function test(name, fn) {
  try {
    await fn()
    results.push({ name, status: 'PASS' })
    passCount++
    log('\x1b[32mPASS\x1b[0m', name)
  } catch (err) {
    results.push({ name, status: 'FAIL', error: err.message })
    failCount++
    log('\x1b[31mFAIL\x1b[0m', `${name} — ${err.message}`)
  }
}

function skip(name, reason) {
  results.push({ name, status: 'SKIP', reason })
  skipCount++
  log('\x1b[33mSKIP\x1b[0m', `${name} — ${reason}`)
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg)
}

async function fetchJson(path, options = {}) {
  const url = `${BASE_URL}${path}`
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (API_KEY && options.auth !== false) {
    headers['X-Predix-Key'] = API_KEY
  }
  const res = await fetch(url, { ...options, headers })
  const data = await res.json()
  return { status: res.status, data }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function main() {
  console.log()
  console.log('='.repeat(60))
  console.log('  PREDIX AGENT API — END-TO-END TEST')
  console.log('='.repeat(60))
  console.log(`  Base URL:  ${BASE_URL}`)
  console.log(`  API Key:   ${API_KEY ? API_KEY.slice(0, 12) + '...' : '(none — auth tests will be limited)'}`)
  console.log()

  // ---- Discovery Layer ----

  console.log('\n  --- Discovery Layer ---\n')

  await test('GET /.well-known/ai-plugin.json', async () => {
    const { status, data } = await fetchJson('/.well-known/ai-plugin.json', { auth: false })
    assert(status === 200, `Expected 200, got ${status}`)
    assert(data.schema_version === 'v1', `Missing schema_version`)
    assert(data.name_for_model === 'predix', `Wrong name_for_model: ${data.name_for_model}`)
    assert(data.api?.url, 'Missing api.url')
    assert(data.auth?.type, 'Missing auth.type')
  })

  await test('GET /openapi.json', async () => {
    const { status, data } = await fetchJson('/openapi.json', { auth: false })
    assert(status === 200, `Expected 200, got ${status}`)
    assert(data.openapi?.startsWith('3.'), `Invalid OpenAPI version: ${data.openapi}`)
    assert(data.paths, 'Missing paths')
    const pathCount = Object.keys(data.paths).length
    assert(pathCount >= 9, `Expected >= 9 paths, got ${pathCount}`)
  })

  // ---- Public Agent Endpoints (no auth) ----

  console.log('\n  --- Public Agent Endpoints ---\n')

  await test('GET /api/agent/market', async () => {
    const { status, data } = await fetchJson('/api/agent/market', { auth: false })
    assert(status === 200, `Expected 200, got ${status}`)
    assert(data.ok === true, 'ok !== true')
    assert(data.round, 'Missing round object')
    assert(typeof data.round.id === 'number', `round.id should be number`)
    assert(typeof data.round.tradingOpen === 'boolean', 'Missing tradingOpen')
    assert(data.round.pool, 'Missing pool object')
    assert(typeof data.round.pool.totalUp === 'number', 'Missing pool.totalUp')
    assert(typeof data.round.pool.oddsUp === 'number', 'Missing pool.oddsUp')
    assert(data.contract, 'Missing contract object')
    assert(data.contract.network, 'Missing contract.network')
  })

  await test('GET /api/agent/opportunities', async () => {
    const { status, data } = await fetchJson('/api/agent/opportunities', { auth: false })
    assert(status === 200, `Expected 200, got ${status}`)
    assert(data.ok === true, 'ok !== true')
    assert(data.signals, 'Missing signals object')
    assert(data.signals.poolImbalance, 'Missing poolImbalance signal')
    assert(data.signals.priceDirection, 'Missing priceDirection signal')
    assert(data.signals.volume, 'Missing volume signal')
    assert(data.signals.jackpot, 'Missing jackpot signal')
    assert(Array.isArray(data.recentOutcomes), 'recentOutcomes should be array')
    assert(data.streak, 'Missing streak object')
  })

  await test('GET /api/agent/leaderboard', async () => {
    const { status, data } = await fetchJson('/api/agent/leaderboard', { auth: false })
    assert(status === 200, `Expected 200, got ${status}`)
    assert(data.ok === true, 'ok !== true')
    assert(Array.isArray(data.entries), 'entries should be array')
    assert(typeof data.total === 'number', 'Missing total')
    assert(data.sort, 'Missing sort field')
  })

  await test('GET /api/agent/stats', async () => {
    const { status, data } = await fetchJson('/api/agent/stats', { auth: false })
    assert(status === 200, `Expected 200, got ${status}`)
    assert(data.ok === true, 'ok !== true')
    assert(typeof data.totalAgents === 'number', 'Missing totalAgents')
    assert(typeof data.activeAgents24h === 'number', 'Missing activeAgents24h')
    assert(typeof data.totalVolumeUsd === 'number', 'Missing totalVolumeUsd')
  })

  // ---- Core Platform Endpoints ----

  console.log('\n  --- Core Platform Endpoints ---\n')

  await test('GET /api/health', async () => {
    const { status, data } = await fetchJson('/api/health', { auth: false })
    assert(status === 200, `Expected 200, got ${status}`)
    assert(data.status === 'ok', `Health status: ${data.status}`)
    assert(data.checks, 'Missing checks object')
    for (const [name, check] of Object.entries(data.checks)) {
      assert(check.ok === true, `Health check "${name}" failed: ${check.detail}`)
    }
  })

  await test('GET /api/round', async () => {
    const { status, data } = await fetchJson('/api/round', { auth: false })
    assert(status === 200, `Expected 200, got ${status}`)
    assert(data.ok === true, 'ok !== true')
    assert(data.round, 'Missing round object')
    assert(typeof data.kvConnected === 'boolean', 'Missing kvConnected')
  })

  await test('GET /api/btc-price', async () => {
    const { status, data } = await fetchJson('/api/btc-price', { auth: false })
    assert(status === 200, `Expected 200, got ${status}`)
    assert(data.ok === true, 'ok !== true')
    assert(typeof data.usd === 'number', 'Missing usd price')
    assert(data.usd > 10000, `BTC price suspiciously low: ${data.usd}`)
  })

  await test('GET /api/jackpot/status', async () => {
    const { status, data } = await fetchJson('/api/jackpot/status', { auth: false })
    assert(status === 200, `Expected 200, got ${status}`)
    assert(data.ok === true, 'ok !== true')
    assert(typeof data.balance === 'number', 'Missing balance')
    assert(typeof data.totalTickets === 'number', 'Missing totalTickets')
    assert(typeof data.drawHourET === 'number', 'Missing drawHourET')
  })

  await test('GET /api/jackpot/history', async () => {
    const { status, data } = await fetchJson('/api/jackpot/history', { auth: false })
    assert(status === 200, `Expected 200, got ${status}`)
    assert(data.ok === true, 'ok !== true')
    assert(Array.isArray(data.draws), 'draws should be array')
  })

  // ---- Auth Enforcement (must return 401 without key) ----

  console.log('\n  --- Auth Enforcement ---\n')

  await test('GET /api/agent/positions (no key) → 401', async () => {
    const { status, data } = await fetchJson(
      '/api/agent/positions?address=ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK',
      { auth: false }
    )
    assert(status === 401, `Expected 401, got ${status}`)
    assert(data.error, 'Missing error message')
  })

  await test('GET /api/agent/history (no key) → 401', async () => {
    const { status, data } = await fetchJson(
      '/api/agent/history?address=ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK',
      { auth: false }
    )
    assert(status === 401, `Expected 401, got ${status}`)
    assert(data.error, 'Missing error message')
  })

  await test('POST /api/agent/build-tx (no key) → 401', async () => {
    const { status, data } = await fetchJson('/api/agent/build-tx', {
      method: 'POST',
      auth: false,
      body: JSON.stringify({
        action: 'place-bet',
        publicKey: '0'.repeat(66),
        params: { side: 'UP', amount: 1 },
      }),
    })
    assert(status === 401, `Expected 401, got ${status}`)
    assert(data.error, 'Missing error message')
  })

  await test('GET /api/agent/webhooks (no key) → 401', async () => {
    const { status, data } = await fetchJson('/api/agent/webhooks', { auth: false })
    assert(status === 401, `Expected 401, got ${status}`)
    assert(data.error, 'Missing error message')
  })

  await test('POST /api/agent/register (empty body) → 400', async () => {
    const { status, data } = await fetchJson('/api/agent/register', {
      method: 'POST',
      auth: false,
      body: JSON.stringify({}),
    })
    assert(status === 400, `Expected 400, got ${status}`)
    assert(data.error, 'Missing error message')
  })

  // ---- Authenticated Endpoints (require PREDIX_API_KEY) ----

  console.log('\n  --- Authenticated Endpoints ---\n')

  if (!API_KEY) {
    skip('GET /api/agent/positions (with key)', 'No PREDIX_API_KEY')
    skip('GET /api/agent/history (with key)', 'No PREDIX_API_KEY')
    skip('POST /api/agent/build-tx (with key)', 'No PREDIX_API_KEY')
    skip('GET /api/agent/webhooks (with key)', 'No PREDIX_API_KEY')
    skip('POST /api/agent/webhooks (with key)', 'No PREDIX_API_KEY')
  } else {
    await test('GET /api/agent/positions (with key)', async () => {
      const { status, data } = await fetchJson(
        '/api/agent/positions?address=ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK'
      )
      assert(status === 200, `Expected 200, got ${status}`)
      assert(data.ok === true, 'ok !== true')
      assert(typeof data.balanceUsd === 'number', 'Missing balanceUsd')
      assert(Array.isArray(data.pendingRounds), 'Missing pendingRounds array')
    })

    await test('GET /api/agent/history (with key)', async () => {
      const { status, data } = await fetchJson(
        '/api/agent/history?address=ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK'
      )
      assert(status === 200, `Expected 200, got ${status}`)
      assert(data.ok === true, 'ok !== true')
      assert(data.stats, 'Missing stats object')
      assert(typeof data.stats.totalBets === 'number', 'Missing totalBets')
      assert(typeof data.stats.winRate === 'number', 'Missing winRate')
      assert(Array.isArray(data.bets), 'Missing bets array')
    })

    await test('POST /api/agent/build-tx (with key)', async () => {
      const { status, data } = await fetchJson('/api/agent/build-tx', {
        method: 'POST',
        body: JSON.stringify({
          action: 'place-bet',
          publicKey: '0'.repeat(66),
          params: { side: 'UP', amount: 1 },
        }),
      })
      // 200 (tx built) or 400 (invalid pubkey) — both are acceptable
      assert(status === 200 || status === 400, `Unexpected status: ${status}`)
      if (status === 200) {
        assert(data.ok === true, 'ok !== true')
        assert(data.txHex, 'Missing txHex')
      }
    })

    await test('GET /api/agent/webhooks (with key)', async () => {
      const { status, data } = await fetchJson('/api/agent/webhooks')
      assert(status === 200, `Expected 200, got ${status}`)
      assert(data.ok === true, 'ok !== true')
      assert(Array.isArray(data.webhooks), 'Missing webhooks array')
    })

    await test('POST /api/agent/webhooks (with key)', async () => {
      const { status, data } = await fetchJson('/api/agent/webhooks', {
        method: 'POST',
        body: JSON.stringify({
          url: 'https://example.com/predix-e2e-test',
          events: ['round.resolved'],
        }),
      })
      // 200 (created), 400 (validation), or 409 (duplicate) — all acceptable
      assert(
        status === 200 || status === 400 || status === 409,
        `Unexpected status: ${status}`
      )
    })
  }

  // ---- Report ----

  console.log('\n' + '='.repeat(60))
  console.log('  RESULTS')
  console.log('='.repeat(60))
  console.log(`  \x1b[32mPassed:  ${passCount}\x1b[0m`)
  if (failCount > 0) console.log(`  \x1b[31mFailed:  ${failCount}\x1b[0m`)
  else console.log(`  Failed:  0`)
  if (skipCount > 0) console.log(`  \x1b[33mSkipped: ${skipCount}\x1b[0m`)
  else console.log(`  Skipped: 0`)
  console.log(`  Total:   ${results.length}`)
  console.log('='.repeat(60))

  if (failCount > 0) {
    console.log('\n  Failed tests:')
    for (const r of results.filter(r => r.status === 'FAIL')) {
      console.log(`    \x1b[31m✗\x1b[0m ${r.name}`)
      console.log(`      ${r.error}`)
    }
    console.log()
  }

  process.exit(failCount > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
