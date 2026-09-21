import { Injectable } from "@nestjs/common";
import { loadDemoEnv } from "../../config/env";
import { kytInspectAuthorization } from "../kyt";
import { quoteProtocolFee, type ProtocolFeeQuote } from "./quote-protocol-fee";
import {
  protocolFeeQuoteRequest,
  type ProtocolFeeKind,
} from "./quote-request";

@Injectable()
export class ProtocolFeeService {
  private readonly env = loadDemoEnv();
  private readonly cache = new Map<string, ProtocolFeeQuote>();

  async quote(
    kind: ProtocolFeeKind,
    instructedStroops: bigint,
  ): Promise<ProtocolFeeQuote> {
    const instructedMinor = instructedStroops.toString();
    const cacheKey = `${kind}:${instructedMinor}:${this.env.tokenContract}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const quote = await quoteProtocolFee({
      apiBaseUrl: this.env.kytApiBaseUrl,
      request: protocolFeeQuoteRequest({
        kind,
        feeAsset: this.env.tokenContract,
        instructedMinor,
      }),
      ...kytInspectAuthorization(this.env.kytInspectToken),
    });
    this.cache.set(cacheKey, quote);
    return quote;
  }

  async quoteOrUndefined(
    kind: ProtocolFeeKind,
    instructedStroops: bigint,
  ): Promise<ProtocolFeeQuote | undefined> {
    try {
      return await this.quote(kind, instructedStroops);
    } catch {
      return undefined;
    }
  }
}
