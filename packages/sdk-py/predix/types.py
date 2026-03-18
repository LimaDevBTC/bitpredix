from pydantic import BaseModel
from typing import Optional


class Pool(BaseModel):
    totalUp: float
    totalDown: float
    totalVolume: float
    oddsUp: float
    oddsDown: float


class Jackpot(BaseModel):
    balance: float
    earlyUp: float
    earlyDown: float


class Round(BaseModel):
    id: int
    startAt: int
    endsAt: int
    secondsRemaining: int
    tradingOpen: bool
    status: str
    openPrice: Optional[float] = None
    currentPrice: Optional[float] = None
    priceChangePct: Optional[float] = None
    pool: Pool
    effectivePayoutUp: float
    effectivePayoutDown: float
    hasCounterparty: bool
    uniqueWallets: int
    jackpot: Jackpot


class Contract(BaseModel):
    id: str
    gateway: str
    token: str
    minBetUsd: float
    feeBps: int
    roundDurationSec: int
    network: str


class MarketData(BaseModel):
    ok: bool
    timestamp: int
    round: Round
    contract: Contract


class PoolImbalance(BaseModel):
    favoredSide: Optional[str] = None
    imbalanceRatio: float
    payoutUp: float
    payoutDown: float
    description: str


class PriceDirection(BaseModel):
    side: Optional[str] = None
    changePct: Optional[float] = None
    openPrice: Optional[float] = None
    currentPrice: Optional[float] = None
    description: str


class Volume(BaseModel):
    totalUsd: float
    level: str
    uniqueWallets: int
    hasCounterparty: bool


class JackpotSignal(BaseModel):
    balanceUsd: float
    earlyWindowOpen: bool


class Signals(BaseModel):
    poolImbalance: PoolImbalance
    priceDirection: PriceDirection
    volume: Volume
    jackpot: JackpotSignal


class Streak(BaseModel):
    side: Optional[str] = None
    length: int


class OpportunitiesData(BaseModel):
    ok: bool
    round: dict
    signals: Signals
    recentOutcomes: list[str]
    streak: Streak


class BetPosition(BaseModel):
    amount: float
    claimed: bool = False


class PendingRound(BaseModel):
    roundId: int
    up: Optional[BetPosition] = None
    down: Optional[BetPosition] = None
    resolved: bool
    outcome: Optional[str] = None
    estimatedPayout: Optional[float] = None
    won: bool


class ActiveRound(BaseModel):
    roundId: int
    up: Optional[dict] = None
    down: Optional[dict] = None


class PositionsData(BaseModel):
    ok: bool
    address: str
    balanceUsd: float
    pendingRounds: list[PendingRound]
    activeRound: Optional[ActiveRound] = None


class Stats(BaseModel):
    totalBets: int
    wins: int
    losses: int
    pending: int = 0
    winRate: float
    totalVolumeUsd: float
    totalPnlUsd: float
    roi: float
    bestWin: float = 0
    worstLoss: float = 0
    avgBetSize: float = 0
    currentStreak: Optional[dict] = None


class BetRecord(BaseModel):
    roundId: int
    side: str
    amountUsd: float
    outcome: Optional[str] = None
    resolved: bool = False
    pnl: float = 0
    timestamp: int = 0
    txId: str = ""


class HistoryData(BaseModel):
    ok: bool
    address: str
    stats: Stats
    bets: list[BetRecord]
    totalBetRecords: int = 0
    page: int = 1
    pageSize: int = 20


class BetResult(BaseModel):
    txid: str
    roundId: int
    side: str
    amount: float
    estimatedPayout: Optional[float] = None


class TxResult(BaseModel):
    txid: str
