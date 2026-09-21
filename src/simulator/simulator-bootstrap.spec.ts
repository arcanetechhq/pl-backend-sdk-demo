import { runSimulatorBootstrap } from "./simulator-bootstrap";
import type { HdAccountEntity } from "../persistence/hd-account.entity";

function account(publicKey: string): HdAccountEntity {
  return {
    hdIndex: 0,
    publicKey,
    privateAddress: "stpl1a",
    funded: true,
    registered: true,
    sentCount: "0",
    sentVolumeStroops: "0",
  } as HdAccountEntity;
}

describe("runSimulatorBootstrap", () => {
  it("deposits when private balance is empty, then starts", async () => {
    const first = account("GA");
    const deposit = jest.fn(async () => "tx-deposit");
    const start = jest.fn(async () => undefined);
    await runSimulatorBootstrap({
      depositAmountXlm: 10,
      setup: async () => [first],
      privateBalanceStroops: async () => 0n,
      deposit,
      markStatus: async () => undefined,
      start,
      append: async () => undefined,
    });
    expect(deposit).toHaveBeenCalledWith(first, 100_000_000n);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("skips deposit when unspent notes already exist", async () => {
    const deposit = jest.fn(async () => "tx-deposit");
    await runSimulatorBootstrap({
      depositAmountXlm: 10,
      setup: async () => [account("GA")],
      privateBalanceStroops: async () => 1n,
      deposit,
      markStatus: async () => undefined,
      start: async () => undefined,
      append: async () => undefined,
    });
    expect(deposit).not.toHaveBeenCalled();
  });
});
