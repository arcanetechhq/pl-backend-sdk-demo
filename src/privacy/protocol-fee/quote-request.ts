export type ProtocolFeeKind = "deposit" | "transfer" | "withdraw";

export type ProtocolFeeQuoteRequest = {
  feeAsset: string;
  publicDepositAmount?: string;
  transferInstructedAmount?: string;
  publicWithdrawalAmount?: string;
  spendsNotes: boolean;
};

function presentInstructedAmount(amount: string): string | undefined {
  const trimmed = amount.trim();
  if (!trimmed || trimmed === "0") {
    return undefined;
  }
  return trimmed;
}

export function protocolFeeQuoteRequest(input: {
  kind: ProtocolFeeKind;
  feeAsset: string;
  instructedMinor: string;
}): ProtocolFeeQuoteRequest {
  const amount = presentInstructedAmount(input.instructedMinor);
  if (input.kind === "deposit") {
    return {
      feeAsset: input.feeAsset,
      spendsNotes: false,
      ...(amount === undefined ? {} : { publicDepositAmount: amount }),
    };
  }
  if (input.kind === "withdraw") {
    return {
      feeAsset: input.feeAsset,
      spendsNotes: true,
      ...(amount === undefined ? {} : { publicWithdrawalAmount: amount }),
    };
  }
  return {
    feeAsset: input.feeAsset,
    spendsNotes: true,
    ...(amount === undefined ? {} : { transferInstructedAmount: amount }),
  };
}
