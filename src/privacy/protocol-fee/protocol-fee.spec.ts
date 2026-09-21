import { protocolFeeQuoteRequest } from "./quote-request";
import { quoteProtocolFee } from "./quote-protocol-fee";
import { shouldQuoteProtocolFee } from "./should-quote-protocol-fee";
import {
  canCoverInstructedSpend,
  remainingAfterRequiredFee,
  requiredSpendStroops,
} from "./required-spend";

const FEE_ASSET = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const COLLECTOR = "stpl1feecollectorprivateaddress";
const DEPOSIT_INSTRUCTED = "1000000000";
const DEPOSIT_FEE = "10000000";
const TRANSFER_INSTRUCTED = "400000000";
const TRANSFER_FEE = "4000000";
const WITHDRAW_INSTRUCTED = "200000000";
const WITHDRAW_FEE = "2000000";
const FEE_RATE = "0.01";
const API_BASE = "http://transfers.test/api";
const HTTP_CREATED = 201;

describe("protocol fee quote", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("quotes Required Fee from the transfer service without secrets", async () => {
    const fetchMock = jest.fn(
      async (
        _input: RequestInfo | URL,
        _init?: RequestInit,
      ): Promise<Response> =>
        new Response(
          JSON.stringify({
            requiredFee: DEPOSIT_FEE,
            feeAsset: FEE_ASSET,
            feeCollectorPrivateAddress: COLLECTOR,
            feeRate: FEE_RATE,
          }),
          {
            status: HTTP_CREATED,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    jest.spyOn(globalThis, "fetch").mockImplementation(fetchMock);

    const quote = await quoteProtocolFee({
      apiBaseUrl: API_BASE,
      request: protocolFeeQuoteRequest({
        kind: "deposit",
        feeAsset: FEE_ASSET,
        instructedMinor: DEPOSIT_INSTRUCTED,
      }),
    });

    expect(quote).toEqual({
      requiredFee: DEPOSIT_FEE,
      feeAsset: FEE_ASSET,
      feeCollectorPrivateAddress: COLLECTOR,
      feeRate: FEE_RATE,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const quoteCall = fetchMock.mock.calls[0];
    if (quoteCall === undefined) {
      throw new Error("expected a Fee Quote request");
    }
    const [url, init] = quoteCall;
    expect(String(url)).toBe(`${API_BASE}/kyt/fees/quote`);
    const body = JSON.parse(
      String((init as RequestInit | undefined)?.body),
    ) as Record<string, unknown>;
    expect(body).toEqual({
      feeAsset: FEE_ASSET,
      publicDepositAmount: DEPOSIT_INSTRUCTED,
      spendsNotes: false,
    });
    expect(body).not.toHaveProperty("secret");
    expect(body).not.toHaveProperty("notes");
    expect((init as RequestInit | undefined)?.headers).toEqual({
      "content-type": "application/json",
    });
  });

  it("sends inspectAuthorization as Bearer when present", async () => {
    const fetchMock = jest.fn(
      async (
        _input: RequestInfo | URL,
        _init?: RequestInit,
      ): Promise<Response> =>
        new Response(
          JSON.stringify({
            requiredFee: TRANSFER_FEE,
            feeAsset: FEE_ASSET,
            feeCollectorPrivateAddress: COLLECTOR,
            feeRate: FEE_RATE,
          }),
          {
            status: HTTP_CREATED,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    jest.spyOn(globalThis, "fetch").mockImplementation(fetchMock);

    await quoteProtocolFee({
      apiBaseUrl: API_BASE,
      inspectAuthorization: "stand-token",
      request: protocolFeeQuoteRequest({
        kind: "transfer",
        feeAsset: FEE_ASSET,
        instructedMinor: TRANSFER_INSTRUCTED,
      }),
    });

    const quoteCall = fetchMock.mock.calls[0];
    if (quoteCall === undefined) {
      throw new Error("expected a Fee Quote request");
    }
    const init = quoteCall[1] as RequestInit | undefined;
    expect(init?.headers).toEqual({
      "content-type": "application/json",
      authorization: "Bearer stand-token",
    });
  });

  it("builds transfer and withdraw quote requests from instructed amounts", () => {
    expect(
      protocolFeeQuoteRequest({
        kind: "transfer",
        feeAsset: FEE_ASSET,
        instructedMinor: TRANSFER_INSTRUCTED,
      }),
    ).toEqual({
      feeAsset: FEE_ASSET,
      transferInstructedAmount: TRANSFER_INSTRUCTED,
      spendsNotes: true,
    });
    expect(
      protocolFeeQuoteRequest({
        kind: "withdraw",
        feeAsset: FEE_ASSET,
        instructedMinor: WITHDRAW_INSTRUCTED,
      }),
    ).toEqual({
      feeAsset: FEE_ASSET,
      publicWithdrawalAmount: WITHDRAW_INSTRUCTED,
      spendsNotes: true,
    });
  });

  it("does not invent a protocol fee for escrow sweep or claim", () => {
    expect(shouldQuoteProtocolFee("deposit")).toBe(true);
    expect(shouldQuoteProtocolFee("transfer")).toBe(true);
    expect(shouldQuoteProtocolFee("withdraw")).toBe(true);
    expect(shouldQuoteProtocolFee("sweep")).toBe(false);
    expect(shouldQuoteProtocolFee("claim")).toBe(false);
  });

  it("adds Required Fee to transfer and withdraw spend, not to public deposit", () => {
    expect(
      requiredSpendStroops({
        kind: "deposit",
        instructedStroops: BigInt(DEPOSIT_INSTRUCTED),
        requiredFeeStroops: BigInt(DEPOSIT_FEE),
      }),
    ).toBe(BigInt(DEPOSIT_INSTRUCTED));
    expect(
      requiredSpendStroops({
        kind: "transfer",
        instructedStroops: BigInt(TRANSFER_INSTRUCTED),
        requiredFeeStroops: BigInt(TRANSFER_FEE),
      }),
    ).toBe(BigInt(TRANSFER_INSTRUCTED) + BigInt(TRANSFER_FEE));
    expect(
      remainingAfterRequiredFee({
        instructedStroops: BigInt(DEPOSIT_INSTRUCTED),
        requiredFeeStroops: BigInt(DEPOSIT_FEE),
      }),
    ).toBe(990_000_000n);
    expect(
      canCoverInstructedSpend({
        spendableStroops: 403_999_999n,
        instructedStroops: BigInt(TRANSFER_INSTRUCTED),
        requiredFeeStroops: BigInt(TRANSFER_FEE),
      }),
    ).toBe(false);
    expect(
      canCoverInstructedSpend({
        spendableStroops: 404_000_000n,
        instructedStroops: BigInt(TRANSFER_INSTRUCTED),
        requiredFeeStroops: BigInt(TRANSFER_FEE),
      }),
    ).toBe(true);
    expect(() =>
      remainingAfterRequiredFee({
        instructedStroops: BigInt(DEPOSIT_FEE),
        requiredFeeStroops: BigInt(DEPOSIT_FEE),
      }),
    ).toThrow(/no spendable deposit note/);
  });
});
