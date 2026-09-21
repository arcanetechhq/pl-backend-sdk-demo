import type { ProtocolFeeKind } from "./quote-request";

export function requiredFeeStroops(requiredFee: string): bigint {
  return BigInt(requiredFee);
}

export function requiredSpendStroops(input: {
  kind: ProtocolFeeKind;
  instructedStroops: bigint;
  requiredFeeStroops: bigint;
}): bigint {
  if (input.kind === "deposit") {
    return input.instructedStroops;
  }
  return input.instructedStroops + input.requiredFeeStroops;
}

export function remainingAfterRequiredFee(input: {
  instructedStroops: bigint;
  requiredFeeStroops: bigint;
}): bigint {
  const remaining = input.instructedStroops - input.requiredFeeStroops;
  if (remaining <= 0n) {
    throw new Error("Required Fee leaves no spendable deposit note");
  }
  return remaining;
}

export function canCoverInstructedSpend(input: {
  spendableStroops: bigint;
  instructedStroops: bigint;
  requiredFeeStroops: bigint;
}): boolean {
  return (
    input.spendableStroops >=
    input.instructedStroops + input.requiredFeeStroops
  );
}

export function protocolFeeLogSuffix(requiredFeeStroops: bigint): string {
  if (requiredFeeStroops <= 0n) {
    return "";
  }
  return ` (protocol fee ${requiredFeeStroops.toString()} stroops)`;
}
