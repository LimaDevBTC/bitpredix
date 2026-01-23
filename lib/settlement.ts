/**
 * Settlement de shares após resolução de rodada
 * 
 * Este arquivo demonstra como o settlement funcionaria on-chain.
 * No MVP atual, isso é apenas conceitual - em produção seria um smart contract.
 */

import type { Round, MarketSide } from './types'

export interface ShareToken {
  /** ID único do token */
  id: string
  /** ID da rodada (ex: "round-1737654000") */
  roundId: string
  /** Lado: UP ou DOWN */
  side: MarketSide
  /** Quantidade de shares */
  amount: number
  /** Dono do token (endereço da carteira) */
  owner: string
  /** Timestamp de criação */
  createdAt: number
}

export interface SettlementResult {
  roundId: string
  outcome: MarketSide
  totalPayout: number
  tokensRedeemed: number
  tokensBurned: number
}

/**
 * Simula o settlement de uma rodada resolvida
 * 
 * Em produção, isso seria uma função do smart contract que:
 * 1. Verifica que a rodada está RESOLVED
 * 2. Itera sobre todos os tokens da rodada
 * 3. Tokens vencedores: paga $1.00 por share
 * 4. Tokens perdedores: queima sem pagamento
 * 5. Transfere USDCx para os usuários
 */
export function settleRound(
  round: Round,
  userTokens: ShareToken[]
): SettlementResult {
  if (round.status !== 'RESOLVED' || !round.outcome) {
    throw new Error('Round is not resolved yet')
  }

  const roundTokens = userTokens.filter(t => t.roundId === round.id)
  let totalPayout = 0
  let tokensRedeemed = 0
  let tokensBurned = 0

  for (const token of roundTokens) {
    if (token.side === round.outcome) {
      // Token vencedor: vale $1.00 por share (pago em USDCx)
      const payout = token.amount * 1.00
      totalPayout += payout
      tokensRedeemed++
      
      // Em produção: transferir USDCx para token.owner
      // transferUsdcx(token.owner, payout)
      
      // Em produção: queimar o token
      // burnToken(token.id)
    } else {
      // Token perdedor: vale $0.00
      tokensBurned++
      
      // Em produção: queimar o token sem pagamento
      // burnToken(token.id)
    }
  }

  return {
    roundId: round.id,
    outcome: round.outcome,
    totalPayout,
    tokensRedeemed,
    tokensBurned,
  }
}

/**
 * Calcula o valor teórico dos tokens de um usuário para uma rodada
 * Útil para mostrar P&L antes do settlement
 */
export function calculateTokenValue(
  round: Round,
  userTokens: ShareToken[]
): { totalValue: number; winningTokens: number; losingTokens: number } {
  if (round.status !== 'RESOLVED' || !round.outcome) {
    return { totalValue: 0, winningTokens: 0, losingTokens: 0 }
  }

  const roundTokens = userTokens.filter(t => t.roundId === round.id)
  let totalValue = 0
  let winningTokens = 0
  let losingTokens = 0

  for (const token of roundTokens) {
    if (token.side === round.outcome) {
      totalValue += token.amount * 1.00
      winningTokens += token.amount
    } else {
      losingTokens += token.amount
    }
  }

  return { totalValue, winningTokens, losingTokens }
}

/**
 * Gera ID único para um token baseado na rodada e trade
 */
export function generateTokenId(
  roundId: string,
  side: MarketSide,
  timestamp: number,
  tradeIndex: number
): string {
  return `${roundId}-${side}-${timestamp}-${tradeIndex}`
}

/**
 * Exemplo de como criar tokens quando usuário compra shares
 */
export function createShareTokens(
  roundId: string,
  side: MarketSide,
  sharesReceived: number,
  owner: string,
  tradeIndex: number
): ShareToken[] {
  // Em produção, poderia criar múltiplos tokens ou um único
  // Por simplicidade, criamos um token com a quantidade total
  const token: ShareToken = {
    id: generateTokenId(roundId, side, Date.now(), tradeIndex),
    roundId,
    side,
    amount: sharesReceived,
    owner,
    createdAt: Date.now(),
  }

  return [token]
}
