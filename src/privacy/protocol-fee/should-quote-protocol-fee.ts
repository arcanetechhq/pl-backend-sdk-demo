export type ProtocolFeeUiKind =
  | "deposit"
  | "transfer"
  | "withdraw"
  | "sweep"
  | "claim";

export function shouldQuoteProtocolFee(kind: ProtocolFeeUiKind): boolean {
  return kind === "deposit" || kind === "transfer" || kind === "withdraw";
}
