class PredixError(Exception):
    def __init__(self, message: str, status: int = 500):
        super().__init__(message)
        self.status = status


class TradingClosedError(PredixError):
    def __init__(self):
        super().__init__("Trading window is closed for this round", 400)


class InsufficientBalanceError(PredixError):
    def __init__(self):
        super().__init__("Insufficient USDCx balance", 400)


class RateLimitError(PredixError):
    def __init__(self, retry_after: int = 60):
        super().__init__("Rate limit exceeded", 429)
        self.retry_after = retry_after


class AuthenticationError(PredixError):
    def __init__(self, message: str = "Invalid or missing API key"):
        super().__init__(message, 401)
