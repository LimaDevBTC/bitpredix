export class PredixError extends Error {
  public status: number

  constructor(message: string, status: number = 500) {
    super(message)
    this.name = 'PredixError'
    this.status = status
  }
}

export class TradingClosedError extends PredixError {
  constructor() {
    super('Trading window is closed for this round', 400)
    this.name = 'TradingClosedError'
  }
}

export class InsufficientBalanceError extends PredixError {
  constructor() {
    super('Insufficient USDCx balance', 400)
    this.name = 'InsufficientBalanceError'
  }
}

export class RateLimitError extends PredixError {
  public retryAfter: number

  constructor(retryAfter: number = 60) {
    super('Rate limit exceeded', 429)
    this.name = 'RateLimitError'
    this.retryAfter = retryAfter
  }
}

export class AuthenticationError extends PredixError {
  constructor(message: string = 'Invalid or missing API key') {
    super(message, 401)
    this.name = 'AuthenticationError'
  }
}
