import { Cl } from "@stacks/transactions";
import { describe, expect, it, beforeEach } from "vitest";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1") ?? deployer;

const ROUND_ID = 10000; // trading-closes-at = 10060 - 12 = 10048; block-time no simnet deve ficar abaixo
const PRICE_START = 97_000_000; // 97 USD
const PRICE_END = 98_000_000;   // 98 USD -> outcome UP
const BET = 2_000_000;          // 2 USD, >= MIN_BET

describe("bitpredix", () => {
  describe("create-round", () => {
    it.skip("ORACLE (deployer) cria round — exige deployer=ORACLE em Simnet.toml", () => {
      const { result } = simnet.callPublicFn("bitpredix", "create-round", [Cl.uint(ROUND_ID), Cl.uint(PRICE_START)], deployer);
      expect(result).toBeOk(Cl.bool(true));
    });

    it.skip("create-round idempotente — exige deployer=ORACLE", () => {
      simnet.callPublicFn("bitpredix", "create-round", [Cl.uint(ROUND_ID), Cl.uint(PRICE_START)], deployer);
      const { result } = simnet.callPublicFn("bitpredix", "create-round", [Cl.uint(ROUND_ID), Cl.uint(PRICE_START)], deployer);
      expect(result).toBeOk(Cl.bool(true));
    });

    it("não-ORACLE falha err u401", () => {
      const { result } = simnet.callPublicFn("bitpredix", "create-round", [Cl.uint(999), Cl.uint(90_000_000)], wallet1);
      expect(result).toBeErr(Cl.uint(401));
    });
  });

  describe("place-bet", () => {
    beforeEach(() => {
      simnet.callPublicFn("bitpredix", "create-round", [Cl.uint(ROUND_ID), Cl.uint(PRICE_START)], deployer);
      simnet.callPublicFn("test-usdcx", "mint", [], wallet1);
      simnet.callPublicFn("test-usdcx", "approve", [Cl.contractPrincipal(deployer, "bitpredix"), Cl.uint(BET)], wallet1);
    });

    it.skip("place-bet UP com approve — exige deployer=ORACLE (create-round)", () => {
      const { result } = simnet.callPublicFn("bitpredix", "place-bet", [Cl.uint(ROUND_ID), Cl.stringAscii("UP"), Cl.uint(BET)], wallet1);
      expect(result).toBeOk(Cl.bool(true));
    });

    it.skip("place-bet DOWN — exige deployer=ORACLE", () => {
      simnet.callPublicFn("test-usdcx", "approve", [Cl.contractPrincipal(deployer, "bitpredix"), Cl.uint(BET)], wallet1);
      const { result } = simnet.callPublicFn("bitpredix", "place-bet", [Cl.uint(ROUND_ID), Cl.stringAscii("DOWN"), Cl.uint(BET)], wallet1);
      expect(result).toBeOk(Cl.bool(true));
    });
  });

  describe("place-bet sem approve", () => {
    it.skip("falha no transfer-from (err u5) — exige deployer=ORACLE para create-round", () => {
      simnet.callPublicFn("bitpredix", "create-round", [Cl.uint(ROUND_ID), Cl.uint(PRICE_START)], deployer);
      simnet.callPublicFn("test-usdcx", "mint", [], wallet1);
      const { result } = simnet.callPublicFn("bitpredix", "place-bet", [Cl.uint(ROUND_ID), Cl.stringAscii("UP"), Cl.uint(BET)], wallet1);
      expect(result).toBeErr(Cl.uint(5));
    });
  });

  describe("resolve-round e claim-winnings", () => {
    it.skip("resolve-round e claim-winnings (fluxo completo) — exige deployer=ORACLE", () => {
      simnet.callPublicFn("bitpredix", "create-round", [Cl.uint(ROUND_ID), Cl.uint(PRICE_START)], deployer);
      simnet.callPublicFn("oracle", "set-price", [Cl.uint(ROUND_ID), Cl.uint(PRICE_END)], deployer);

      simnet.callPublicFn("test-usdcx", "mint", [], wallet1);
      simnet.callPublicFn("test-usdcx", "approve", [Cl.contractPrincipal(deployer, "bitpredix"), Cl.uint(BET)], wallet1);
      simnet.callPublicFn("bitpredix", "place-bet", [Cl.uint(ROUND_ID), Cl.stringAscii("UP"), Cl.uint(BET)], wallet1);

      // CORRIGIDO: resolve-round agora recebe price-at-end como segundo argumento
      const { result: resRes } = simnet.callPublicFn("bitpredix", "resolve-round", [Cl.uint(ROUND_ID), Cl.uint(PRICE_END)], deployer);
      expect(resRes).toBeOk(Cl.bool(true));

      const { result: resClaim } = simnet.callPublicFn("bitpredix", "claim-winnings", [Cl.uint(ROUND_ID)], wallet1);
      expect(resClaim).toBeOk(Cl.bool(true));
    });
  });
});
