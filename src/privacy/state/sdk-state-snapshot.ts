export const LEGACY_SNAPSHOT_ID = "default";
export const POOL_SNAPSHOT_ID = "pool:shared";

export function accountSnapshotId(publicKey: string): string {
  return `account:${publicKey}`;
}

export function withoutPoolBranch(
  tree: Record<string, unknown>,
): Record<string, unknown> {
  if (!Object.hasOwn(tree, "pools")) {
    return tree;
  }
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(tree)) {
    if (key !== "pools") {
      rest[key] = value;
    }
  }
  return rest;
}

export function poolBranchFromTree(
  tree: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!tree || !isRecord(tree.pools)) {
    return undefined;
  }
  return { pools: tree.pools };
}

export function mergePoolBranch(
  account: Record<string, unknown>,
  pool: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const pools =
    poolBranchFromTree(pool)?.pools ?? poolBranchFromTree(account)?.pools;
  if (!pools) {
    return withoutPoolBranch(account);
  }
  return { ...withoutPoolBranch(account), pools };
}

export function poolCommitmentCount(
  tree: Record<string, unknown> | undefined,
): number {
  const pools = tree && isRecord(tree.pools) ? tree.pools : tree;
  if (!isRecord(pools)) {
    return 0;
  }
  const byContract = isRecord(pools.byContract) ? pools.byContract : undefined;
  if (!byContract) {
    return 0;
  }
  let max = 0;
  for (const value of Object.values(byContract)) {
    if (!isRecord(value)) {
      continue;
    }
    const fromArray = Array.isArray(value.commitments)
      ? value.commitments.length
      : 0;
    const declared =
      typeof value.commitmentCount === "number" ? value.commitmentCount : 0;
    max = Math.max(max, fromArray, declared);
  }
  return max;
}

export function richerPoolBranch(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const leftPool = poolBranchFromTree(left);
  const rightPool = poolBranchFromTree(right);
  if (poolCommitmentCount(rightPool) > poolCommitmentCount(leftPool)) {
    return rightPool;
  }
  return leftPool ?? rightPool;
}

export function pruneSpentPrivateRecords(
  tree: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(tree.privateRecords)) {
    return tree;
  }
  const records = tree.privateRecords.filter((record) => {
    if (!isRecord(record)) {
      return true;
    }
    return record.consumed !== true && record.status !== "spent";
  });
  if (records.length === tree.privateRecords.length) {
    return tree;
  }
  return { ...tree, privateRecords: records };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function filterMapByOwner(
  map: unknown,
  owner: string,
): Record<string, unknown> {
  if (!isRecord(map)) {
    return {};
  }
  const prefix = `${owner}:`;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(map)) {
    if (key === owner || key.startsWith(prefix)) {
      next[key] = value;
    }
  }
  return next;
}

export function partitionSdkStateTree(
  tree: Record<string, unknown>,
  owner: string,
): Record<string, unknown> {
  const records = Array.isArray(tree.privateRecords)
    ? tree.privateRecords.filter(
        (record) => isRecord(record) && record.owner === owner,
      )
    : [];
  const wallet = isRecord(tree.wallet) ? tree.wallet : {};
  const registry = isRecord(tree.registry) ? tree.registry : {};
  return {
    ...tree,
    privateRecords: records,
    wallet: {
      ...wallet,
      privateAddressScalars: filterMapByOwner(
        wallet.privateAddressScalars,
        owner,
      ),
      privateAddressRecords: filterMapByOwner(
        wallet.privateAddressRecords,
        owner,
      ),
      defaultPrivateAddressNonce: filterMapByOwner(
        wallet.defaultPrivateAddressNonce,
        owner,
      ),
    },
    registry: {
      ...registry,
      lookups: filterMapByOwner(registry.lookups, owner),
      privateAddresses: filterMapByOwner(registry.privateAddresses, owner),
      registeredAddresses: filterMapByOwner(
        registry.registeredAddresses,
        owner,
      ),
    },
  };
}

export function recordAmountStroops(record: {
  amount?: unknown;
  coinNote?: { value?: string };
}): bigint {
  const coinValue = record.coinNote?.value;
  if (coinValue !== undefined && String(coinValue).trim() !== "") {
    return BigInt(String(coinValue));
  }
  if (typeof record.amount === "bigint") {
    return record.amount;
  }
  if (typeof record.amount === "number" && Number.isFinite(record.amount)) {
    return BigInt(Math.trunc(record.amount));
  }
  if (typeof record.amount === "string" && record.amount.trim() !== "") {
    return BigInt(record.amount);
  }
  return 0n;
}

export function privateBalanceStroopsFromRecords(
  records: Array<{
    owner?: string;
    consumed?: boolean;
    status?: string;
    amount?: unknown;
    coinNote?: { value?: string };
  }>,
  owner: string,
): bigint {
  return records
    .filter(
      (record) =>
        record.owner === owner && !record.consumed && record.status !== "spent",
    )
    .reduce((total, record) => total + recordAmountStroops(record), 0n);
}
