import type { Repository } from "typeorm";
import type { StellarPreparedOperation } from "@arcanetech/privacy-sdk-stellar";
import type { SafeDisplayMetadata } from "@arcanetech/privacy-sdk-relay";
import type { DemoEnv } from "../../config/env";
import {
  DEPOSIT_DISCLOSURE,
  PRIVATE_TRANSFER_DISCLOSURE,
  PUBLIC_WITHDRAW_DISCLOSURE,
} from "../disclosures";
import { HdAccountEntity } from "../../persistence/hd-account.entity";
import { WalletScalarEntity } from "../../persistence/wallet-scalar.entity";
import {
  remapRecipientOwners,
  isDeliverableOutputRecord,
  amountFromCoinNote,
  groupRecordsByOwner,
  markRecordsSpent,
  isNullifiersSpentError,
} from "../notes";
import { RelaySubmitService } from "../../relay/relay-submit.service";
import { importEsm } from "../../lib/esm";
import type { AccountClientRegistry } from "../clients";
import type { PrivacyWorkerJob, PrivacyWorkerResult } from "../jobs";

export class PrivacyJobRunner {
  constructor(
    private readonly env: DemoEnv,
    private readonly clients: AccountClientRegistry,
    private readonly relay: RelaySubmitService,
    private readonly accounts: Repository<HdAccountEntity>,
    private readonly scalars: Repository<WalletScalarEntity>,
  ) {}

  async run(job: PrivacyWorkerJob): Promise<PrivacyWorkerResult> {
    try {
      if (job.kind === "register") {
        return await this.register(job.publicKey);
      }
      if (job.kind === "deposit") {
        return await this.deposit(job.publicKey, BigInt(job.amountStroops));
      }
      if (job.kind === "transfer") {
        return await this.transfer(
          job.senderPublicKey,
          job.recipientPublicKey,
          BigInt(job.amountStroops),
        );
      }
      return await this.withdraw(job.publicKey, BigInt(job.amountStroops));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: message,
        ...(message.includes("Unauthenticated KYT inspect")
          ? { kytUnauthenticated: true }
          : {}),
      };
    }
  }

  private async register(publicKey: string): Promise<PrivacyWorkerResult> {
    await this.clients.refresh([publicKey]);
    const account = await this.requireAccount(publicKey);
    const client = this.clients.getClient(publicKey);
    const keypair = this.clients.getKeypair(publicKey);
    const stellar = await importEsm<
      typeof import("@arcanetech/privacy-sdk-stellar")
    >("@arcanetech/privacy-sdk-stellar");
    const domain = {
      networkPassphrase: this.env.networkPassphrase,
      poolContract: this.env.poolContract,
      registryContract: this.env.registryContract,
    };
    const nonce = stellar.DEFAULT_PRIVATE_ADDRESS_SIGN_NONCE;
    const message = stellar.buildPrivateAddressSignMessage(
      publicKey,
      domain,
      nonce,
    );
    const signatureHex = Buffer.from(
      keypair.sign(Buffer.from(message, "utf8")),
    ).toString("hex");
    const privateAddress = await stellar
      .getPrivacyPoolService()
      .generatePrivateAddressFromStellarSignature(signatureHex, domain);
    const scalarHex = await stellar.spendScalarHexFromStellarSignature(
      signatureHex,
      domain,
    );
    await client.saveWalletPrivateAddressRecord({
      owner: publicKey,
      nonce,
      privateAddress,
      createdAt: Date.now(),
    });
    await client.saveWalletPrivateAddressScalar({
      owner: publicKey,
      nonce,
      scalarHex,
    });
    await client.setWalletDefaultPrivateAddressNonce({
      owner: publicKey,
      nonce,
    });
    await this.scalars.save({
      owner: publicKey,
      privateAddress,
      scalarHex,
    });
    await client.registerPrivateAddress({
      owner: publicKey,
      walletPublicKey: publicKey,
      privateAddressStpl1: privateAddress,
    });
    const status = await client.checkRegistrationStatus({
      address: publicKey,
      walletPublicKey: publicKey,
    });
    if (status.status === "registered" && status.privateAddressStpl1) {
      await client.saveRegistryLookup({
        owner: publicKey,
        status: "registered",
        privateAddressStpl1: status.privateAddressStpl1,
      });
    }
    account.privateAddress = privateAddress;
    account.registered = true;
    await this.accounts.save(account);
    return {
      ok: true,
      kind: "register",
      privateAddress,
      fromAddress: publicKey,
    };
  }

  private async deposit(
    publicKey: string,
    amountStroops: bigint,
  ): Promise<PrivacyWorkerResult> {
    await this.clients.refresh([publicKey]);
    const account = await this.requireAccount(publicKey);
    const privateAddress = account.privateAddress;
    if (!privateAddress) {
      throw new Error("Account is not registered");
    }
    const client = this.clients.getClient(publicKey);
    await client.syncPoolMerkleState({
      poolContractId: this.env.poolContract,
      walletPublicKey: publicKey,
    });
    const operation = await client.deposit({
      from: publicKey,
      to: privateAddress,
      asset: this.env.assetId,
      amount: amountStroops,
      disclosure: DEPOSIT_DISCLOSURE,
    });
    if (operation.status !== "prepared") {
      throw new Error(operation.errors[0]?.message ?? "Deposit prepare failed");
    }
    const receipt = await operation.execute();
    const txId = receipt.operationId || "";
    return {
      ok: true,
      kind: "deposit",
      txId,
      fromAddress: publicKey,
      toAddress: privateAddress,
      amountStroops: amountStroops.toString(),
    };
  }

  private async transfer(
    senderPublicKey: string,
    recipientPublicKey: string,
    amountStroops: bigint,
  ): Promise<PrivacyWorkerResult> {
    await this.clients.refresh([senderPublicKey, recipientPublicKey]);
    const sender = await this.requireAccount(senderPublicKey);
    const recipient = await this.requireAccount(recipientPublicKey);
    const senderPrivateAddress = sender.privateAddress;
    const recipientPrivateAddress = recipient.privateAddress;
    if (!senderPrivateAddress || !recipientPrivateAddress) {
      throw new Error("Both accounts must be registered");
    }
    const client = this.clients.getClient(senderPublicKey);
    await client.syncPoolMerkleState({
      poolContractId: this.env.poolContract,
      walletPublicKey: senderPublicKey,
    });
    const resolved = await client.resolveTransferRecipient({
      recipientStellarAddress: recipientPublicKey,
      walletPublicKey: senderPublicKey,
    });
    const operation = await client.transfer({
      from: senderPrivateAddress,
      to: resolved.recipientPrivateAddressStpl1,
      asset: this.env.assetId,
      amount: amountStroops,
      disclosure: PRIVATE_TRANSFER_DISCLOSURE,
    });
    if (operation.status !== "prepared") {
      throw new Error(
        operation.errors[0]?.message ?? "Transfer prepare failed",
      );
    }
    const txId = await this.submitRelayAndFinalize({
      walletPublicKey: senderPublicKey,
      prepared: operation.prepared,
      execute: async () => {
        const receipt = await operation.execute();
        return { txId: receipt.operationId || "" };
      },
      display: {
        kind: "transfer",
        assetId: this.env.assetId,
        amountDisplay: Number(amountStroops) / 10_000_000,
        counterparty: recipientPublicKey,
        senderPrivateAddress,
      },
    });
    sender.sentCount = (BigInt(sender.sentCount) + 1n).toString();
    sender.sentVolumeStroops = (
      BigInt(sender.sentVolumeStroops) + amountStroops
    ).toString();
    await this.accounts.save(sender);
    return {
      ok: true,
      kind: "transfer",
      txId,
      fromAddress: senderPublicKey,
      toAddress: recipientPublicKey,
      amountStroops: amountStroops.toString(),
    };
  }

  private async withdraw(
    publicKey: string,
    amountStroops: bigint,
  ): Promise<PrivacyWorkerResult> {
    await this.clients.refresh([publicKey]);
    const account = await this.requireAccount(publicKey);
    const privateAddress = account.privateAddress;
    if (!privateAddress) {
      throw new Error("Account is not registered");
    }
    const client = this.clients.getClient(publicKey);
    await client.syncPoolMerkleState({
      poolContractId: this.env.poolContract,
      walletPublicKey: publicKey,
    });
    const operation = await client.withdraw({
      from: privateAddress,
      to: publicKey,
      asset: this.env.assetId,
      amount: amountStroops,
      disclosure: PUBLIC_WITHDRAW_DISCLOSURE,
    });
    if (operation.status !== "prepared") {
      throw new Error(
        operation.errors[0]?.message ?? "Withdraw prepare failed",
      );
    }
    const txId = await this.submitRelayAndFinalize({
      walletPublicKey: publicKey,
      prepared: operation.prepared,
      execute: async () => {
        const receipt = await operation.execute();
        return { txId: receipt.operationId || "" };
      },
      display: {
        kind: "withdraw",
        assetId: this.env.assetId,
        amountDisplay: Number(amountStroops) / 10_000_000,
        counterparty: publicKey,
        senderPrivateAddress: privateAddress,
      },
    });
    return {
      ok: true,
      kind: "withdraw",
      txId,
      fromAddress: publicKey,
      toAddress: publicKey,
      amountStroops: amountStroops.toString(),
    };
  }

  private async requireAccount(publicKey: string): Promise<HdAccountEntity> {
    const account = await this.accounts.findOneBy({ publicKey });
    if (!account) {
      throw new Error(`Unknown account ${publicKey}`);
    }
    return account;
  }

  private async submitRelayAndFinalize(input: {
    walletPublicKey: string;
    prepared: StellarPreparedOperation;
    execute: () => Promise<{ txId: string }>;
    display: SafeDisplayMetadata;
  }): Promise<string> {
    try {
      const txId = await this.relay.submitPrepared(input);
      await this.deliverOutputs(input.prepared, input.walletPublicKey, txId);
      await this.retireConsumedRecords(input.prepared, input.walletPublicKey);
      return txId;
    } catch (error) {
      if (isNullifiersSpentError(error)) {
        await this.retireConsumedRecords(input.prepared, input.walletPublicKey);
      }
      throw error;
    }
  }

  private async retireConsumedRecords(
    prepared: StellarPreparedOperation,
    senderPublicKey: string,
  ): Promise<void> {
    const consumed = markRecordsSpent(prepared.consumedRecords);
    if (consumed.length === 0) {
      return;
    }
    const client = this.clients.getClient(senderPublicKey);
    await client.markPrivateRecordsStatus(consumed, "spent");
    await client.pruneConsumedPrivateRecords();
  }

  private async deliverOutputs(
    prepared: StellarPreparedOperation,
    senderPublicKey: string,
    txId: string,
  ): Promise<void> {
    const rows = await this.accounts.find();
    const mapped = remapRecipientOwners(
      prepared.outputRecords,
      rows
        .filter((row) => row.privateAddress)
        .map((row) => ({
          publicKey: row.publicKey,
          privateAddress: row.privateAddress as string,
        })),
      senderPublicKey,
    );
    const deliverable = mapped.filter((record) =>
      isDeliverableOutputRecord(record),
    );
    if (deliverable.length === 0) {
      return;
    }
    const finalized = deliverable.map((record) => ({
      ...record,
      amount: amountFromCoinNote(record),
      status: "finalized" as const,
      txHash: txId,
    }));
    for (const [owner, records] of groupRecordsByOwner(finalized)) {
      await this.clients.getClient(owner).upsertPrivateRecords(records);
    }
  }
}
