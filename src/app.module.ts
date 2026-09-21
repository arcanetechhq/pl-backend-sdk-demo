import "./config/load-env";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ServeStaticModule } from "@nestjs/serve-static";
import { join } from "node:path";
import { loadDemoEnv } from "./config/env";
import { AccountsService } from "./accounts/accounts.service";
import { DashboardController } from "./dashboard/dashboard.controller";
import { HdAccountEntity } from "./persistence/hd-account.entity";
import { OperationLogEntity } from "./persistence/operation-log.entity";
import { PendingPrivateOperationEntity } from "./persistence/pending-operation.entity";
import { SdkStateRow } from "./persistence/sdk-state.entity";
import { SimulatorStateEntity } from "./persistence/simulator-state.entity";
import { WalletScalarEntity } from "./persistence/wallet-scalar.entity";
import { PrivacyClientService } from "./privacy/clients";
import { ProtocolFeeService } from "./privacy/protocol-fee";
import { PrivacyOperationsService } from "./privacy/operations";
import { ProveWorkerPool } from "./privacy/proving";
import { OperationLogService } from "./operation-log";
import { SimulatorService } from "./simulator/simulator.service";
import { SimulatorBootstrapService } from "./simulator/simulator-bootstrap.service";

const env = loadDemoEnv();

const entities = [
  SdkStateRow,
  HdAccountEntity,
  SimulatorStateEntity,
  OperationLogEntity,
  PendingPrivateOperationEntity,
  WalletScalarEntity,
];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: "postgres",
      url: env.databaseUrl,
      entities,
      synchronize: true,
      ...(env.databaseCA ? { ssl: { ca: env.databaseCA } } : {}),
    }),
    TypeOrmModule.forFeature(entities),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), "public"),
      exclude: ["/api/{*path}"],
    }),
  ],
  controllers: [DashboardController],
  providers: [
    PrivacyClientService,
    ProtocolFeeService,
    ProveWorkerPool,
    PrivacyOperationsService,
    OperationLogService,
    AccountsService,
    SimulatorService,
    SimulatorBootstrapService,
  ],
})
export class AppModule {}
