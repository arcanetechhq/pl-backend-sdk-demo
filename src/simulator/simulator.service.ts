import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { loadDemoEnv, intervalMsFromMinutes } from "../config/env";
import { AsyncMutex } from "../lib/async";
import { xlmToStroops } from "../lib/money";
import { HdAccountEntity } from "../persistence/hd-account.entity";
import {
  SimulatorStateEntity,
  type SimulatorStatus,
} from "../persistence/simulator-state.entity";
import { AccountsService } from "../accounts/accounts.service";
import { PrivacyOperationsService } from "../privacy/operations";
import { OperationLogService } from "../operation-log";
import {
  assertSimulatorReady,
  canRunSimulator,
  OverlappingLoop,
  isMissingPrivateRecordsError,
  SIMULATOR_NOT_READY_MESSAGE,
} from "./simulator-rules";
import {
  maxSimulatorConcurrency,
  pickDisjointTransferPair,
} from "./transfer-occupancy";

const SIMULATOR_ID = "default";

@Injectable()
export class SimulatorService implements OnModuleDestroy {
  private readonly env = loadDemoEnv();
  private readonly loop = new OverlappingLoop();
  private readonly busy = new Set<string>();
  private readonly inFlight = new Set<Promise<void>>();
  private readonly statsMutex = new AsyncMutex();
  private running = false;

  constructor(
    @InjectRepository(SimulatorStateEntity)
    private readonly state: Repository<SimulatorStateEntity>,
    private readonly accounts: AccountsService,
    private readonly operations: PrivacyOperationsService,
    private readonly logs: OperationLogService,
  ) {}

  onModuleDestroy(): void {
    this.stopTimer();
  }

  async getState(): Promise<SimulatorStateEntity> {
    let row = await this.state.findOneBy({ id: SIMULATOR_ID });
    if (!row) {
      row = this.state.create({
        id: SIMULATOR_ID,
        status: "stopped",
        transactionCount: "0",
        totalVolumeStroops: "0",
        intervalMinutes: this.env.txIntervalMinutes,
        minAmountXlm: String(this.env.txAmountXlm),
        maxAmountXlm: String(this.env.txAmountXlm),
      });
      await this.state.save(row);
    }
    return row;
  }

  async markStatus(status: SimulatorStatus): Promise<void> {
    const row = await this.getState();
    row.status = status;
    await this.state.save(row);
  }

  async start(): Promise<SimulatorStateEntity> {
    const accounts = await this.accounts.list();
    const registered = accounts.filter((account) => account.registered);
    const first = registered[0];
    if (!first) {
      throw new Error(SIMULATOR_NOT_READY_MESSAGE);
    }
    const deposited = await this.operations.privateBalanceStroops(
      first.publicKey,
    );
    assertSimulatorReady(registered.length, deposited);
    const amountXlm = this.env.txAmountXlm;
    const intervalMinutes = this.env.txIntervalMinutes;
    const row = await this.getState();
    row.status = "running";
    row.intervalMinutes = intervalMinutes;
    row.minAmountXlm = String(amountXlm);
    row.maxAmountXlm = String(amountXlm);
    await this.state.save(row);
    this.stopTimer();
    this.running = true;
    const intervalMs = intervalMsFromMinutes(intervalMinutes);
    this.loop.start(intervalMs, async () => {
      if (!this.running) {
        return;
      }
      try {
        await this.tick();
      } catch (error: unknown) {
        await this.logs.append({
          kind: "error",
          message: "Simulator tick failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    await this.logs.append({
      kind: "simulator",
      message: `Started every ${intervalMinutes} min`,
    });
    return row;
  }

  async stop(): Promise<SimulatorStateEntity> {
    this.stopTimer();
    await Promise.all([...this.inFlight]);
    const row = await this.getState();
    row.status = "stopped";
    await this.state.save(row);
    await this.logs.append({ kind: "simulator", message: "Stopped" });
    return row;
  }

  canRun(accounts: HdAccountEntity[]): boolean {
    return canRunSimulator(accounts);
  }

  maxInFlight(registeredCount: number): number {
    return maxSimulatorConcurrency(
      registeredCount,
      this.operations.proveWorkerCount(),
    );
  }

  private stopTimer(): void {
    this.loop.stop();
    this.running = false;
  }

  private async tick(): Promise<void> {
    if (!this.running) {
      return;
    }
    const row = await this.getState();
    const accounts = await this.accounts.list();
    const registered = accounts.filter(
      (account) => account.registered && account.privateAddress,
    );
    const maxInFlight = this.maxInFlight(registered.length);
    if (this.inFlight.size >= maxInFlight) {
      return;
    }
    const min = xlmToStroops(row.minAmountXlm);
    const max = xlmToStroops(row.maxAmountXlm);
    const amount = randomAmount(min, max);
    const funded: HdAccountEntity[] = [];
    for (const account of registered) {
      if (this.busy.has(account.publicKey) || !account.privateAddress) {
        continue;
      }
      const balance = await this.operations.spendablePrivateStroops(
        account.publicKey,
        account.privateAddress,
      );
      if (balance >= amount) {
        funded.push(account);
      }
    }
    const pair = pickDisjointTransferPair({
      funded,
      registered,
      busy: this.busy,
      key: (account) => account.publicKey,
    });
    if (!pair) {
      if (this.inFlight.size === 0) {
        await this.logs.append({
          kind: "simulator",
          message: "No pair with enough private balance; skipping tick",
        });
      }
      return;
    }
    this.busy.add(pair.sender.publicKey);
    this.busy.add(pair.recipient.publicKey);
    const work = this.runTransfer(pair.sender, pair.recipient, amount).finally(
      () => {
        this.busy.delete(pair.sender.publicKey);
        this.busy.delete(pair.recipient.publicKey);
        this.inFlight.delete(work);
      },
    );
    this.inFlight.add(work);
  }

  private async runTransfer(
    sender: HdAccountEntity,
    recipient: HdAccountEntity,
    amount: bigint,
  ): Promise<void> {
    try {
      await this.operations.transfer({
        sender,
        recipient,
        amountStroops: amount,
      });
    } catch (error) {
      if (isMissingPrivateRecordsError(error)) {
        await this.logs.append({
          kind: "simulator",
          message: "No spendable notes for this amount; skipping tick",
        });
        return;
      }
      await this.logs.append({
        kind: "error",
        message: "Simulator transfer failed",
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    await this.statsMutex.runExclusive(async () => {
      const row = await this.getState();
      row.transactionCount = (BigInt(row.transactionCount) + 1n).toString();
      row.totalVolumeStroops = (
        BigInt(row.totalVolumeStroops) + amount
      ).toString();
      await this.state.save(row);
    });
  }
}

function randomAmount(min: bigint, max: bigint): bigint {
  if (max <= min) {
    return min;
  }
  const span = max - min;
  const jitter = BigInt(Math.floor(Math.random() * Number(span + 1n)));
  return min + jitter;
}
