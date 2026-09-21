import { Injectable, Logger } from "@nestjs/common";
import { loadDemoEnv } from "../config/env";
import { AccountsService } from "../accounts/accounts.service";
import { OperationLogService } from "../operation-log";
import { PrivacyOperationsService } from "../privacy/operations";
import { SimulatorService } from "./simulator.service";
import { runSimulatorBootstrap } from "./simulator-bootstrap";

@Injectable()
export class SimulatorBootstrapService {
  private readonly logger = new Logger(SimulatorBootstrapService.name);
  private readonly env = loadDemoEnv();

  constructor(
    private readonly accounts: AccountsService,
    private readonly operations: PrivacyOperationsService,
    private readonly simulator: SimulatorService,
    private readonly logs: OperationLogService,
  ) {}

  async start(): Promise<void> {
    try {
      await runSimulatorBootstrap({
        depositAmountXlm: this.env.depositAmountXlm,
        setup: () => this.accounts.setup(),
        privateBalanceStroops: (publicKey) =>
          this.operations.privateBalanceStroops(publicKey),
        deposit: (account, amountStroops) =>
          this.operations.deposit(account, amountStroops),
        markStatus: (status) => this.simulator.markStatus(status),
        start: () => this.simulator.start(),
        append: (entry) => this.logs.append(entry),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(message);
      try {
        await this.simulator.markStatus("error");
        await this.logs.append({
          kind: "error",
          message: "Bootstrap failed",
          error: message,
        });
      } catch (statusError: unknown) {
        this.logger.error(
          statusError instanceof Error
            ? statusError.message
            : String(statusError),
        );
      }
    }
  }
}
