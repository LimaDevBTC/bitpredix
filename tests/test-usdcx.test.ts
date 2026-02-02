import { Cl } from "@stacks/transactions";
import { describe, expect, it } from "vitest";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1") ?? deployer;
const wallet2 = accounts.get("wallet_2") ?? deployer;

const MINT_AMOUNT = 1_000_000_000; // 1 000 USD, 6 decimais

describe("test-usdcx", () => {
  describe("get-name, get-symbol, get-decimals", () => {
    it("retorna nome Test USDCx", () => {
      const { result } = simnet.callReadOnlyFn("test-usdcx", "get-name", [], deployer);
      expect(result).toBeOk(Cl.stringAscii("Test USDCx"));
    });
    it("retorna símbolo USDCx", () => {
      const { result } = simnet.callReadOnlyFn("test-usdcx", "get-symbol", [], deployer);
      expect(result).toBeOk(Cl.stringAscii("USDCx"));
    });
    it("retorna 6 decimais", () => {
      const { result } = simnet.callReadOnlyFn("test-usdcx", "get-decimals", [], deployer);
      expect(result).toBeOk(Cl.uint(6));
    });
  });

  describe("get-balance e get-total-supply", () => {
    it("saldo inicial é 0", () => {
      const { result } = simnet.callReadOnlyFn("test-usdcx", "get-balance", [Cl.principal(wallet1)], deployer);
      expect(result).toBeOk(Cl.uint(0));
    });
    it("total-supply inicial é 0", () => {
      const { result } = simnet.callReadOnlyFn("test-usdcx", "get-total-supply", [], deployer);
      expect(result).toBeOk(Cl.uint(0));
    });
  });

  describe("get-minted", () => {
    it("get-minted antes de mint retorna 0", () => {
      const { result } = simnet.callReadOnlyFn("test-usdcx", "get-minted", [Cl.principal(wallet1)], deployer);
      expect(result).toBeUint(0);
    });
  });

  describe("mint", () => {
    it("mint dá 1 000 USD (MINT_AMOUNT) ao tx-sender", () => {
      const { result } = simnet.callPublicFn("test-usdcx", "mint", [], wallet1);
      expect(result).toBeOk(Cl.bool(true));

      const bal = simnet.callReadOnlyFn("test-usdcx", "get-balance", [Cl.principal(wallet1)], deployer);
      expect(bal.result).toBeOk(Cl.uint(MINT_AMOUNT));

      const total = simnet.callReadOnlyFn("test-usdcx", "get-total-supply", [], deployer);
      expect(total.result).toBeOk(Cl.uint(MINT_AMOUNT));

      const minted = simnet.callReadOnlyFn("test-usdcx", "get-minted", [Cl.principal(wallet1)], deployer);
      expect(minted.result).toBeUint(MINT_AMOUNT);
    });
    it("segundo mint do mesmo principal falha com err u10", () => {
      simnet.callPublicFn("test-usdcx", "mint", [], wallet2);
      const { result } = simnet.callPublicFn("test-usdcx", "mint", [], wallet2);
      expect(result).toBeErr(Cl.uint(10));
    });
  });

  describe("transfer", () => {
    it("transfer de deployer para contrato oracle", () => {
      simnet.callPublicFn("test-usdcx", "mint", [], deployer);
      const amount = 100_000_000;
      const { result } = simnet.callPublicFn(
        "test-usdcx",
        "transfer",
        [Cl.uint(amount), Cl.principal(deployer), Cl.contractPrincipal(deployer, "oracle"), Cl.none()],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));
      const bal = simnet.callReadOnlyFn("test-usdcx", "get-balance", [Cl.principal(deployer)], deployer);
      expect(bal.result).toBeOk(Cl.uint(MINT_AMOUNT - amount));
    });
    it("transfer de outro que não o sender falha", () => {
      const other = accounts.get("wallet_1") ?? accounts.get("wallet_2");
      if (!other || other === deployer) {
        expect(true).toBe(true); // skip: precisa wallet_1/wallet_2
        return;
      }
      simnet.callPublicFn("test-usdcx", "mint", [], deployer);
      const { result } = simnet.callPublicFn(
        "test-usdcx",
        "transfer",
        [Cl.uint(1), Cl.principal(deployer), Cl.principal(other), Cl.none()],
        other
      );
      expect(result).toBeErr(Cl.uint(4));
    });
  });

  describe("approve e transfer-from", () => {
    it("transfer-from sem allowance para o caller falha err u5", () => {
      const from = accounts.get("wallet_1");
      if (!from || from === deployer) {
        expect(true).toBe(true);
        return;
      }
      simnet.callPublicFn("test-usdcx", "mint", [], from);
      simnet.callPublicFn("test-usdcx", "approve", [Cl.principal(deployer), Cl.uint(50_000_000)], from);
      const { result } = simnet.callPublicFn(
        "test-usdcx",
        "transfer-from",
        [Cl.principal(from), Cl.principal(deployer), Cl.uint(50_000_000), Cl.none()],
        deployer
      );
      expect(result).toBeErr(Cl.uint(5));
    });

    it("approve e transfer-from: owner aprova deployer e deployer chama transfer-from", () => {
      simnet.callPublicFn("test-usdcx", "mint", [], deployer);
      const amount = 50_000_000;
      const to = Cl.contractPrincipal(deployer, "oracle");
      simnet.callPublicFn("test-usdcx", "approve", [Cl.principal(deployer), Cl.uint(amount)], deployer);
      const { result } = simnet.callPublicFn(
        "test-usdcx",
        "transfer-from",
        [Cl.principal(deployer), to, Cl.uint(amount), Cl.none()],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));
    });
  });
});
