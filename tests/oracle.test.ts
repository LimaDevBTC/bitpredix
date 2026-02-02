import { Cl } from "@stacks/transactions";
import { describe, expect, it } from "vitest";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
// Em simnet, deployer só é ORACLE se settings/Simnet.toml usar o mesmo mnemonic que Testnet.toml
const wallet1 = accounts.get("wallet_1") ?? deployer;

describe("oracle", () => {
  describe("get-price", () => {
    it("get-price antes de set-price retorna none", () => {
      const { result } = simnet.callReadOnlyFn("oracle", "get-price", [Cl.uint(1)], deployer);
      expect(result).toBeNone();
    });
  });

  describe("set-price", () => {
    it.skip("ORACLE (deployer) pode fazer set-price — exige deployer=ORACLE em Simnet.toml", () => {
      const { result } = simnet.callPublicFn("oracle", "set-price", [Cl.uint(1), Cl.uint(100_000_000)], deployer);
      expect(result).toBeOk(Cl.bool(true));

      const { result: price } = simnet.callReadOnlyFn("oracle", "get-price", [Cl.uint(1)], deployer);
      expect(price).toBeSome(Cl.uint(100_000_000));
    });

    it.skip("set-price overwrite falha err u1 — exige deployer=ORACLE", () => {
      simnet.callPublicFn("oracle", "set-price", [Cl.uint(2), Cl.uint(200_000_000)], deployer);
      const { result } = simnet.callPublicFn("oracle", "set-price", [Cl.uint(2), Cl.uint(300_000_000)], deployer);
      expect(result).toBeErr(Cl.uint(1));
    });

    it("não-ORACLE falha err u2", () => {
      const { result } = simnet.callPublicFn("oracle", "set-price", [Cl.uint(10), Cl.uint(50_000_000)], wallet1);
      expect(result).toBeErr(Cl.uint(2));
    });
  });
});
