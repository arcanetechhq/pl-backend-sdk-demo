import { xlmToStroops } from "../lib/money";
import { shouldDepositIfEmpty } from "./simulator-rules";
import type { HdAccountEntity } from "../persistence/hd-account.entity";
import type { SimulatorStatus } from "../persistence/simulator-state.entity";

export type SimulatorBootstrapPorts = {
  depositAmountXlm: number;
  setup: () => Promise<HdAccountEntity[]>;
  privateBalanceStroops: (publicKey: string) => Promise<bigint>;
  deposit: (account: HdAccountEntity, amountStroops: bigint) => Promise<string>;
  markStatus: (status: SimulatorStatus) => Promise<void>;
  start: () => Promise<unknown>;
  append: (entry: {
    kind: string;
    message: string;
    error?: string;
  }) => Promise<void>;
};

export async function runSimulatorBootstrap(
  ports: SimulatorBootstrapPorts,
): Promise<void> {
  await ports.markStatus("starting");
  await ports.append({
    kind: "simulator",
    message: "Bootstrapping accounts",
  });
  const accounts = await ports.setup();
  const first = accounts[0];
  if (!first) {
    throw new Error("Setup did not produce any accounts.");
  }
  const balance = await ports.privateBalanceStroops(first.publicKey);
  if (shouldDepositIfEmpty(balance)) {
    await ports.deposit(first, xlmToStroops(ports.depositAmountXlm));
  }
  await ports.start();
}
