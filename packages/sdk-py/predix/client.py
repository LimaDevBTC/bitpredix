"""
PredixClient — Python SDK for the Predix prediction market.

For write operations (bet, mint, approve), uses a server-side
sign-and-submit approach via the build-tx + sponsor flow.
Stacks signing requires a Node.js subprocess (no mature Python lib).
"""

import subprocess
import json
from typing import Optional

import httpx

from predix.types import (
    MarketData,
    OpportunitiesData,
    PositionsData,
    HistoryData,
    BetResult,
    TxResult,
)
from predix.errors import (
    PredixError,
    TradingClosedError,
    RateLimitError,
    AuthenticationError,
)

DEFAULT_BASE_URL = "https://bitpredix.vercel.app"


class PredixClient:
    def __init__(
        self,
        api_key: str,
        private_key: Optional[str] = None,
        base_url: str = DEFAULT_BASE_URL,
        network: str = "testnet",
    ):
        self.api_key = api_key
        self.private_key = private_key
        self.base_url = base_url.rstrip("/")
        self.network = network
        self._http = httpx.Client(
            base_url=self.base_url,
            headers={
                "Content-Type": "application/json",
                "X-Predix-Key": self.api_key,
            },
            timeout=15.0,
        )
        self._address: Optional[str] = None

    @property
    def address(self) -> str:
        if self._address is None:
            if not self.private_key:
                raise PredixError("private_key required to derive address")
            self._address = self._derive_address()
        return self._address

    def _derive_address(self) -> str:
        """Derive Stacks address via Node.js subprocess. Private key passed via stdin."""
        script = """
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (pk) => {
  const { getStxAddress } = require('@stacks/wallet-sdk');
  const address = getStxAddress({ account: { stxPrivateKey: pk.trim(), dataPrivateKey: '', appsKey: '', salt: '', index: 0 }, network: '%s' });
  console.log(address);
  rl.close();
});
""" % self.network
        try:
            result = subprocess.run(
                ["node", "-e", script],
                input=self.private_key,
                capture_output=True, text=True, timeout=10,
            )
            if result.returncode != 0:
                raise PredixError(f"Address derivation failed: {result.stderr.strip()}")
            return result.stdout.strip()
        except FileNotFoundError:
            raise PredixError("Node.js required for Stacks address derivation (install from nodejs.org)")

    def _request(self, method: str, path: str, **kwargs) -> dict:
        res = self._http.request(method, path, **kwargs)
        data = res.json()

        if res.status_code == 401:
            raise AuthenticationError(data.get("error", "Unauthorized"))
        if res.status_code == 429:
            raise RateLimitError()
        if not res.is_success or data.get("error"):
            raise PredixError(data.get("error", f"API error: {res.status_code}"), res.status_code)
        return data

    # ---- Read ----

    def market(self) -> MarketData:
        data = self._request("GET", "/api/agent/market")
        return MarketData(**data)

    def opportunities(self) -> OpportunitiesData:
        data = self._request("GET", "/api/agent/opportunities")
        return OpportunitiesData(**data)

    def positions(self) -> PositionsData:
        data = self._request("GET", f"/api/agent/positions?address={self.address}")
        return PositionsData(**data)

    def history(self, page: int = 1, page_size: int = 20) -> HistoryData:
        data = self._request("GET", f"/api/agent/history?address={self.address}&page={page}&pageSize={page_size}")
        return HistoryData(**data)

    # ---- Write ----

    def bet(self, side: str, amount: float) -> BetResult:
        if not self.private_key:
            raise PredixError("private_key required for betting")

        # Check market
        mkt = self.market()
        if not mkt.round.tradingOpen:
            raise TradingClosedError()

        # Build + sign + sponsor via Node.js subprocess
        public_key = self._get_public_key()
        build_data = self._request("POST", "/api/agent/build-tx", json={
            "action": "place-bet",
            "publicKey": public_key,
            "params": {"side": side, "amount": amount},
        })

        signed_hex = self._sign_tx(build_data["txHex"])
        sponsor_data = self._request("POST", "/api/sponsor", json={"txHex": signed_hex})

        return BetResult(
            txid=sponsor_data["txid"],
            roundId=build_data["details"].get("roundId", 0),
            side=side,
            amount=amount,
        )

    def mint(self) -> TxResult:
        return self._execute_action("mint")

    def approve(self) -> TxResult:
        return self._execute_action("approve")

    def _execute_action(self, action: str) -> TxResult:
        if not self.private_key:
            raise PredixError(f"private_key required for {action}")

        public_key = self._get_public_key()
        build_data = self._request("POST", "/api/agent/build-tx", json={
            "action": action,
            "publicKey": public_key,
            "params": {},
        })

        signed_hex = self._sign_tx(build_data["txHex"])
        sponsor_data = self._request("POST", "/api/sponsor", json={"txHex": signed_hex})
        return TxResult(txid=sponsor_data["txid"])

    def _get_public_key(self) -> str:
        script = """
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (pk) => {
  const { createStacksPrivateKey, pubKeyfromPrivKey, publicKeyToHex } = require('@stacks/transactions');
  console.log(publicKeyToHex(pubKeyfromPrivKey(createStacksPrivateKey(pk.trim()))));
  rl.close();
});
"""
        result = subprocess.run(
            ["node", "-e", script],
            input=self.private_key,
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            raise PredixError(f"Public key derivation failed: {result.stderr.strip()}")
        return result.stdout.strip()

    def _sign_tx(self, tx_hex: str) -> str:
        script = """
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const [pk, hex] = line.split(' ');
  const { deserializeTransaction, createStacksPrivateKey, TransactionSigner } = require('@stacks/transactions');
  const tx = deserializeTransaction(hex);
  const signer = new TransactionSigner(tx);
  signer.signOrigin(createStacksPrivateKey(pk));
  console.log(tx.serialize());
  rl.close();
});
"""
        result = subprocess.run(
            ["node", "-e", script],
            input=f"{self.private_key} {tx_hex}",
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            raise PredixError(f"Transaction signing failed: {result.stderr.strip()}")
        return result.stdout.strip()

    def close(self):
        self._http.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
