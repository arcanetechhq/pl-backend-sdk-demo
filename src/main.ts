import "reflect-metadata";
import "./config/load-env";
import { installKytInspectFetchGuard } from "./privacy/kyt";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { AppModule } from "./app.module";
import { loadDemoEnv } from "./config/env";
import { JsonErrorFilter } from "./http/json-error.filter";
import { SimulatorBootstrapService } from "./simulator/simulator-bootstrap.service";

installKytInspectFetchGuard();

async function bootstrap(): Promise<void> {
  const env = loadDemoEnv();
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new JsonErrorFilter());
  app.use(json({ limit: "2mb" }));
  await app.listen(env.port);
  void app.get(SimulatorBootstrapService).start();
}

void bootstrap();
