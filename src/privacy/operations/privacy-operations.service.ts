import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { HdAccountEntity } from "../../persistence/hd-account.entity";
import { PrivacyClientService } from "../clients";
import { ProveWorkerPool } from "../proving";
import { OperationLogService } from "../../operation-log";
import type { PrivacyWorkerJob } from "../jobs";
import {
  ProtocolFeeService,
  protocolFeeLogSuffix,
  remainingAfterRequiredFee,
  requiredFeeStroops,
  type ProtocolFeeKind,
} from "../protocol-fee";

@Injectable()
export class PrivacyOperationsService {
  constructor(
    private readonly privacy: PrivacyClientService,
    private readonly workers: ProveWorkerPool,
    private readonly logs: OperationLogService,
    private readonly fees: ProtocolFeeService,
    @InjectRepository(HdAccountEntity)
    private readonly accounts: Repository<HdAccountEntity>,
  ) {}

  async registerAccount(account: HdAccountEntity): Promise<string> {
    const result = await this.runJob([account.publicKey], {
      kind: "register",
      publicKey: account.publicKey,
    });
    const privateAddress = result.privateAddress;
    if (!privateAddress) {
      throw new Error("Register did not return a private address");
    }
    account.privateAddress = privateAddress;
    account.registered = true;
    await this.logs.append({
      kind: "register",
      message: `Registered ${account.publicKey}`,
      fromAddress: account.publicKey,
    });
    return privateAddress;
  }

  async deposit(
    account: HdAccountEntity,
    amountStroops: bigint,
  ): Promise<string> {
    if (!account.privateAddress) {
      throw new BadRequestException("Account is not registered");
    }
    const feeStroops = await this.requireDepositLeavesNote(amountStroops);
    const result = await this.runJob([account.publicKey], {
      kind: "deposit",
      publicKey: account.publicKey,
      amountStroops: amountStroops.toString(),
    });
    const txId = result.txId || "";
    await this.logs.append({
      kind: "deposit",
      message: `Deposited ${amountStroops.toString()} stroops${protocolFeeLogSuffix(feeStroops)}`,
      fromAddress: account.publicKey,
      toAddress: account.privateAddress,
      amountStroops: amountStroops.toString(),
      txId,
    });
    return txId;
  }

  async transfer(input: {
    sender: HdAccountEntity;
    recipient: HdAccountEntity;
    amountStroops: bigint;
  }): Promise<string> {
    if (!input.sender.privateAddress || !input.recipient.privateAddress) {
      throw new BadRequestException("Both accounts must be registered");
    }
    const result = await this.runJob(
      [input.sender.publicKey, input.recipient.publicKey],
      {
        kind: "transfer",
        senderPublicKey: input.sender.publicKey,
        recipientPublicKey: input.recipient.publicKey,
        amountStroops: input.amountStroops.toString(),
      },
    );
    const txId = result.txId || "";
    const feeStroops = await this.quotedFeeStroops(
      "transfer",
      input.amountStroops,
    );
    const fresh = await this.accounts.findOneByOrFail({
      publicKey: input.sender.publicKey,
    });
    input.sender.sentCount = fresh.sentCount;
    input.sender.sentVolumeStroops = fresh.sentVolumeStroops;
    await this.logs.append({
      kind: "transfer",
      message: `Private transfer ${input.amountStroops.toString()} stroops${protocolFeeLogSuffix(feeStroops)}`,
      fromAddress: input.sender.publicKey,
      toAddress: input.recipient.publicKey,
      amountStroops: input.amountStroops.toString(),
      txId,
    });
    return txId;
  }

  async withdraw(
    account: HdAccountEntity,
    amountStroops: bigint,
  ): Promise<string> {
    if (!account.privateAddress) {
      throw new BadRequestException("Account is not registered");
    }
    const result = await this.runJob([account.publicKey], {
      kind: "withdraw",
      publicKey: account.publicKey,
      amountStroops: amountStroops.toString(),
    });
    const txId = result.txId || "";
    const feeStroops = await this.quotedFeeStroops("withdraw", amountStroops);
    await this.logs.append({
      kind: "withdraw",
      message: `Withdrew ${amountStroops.toString()} stroops${protocolFeeLogSuffix(feeStroops)}`,
      fromAddress: account.publicKey,
      toAddress: account.publicKey,
      amountStroops: amountStroops.toString(),
      txId,
    });
    return txId;
  }

  async privateBalanceStroops(owner: string): Promise<bigint> {
    return this.privacy.privateBalanceStroops(owner);
  }

  async spendablePrivateStroops(
    owner: string,
    privateAddress: string,
  ): Promise<bigint> {
    return this.privacy.spendablePrivateStroops(owner, privateAddress);
  }

  proveWorkerCount(): number {
    return this.workers.size();
  }

  async quotedFeeStroops(
    kind: ProtocolFeeKind,
    instructedStroops: bigint,
  ): Promise<bigint> {
    const quote = await this.fees.quoteOrUndefined(kind, instructedStroops);
    return quote ? requiredFeeStroops(quote.requiredFee) : 0n;
  }

  private async requireDepositLeavesNote(
    amountStroops: bigint,
  ): Promise<bigint> {
    const quote = await this.fees.quoteOrUndefined("deposit", amountStroops);
    if (!quote) {
      return 0n;
    }
    const feeStroops = requiredFeeStroops(quote.requiredFee);
    remainingAfterRequiredFee({
      instructedStroops: amountStroops,
      requiredFeeStroops: feeStroops,
    });
    return feeStroops;
  }

  private async runJob(
    publicKeys: string[],
    job: PrivacyWorkerJob,
  ): Promise<{ txId?: string; privateAddress?: string }> {
    try {
      return await this.privacy.runExclusive(publicKeys, () =>
        this.workers.run(job),
      );
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "kytUnauthenticated" in error &&
        (error as { kytUnauthenticated?: boolean }).kytUnauthenticated
      ) {
        throw new UnauthorizedException(
          "Set KYT_INSPECT_TOKEN in .env to the same Bearer secret Core uses for inspect.",
        );
      }
      throw error;
    }
  }
}
