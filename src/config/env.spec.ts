import {
  requireDecimalApplicationId,
  defaultProveWorkers,
  parsePositiveNumber,
  intervalMsFromMinutes,
} from "./env";

describe("requireDecimalApplicationId", () => {
  it("accepts association.audit_id as decimal Fr", () => {
    expect(requireDecimalApplicationId("3520878299009890")).toBe(
      "3520878299009890",
    );
  });

  it("rejects a Compliance UUID or foreignId", () => {
    expect(() =>
      requireDecimalApplicationId("b7f25daa-aeff-4f93-b33e-0cd905f0bab9"),
    ).toThrow(/decimal Fr/);
  });
});

describe("defaultProveWorkers", () => {
  it("uses at most two workers and at most one pair per two accounts", () => {
    expect(defaultProveWorkers(5)).toBe(2);
    expect(defaultProveWorkers(2)).toBe(1);
    expect(defaultProveWorkers(1)).toBe(1);
  });
});

describe("parsePositiveNumber", () => {
  it("parses simulator defaults", () => {
    expect(parsePositiveNumber("TX_INTERVAL_MINUTES", "30")).toBe(30);
    expect(parsePositiveNumber("TX_AMOUNT_XLM", "1")).toBe(1);
    expect(parsePositiveNumber("DEPOSIT_AMOUNT_XLM", "10")).toBe(10);
  });

  it("rejects zero, negative, and non-numeric values", () => {
    expect(() => parsePositiveNumber("TX_INTERVAL_MINUTES", "0")).toThrow(
      /positive number/,
    );
    expect(() => parsePositiveNumber("TX_AMOUNT_XLM", "-1")).toThrow(
      /positive number/,
    );
    expect(() => parsePositiveNumber("DEPOSIT_AMOUNT_XLM", "abc")).toThrow(
      /positive number/,
    );
  });
});

describe("intervalMsFromMinutes", () => {
  it("converts minutes to milliseconds with a one-second floor", () => {
    expect(intervalMsFromMinutes(30)).toBe(1_800_000);
    expect(intervalMsFromMinutes(0.5)).toBe(30_000);
    expect(intervalMsFromMinutes(0.0001)).toBe(1000);
  });
});
