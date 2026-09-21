import type {
  StateBridgeAdapter,
  StateBridgeCall,
  StateBridgeDefinition,
} from "@arcanetech/privacy-sdk-core/state";
import type { InMemoryStateAdapter } from "@arcanetech/privacy-sdk-state-memory";
import type { Repository } from "typeorm";
import { SdkStateRow } from "../../persistence/sdk-state.entity";
import { importEsm } from "../../lib/esm";
import {
  accountSnapshotId,
  LEGACY_SNAPSHOT_ID,
  mergePoolBranch,
  partitionSdkStateTree,
  poolCommitmentCount,
  POOL_SNAPSHOT_ID,
  pruneSpentPrivateRecords,
  richerPoolBranch,
  withoutPoolBranch,
} from "./sdk-state-snapshot";

const POOL_PERSIST_WRITE_TYPES = new Set(["setPoolMerkleState"]);

function jsonSafeClone(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(value, (_key, current: unknown) =>
      typeof current === "bigint" ? current.toString() : current,
    ),
  ) as Record<string, unknown>;
}

function accountTreeFromMemory(
  memory: InMemoryStateAdapter,
): Record<string, unknown> {
  return jsonSafeClone(
    pruneSpentPrivateRecords(withoutPoolBranch(memory.getState())),
  );
}

function poolTreeFromMemory(
  memory: InMemoryStateAdapter,
): Record<string, unknown> | undefined {
  const pools = memory.getState().pools;
  if (typeof pools !== "object" || pools === null || Array.isArray(pools)) {
    return undefined;
  }
  return jsonSafeClone({ pools: pools as Record<string, unknown> });
}

function isPoolPersistWrite(call: StateBridgeCall): boolean {
  return POOL_PERSIST_WRITE_TYPES.has(call.type);
}

export function createPostgresStateAdapter(
  repository: Repository<SdkStateRow>,
  memory: InMemoryStateAdapter,
  snapshotId: string,
): StateBridgeAdapter {
  return {
    registerDefinition(definition: StateBridgeDefinition) {
      memory.registerDefinition(definition);
    },
    async write(call: StateBridgeCall) {
      await memory.write(call);
      await persistAccountSnapshot(repository, memory, snapshotId);
      if (isPoolPersistWrite(call)) {
        await persistPoolSnapshotIfNewer(repository, memory);
      }
    },
    async read<TResult>(call: StateBridgeCall): Promise<TResult> {
      return memory.read(call);
    },
  };
}

export async function loadAccountStateTree(
  repository: Repository<SdkStateRow>,
  publicKey: string,
): Promise<Record<string, unknown>> {
  const row = await repository.findOneBy({ id: accountSnapshotId(publicKey) });
  if (row?.tree) {
    return pruneSpentPrivateRecords(withoutPoolBranch(row.tree));
  }
  const legacy = await repository.findOneBy({ id: LEGACY_SNAPSHOT_ID });
  if (legacy?.tree) {
    return pruneSpentPrivateRecords(
      withoutPoolBranch(partitionSdkStateTree(legacy.tree, publicKey)),
    );
  }
  return {};
}

export async function loadPoolStateTree(
  repository: Repository<SdkStateRow>,
): Promise<Record<string, unknown> | undefined> {
  const shared = await repository.findOneBy({ id: POOL_SNAPSHOT_ID });
  if (poolCommitmentCount(shared?.tree) > 0) {
    return shared?.tree;
  }
  const rows = await repository.find();
  let best: Record<string, unknown> | undefined;
  for (const row of rows) {
    best = richerPoolBranch(best, row.tree);
  }
  return best;
}

export async function loadHydratedStateTree(
  repository: Repository<SdkStateRow>,
  publicKey: string,
): Promise<Record<string, unknown>> {
  const [account, pool] = await Promise.all([
    loadAccountStateTree(repository, publicKey),
    loadPoolStateTree(repository),
  ]);
  return mergePoolBranch(account, pool);
}

export async function hydrateMemoryAdapter(
  repository: Repository<SdkStateRow>,
  publicKey: string,
): Promise<InMemoryStateAdapter> {
  const { createInMemoryStateAdapter } = await importEsm<
    typeof import("@arcanetech/privacy-sdk-state-memory")
  >("@arcanetech/privacy-sdk-state-memory");
  return createInMemoryStateAdapter(
    await loadHydratedStateTree(repository, publicKey),
  );
}

export async function persistAccountSnapshot(
  repository: Repository<SdkStateRow>,
  memory: InMemoryStateAdapter,
  snapshotId: string,
): Promise<void> {
  await repository.save({
    id: snapshotId,
    tree: accountTreeFromMemory(memory),
  });
}

export async function persistPoolSnapshotIfNewer(
  repository: Repository<SdkStateRow>,
  memory: InMemoryStateAdapter,
): Promise<void> {
  const incoming = poolTreeFromMemory(memory);
  if (!incoming) {
    return;
  }
  const existing = await repository.findOneBy({ id: POOL_SNAPSHOT_ID });
  if (poolCommitmentCount(incoming) < poolCommitmentCount(existing?.tree)) {
    return;
  }
  await repository.save({
    id: POOL_SNAPSHOT_ID,
    tree: incoming,
  });
}

export async function persistSnapshot(
  repository: Repository<SdkStateRow>,
  memory: InMemoryStateAdapter,
  snapshotId: string,
): Promise<void> {
  await persistAccountSnapshot(repository, memory, snapshotId);
  await persistPoolSnapshotIfNewer(repository, memory);
}

export async function promoteSharedPoolSnapshot(
  repository: Repository<SdkStateRow>,
): Promise<void> {
  const rows = await repository.find();
  let bestPool: Record<string, unknown> | undefined;
  for (const row of rows) {
    bestPool = richerPoolBranch(bestPool, row.tree);
  }
  const shared = rows.find((row) => row.id === POOL_SNAPSHOT_ID);
  const promoted = richerPoolBranch(shared?.tree, bestPool);
  if (poolCommitmentCount(promoted) > poolCommitmentCount(shared?.tree)) {
    await repository.save({
      id: POOL_SNAPSHOT_ID,
      tree: promoted ?? {},
    });
  }
  for (const row of rows) {
    if (row.id === POOL_SNAPSHOT_ID) {
      continue;
    }
    const next = pruneSpentPrivateRecords(withoutPoolBranch(row.tree));
    if (JSON.stringify(next) === JSON.stringify(row.tree)) {
      continue;
    }
    await repository.save({
      id: row.id,
      tree: next,
    });
  }
}
