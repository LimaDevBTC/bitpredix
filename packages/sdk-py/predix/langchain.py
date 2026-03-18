"""LangChain tool integration for Predix."""

from typing import Optional, Type

try:
    from langchain_core.tools import BaseTool
    from pydantic import BaseModel, Field
except ImportError:
    raise ImportError("Install langchain extras: pip install predix-sdk[langchain]")

from predix.client import PredixClient


class PredixMarketInput(BaseModel):
    pass


class PredixBetInput(BaseModel):
    side: str = Field(description="Bet direction: UP or DOWN")
    amount: float = Field(description="Bet amount in USD (minimum 1)")


class PredixMarketTool(BaseTool):
    name: str = "predix_market"
    description: str = "Get current Predix prediction market state: round info, pool sizes, odds, BTC price, payouts."
    args_schema: Type[BaseModel] = PredixMarketInput
    client: PredixClient

    class Config:
        arbitrary_types_allowed = True

    def _run(self, **kwargs) -> str:
        data = self.client.market()
        return data.model_dump_json(indent=2)


class PredixOpportunitiesTool(BaseTool):
    name: str = "predix_opportunities"
    description: str = "Get market signals: pool imbalance, price direction, volume, jackpot, streaks."
    args_schema: Type[BaseModel] = PredixMarketInput
    client: PredixClient

    class Config:
        arbitrary_types_allowed = True

    def _run(self, **kwargs) -> str:
        data = self.client.opportunities()
        return data.model_dump_json(indent=2)


class PredixBetTool(BaseTool):
    name: str = "predix_bet"
    description: str = "Place a bet on Predix. Side: UP or DOWN. Amount in USD (min $1). Zero gas."
    args_schema: Type[BaseModel] = PredixBetInput
    client: PredixClient

    class Config:
        arbitrary_types_allowed = True

    def _run(self, side: str, amount: float) -> str:
        result = self.client.bet(side, amount)
        return result.model_dump_json(indent=2)


class PredixPositionsTool(BaseTool):
    name: str = "predix_positions"
    description: str = "Get your positions: active bets, pending rounds, balance."
    args_schema: Type[BaseModel] = PredixMarketInput
    client: PredixClient

    class Config:
        arbitrary_types_allowed = True

    def _run(self, **kwargs) -> str:
        data = self.client.positions()
        return data.model_dump_json(indent=2)


class PredixToolkit:
    """Creates LangChain-compatible tools for Predix."""

    def __init__(self, api_key: str, private_key: Optional[str] = None, **kwargs):
        self.client = PredixClient(api_key=api_key, private_key=private_key, **kwargs)

    def get_tools(self) -> list[BaseTool]:
        tools = [
            PredixMarketTool(client=self.client),
            PredixOpportunitiesTool(client=self.client),
            PredixPositionsTool(client=self.client),
        ]
        if self.client.private_key:
            tools.append(PredixBetTool(client=self.client))
        return tools
