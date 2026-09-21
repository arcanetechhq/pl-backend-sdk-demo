export function canRunSimulator(accounts: { registered: boolean }[]): boolean {
  return accounts.filter((account) => account.registered).length >= 2;
}

export const SIMULATOR_NOT_READY_MESSAGE =
  "Need at least two registered accounts with a private deposit.";

export function assertSimulatorReady(
  registeredCount: number,
  depositedStroops: bigint,
): void {
  if (registeredCount < 2 || depositedStroops <= 0n) {
    throw new Error(SIMULATOR_NOT_READY_MESSAGE);
  }
}

export function shouldDepositIfEmpty(balanceStroops: bigint): boolean {
  return balanceStroops <= 0n;
}

export function isMissingPrivateRecordsError(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    message.includes("enough private records") ||
    message.includes(
      "Instructed amount and Required Fee exceed available note value",
    ) ||
    message.includes("Required Fee leaves no spendable deposit note")
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "";
}

export class IntervalLoop {
  private stopped = true;
  private generation = 0;
  private inFlight: Promise<void> = Promise.resolve();
  private wake: NodeJS.Timeout | undefined;
  private wakeResolve: (() => void) | undefined;

  start(intervalMs: number, onTick: () => Promise<void> | void): void {
    this.stop();
    const generation = this.generation;
    this.stopped = false;
    void this.run(generation, intervalMs, onTick);
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    this.clearWake();
  }

  isActive(): boolean {
    return !this.stopped;
  }

  private async run(
    generation: number,
    intervalMs: number,
    onTick: () => Promise<void> | void,
  ): Promise<void> {
    await this.inFlight;
    if (this.stopped || this.generation !== generation) {
      return;
    }
    while (!this.stopped && this.generation === generation) {
      const started = Date.now();
      const work = Promise.resolve(onTick());
      this.inFlight = work;
      await work;
      if (this.stopped || this.generation !== generation) {
        return;
      }
      await this.sleep(Math.max(0, intervalMs - (Date.now() - started)));
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.wakeResolve = resolve;
      this.wake = setTimeout(() => {
        this.wake = undefined;
        this.wakeResolve = undefined;
        resolve();
      }, ms);
    });
  }

  private clearWake(): void {
    if (this.wake) {
      clearTimeout(this.wake);
      this.wake = undefined;
    }
    const resolve = this.wakeResolve;
    this.wakeResolve = undefined;
    resolve?.();
  }
}

export class OverlappingLoop {
  private stopped = true;
  private generation = 0;
  private wake: NodeJS.Timeout | undefined;
  private wakeResolve: (() => void) | undefined;

  start(intervalMs: number, onTick: () => Promise<void> | void): void {
    this.stop();
    const generation = this.generation;
    this.stopped = false;
    void this.run(generation, intervalMs, onTick);
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    this.clearWake();
  }

  isActive(): boolean {
    return !this.stopped;
  }

  private async run(
    generation: number,
    intervalMs: number,
    onTick: () => Promise<void> | void,
  ): Promise<void> {
    while (!this.stopped && this.generation === generation) {
      const started = Date.now();
      await onTick();
      if (this.stopped || this.generation !== generation) {
        return;
      }
      await this.sleep(Math.max(0, intervalMs - (Date.now() - started)));
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.wakeResolve = resolve;
      this.wake = setTimeout(() => {
        this.wake = undefined;
        this.wakeResolve = undefined;
        resolve();
      }, ms);
    });
  }

  private clearWake(): void {
    if (this.wake) {
      clearTimeout(this.wake);
      this.wake = undefined;
    }
    const resolve = this.wakeResolve;
    this.wakeResolve = undefined;
    resolve?.();
  }
}
