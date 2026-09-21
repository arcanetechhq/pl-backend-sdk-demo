import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { loadDemoEnv } from "../../config/env";
import { KeyedAsyncMutex } from "../../lib/async";
import { SdkStateRow } from "../../persistence/sdk-state.entity";
import {
  loadAccountStateTree,
  privateBalanceStroopsFromRecords,
  promoteSharedPoolSnapshot,
} from "../state";
import { importEsm } from "../../lib/esm";
import { assertKytInspectLooksLikeJson } from "../kyt";
import {
  spendableTransferStroops,
  transactionNoteLayoutFromSdk,
  type TransactionNoteLayout,
} from "../notes";

@Injectable()
export class PrivacyClientService implements OnModuleInit {
  private readonly logger = new Logger(PrivacyClientService.name);
  private readonly env = loadDemoEnv();
  private readonly mutex = new KeyedAsyncMutex();
  private layout: TransactionNoteLayout | undefined;
  private ready = false;

  constructor(
    @InjectRepository(SdkStateRow)
    private readonly sdkState: Repository<SdkStateRow>,
  ) {}

  isReady(): boolean {
    return this.ready;
  }

  getTransactionLayout(): TransactionNoteLayout {
    if (!this.layout) {
      throw new Error("Transaction layout is not ready.");
    }
    return this.layout;
  }

  runExclusive<T>(
    publicKeys: string | string[],
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.mutex.runExclusive(publicKeys, fn);
  }

  async privateBalanceStroops(owner: string): Promise<bigint> {
    const records = await this.readPrivateRecords(owner);
    return privateBalanceStroopsFromRecords(records, owner);
  }

  async spendablePrivateStroops(
    owner: string,
    privateAddress: string,
  ): Promise<bigint> {
    const records = await this.readPrivateRecords(owner);
    return spendableTransferStroops(
      records,
      privateAddress,
      this.getTransactionLayout().nIns,
    );
  }

  async onModuleInit(): Promise<void> {
    await assertKytInspectLooksLikeJson(this.env.kytApiBaseUrl);
    const zk = await importEsm<
      typeof import("@arcanetech/stellar-privacy-pool-zk-sdk")
    >("@arcanetech/stellar-privacy-pool-zk-sdk");
    this.layout = transactionNoteLayoutFromSdk(
      zk.layoutForKnownNonce(this.env.zkConfigNonce),
    );
    await promoteSharedPoolSnapshot(this.sdkState);
    this.ready = true;
    this.logger.log(
      `Privacy read path ready (layout ${this.layout.nIns}x${this.layout.nOuts}, nonce ${this.env.zkConfigNonce.toString()})`,
    );
  }

  private async readPrivateRecords(owner: string) {
    const stellar = await importEsm<
      typeof import("@arcanetech/privacy-sdk-stellar")
    >("@arcanetech/privacy-sdk-stellar");
    const tree = await loadAccountStateTree(this.sdkState, owner);
    return stellar.readPrivateRecordsFromStateSnapshot(tree);
  }
}
