import {
  accountSnapshotId,
  mergePoolBranch,
  partitionSdkStateTree,
  poolCommitmentCount,
  privateBalanceStroopsFromRecords,
  pruneSpentPrivateRecords,
  richerPoolBranch,
  withoutPoolBranch,
} from "./sdk-state-snapshot";

describe("sdk state snapshot partition", () => {
  it("builds per-account snapshot ids", () => {
    expect(accountSnapshotId("GABC")).toBe("account:GABC");
  });

  it("keeps only the owner records, wallet, and registry entries", () => {
    const tree = {
      privateRecords: [
        { id: "1", owner: "GA", amount: "10" },
        { id: "2", owner: "GB", amount: "20" },
      ],
      pools: { byContract: { pool: { merkleRootHex: "aa" } } },
      wallet: {
        privateAddressScalars: {
          "GA:0": { owner: "GA", scalarHex: "11" },
          "GB:0": { owner: "GB", scalarHex: "22" },
        },
        privateAddressRecords: {
          "GA:0": { owner: "GA", privateAddress: "stpl1a" },
        },
        defaultPrivateAddressNonce: { GA: "0", GB: "0" },
      },
      registry: {
        lookups: {
          GA: { owner: "GA", status: "registered" },
          GB: { owner: "GB", status: "registered" },
        },
        privateAddresses: { GA: "stpl1a", GB: "stpl1b" },
        registeredAddresses: { GA: true, GB: true },
      },
    };
    const partitioned = partitionSdkStateTree(tree, "GA");
    expect(partitioned.privateRecords).toEqual([
      { id: "1", owner: "GA", amount: "10" },
    ]);
    expect(partitioned.pools).toEqual(tree.pools);
    expect(partitioned.wallet).toEqual({
      privateAddressScalars: { "GA:0": { owner: "GA", scalarHex: "11" } },
      privateAddressRecords: {
        "GA:0": { owner: "GA", privateAddress: "stpl1a" },
      },
      defaultPrivateAddressNonce: { GA: "0" },
    });
    expect(partitioned.registry).toEqual({
      lookups: { GA: { owner: "GA", status: "registered" } },
      privateAddresses: { GA: "stpl1a" },
      registeredAddresses: { GA: true },
    });
  });

  it("strips the pool branch so account snapshots stay small", () => {
    const tree = {
      privateRecords: [{ id: "1", owner: "GA" }],
      pools: {
        byContract: {
          CPOOL: { commitments: ["a", "b"], commitmentCount: 2 },
        },
      },
    };
    expect(withoutPoolBranch(tree)).toEqual({
      privateRecords: [{ id: "1", owner: "GA" }],
    });
    expect(poolCommitmentCount(tree)).toBe(2);
    expect(mergePoolBranch(withoutPoolBranch(tree), tree).pools).toEqual(
      tree.pools,
    );
    expect(
      poolCommitmentCount(
        richerPoolBranch(tree, {
          pools: {
            byContract: { CPOOL: { commitments: ["a"], commitmentCount: 1 } },
          },
        }),
      ),
    ).toBe(2);
  });

  it("drops spent private records from persisted account trees", () => {
    expect(
      pruneSpentPrivateRecords({
        privateRecords: [
          { id: "live", owner: "GA", consumed: false },
          { id: "spent", owner: "GA", consumed: true, status: "spent" },
        ],
      }).privateRecords,
    ).toEqual([{ id: "live", owner: "GA", consumed: false }]);
  });

  it("sums unspent private balance for an owner", () => {
    expect(
      privateBalanceStroopsFromRecords(
        [
          { owner: "GA", amount: "5", consumed: false },
          { owner: "GA", amount: "7", status: "spent" },
          { owner: "GB", amount: "9" },
        ],
        "GA",
      ),
    ).toBe(5n);
  });
});
