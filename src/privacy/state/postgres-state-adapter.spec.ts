import {
  createPostgresStateAdapter,
  persistSnapshot,
  loadAccountStateTree,
  loadHydratedStateTree,
  loadPoolStateTree,
  promoteSharedPoolSnapshot,
} from "./postgres-state-adapter";
import { POOL_SNAPSHOT_ID } from "./sdk-state-snapshot";
import type { InMemoryStateAdapter } from "@arcanetech/privacy-sdk-state-memory";

type SavedRow = { id: string; tree: Record<string, unknown> };

type FakeRepo = {
  saved: Map<string, Record<string, unknown>>;
  find: () => Promise<SavedRow[]>;
  findOneBy: (query: { id: string }) => Promise<SavedRow | null>;
  save: (row: SavedRow) => Promise<unknown>;
};

function fakeRepo(initial?: Record<string, unknown>): FakeRepo {
  const saved = new Map<string, Record<string, unknown>>();
  if (initial) {
    saved.set("default", initial);
  }
  const repo: FakeRepo = {
    saved,
    async find() {
      return [...repo.saved.entries()].map(([id, tree]) => ({ id, tree }));
    },
    async findOneBy(query) {
      const tree = repo.saved.get(query.id);
      return tree ? { id: query.id, tree } : null;
    },
    async save(row) {
      repo.saved.set(row.id, row.tree);
      return row;
    },
  };
  return repo;
}

function fakeMemory(tree: Record<string, unknown>): InMemoryStateAdapter {
  let state = tree;
  return {
    getState: () => state,
    resetState(nextState = {}) {
      state = nextState;
    },
    registerDefinition() {
      return undefined;
    },
    async write() {
      return undefined;
    },
    async read<TResult>(): Promise<TResult> {
      return undefined as TResult;
    },
  };
}

function merkleTree(count: number): Record<string, unknown> {
  return {
    pools: {
      byContract: {
        CPOOL: {
          commitments: Array.from({ length: count }, (_, index) =>
            String(index),
          ),
          commitmentCount: count,
        },
      },
    },
  };
}

function commitmentCount(tree: Record<string, unknown> | undefined): number {
  const pools = tree?.pools as
    | { byContract?: { CPOOL?: { commitmentCount?: number } } }
    | undefined;
  return pools?.byContract?.CPOOL?.commitmentCount ?? 0;
}

describe("postgres state adapter wrapper", () => {
  it("hydrates from JSONB and persists after write", async () => {
    const repo = fakeRepo({ hello: "world" });
    const memory = fakeMemory(repo.saved.get("default") ?? {});
    expect(memory.getState()).toEqual({ hello: "world" });
    const adapter = createPostgresStateAdapter(
      repo as never,
      memory,
      "default",
    );
    await adapter.write({ type: "test", operations: [] } as never);
    expect(repo.saved.get("default")).toEqual({ hello: "world" });
    memory.resetState({ hello: "next", amount: 1n });
    await persistSnapshot(repo as never, memory, "account:GTEST");
    expect(repo.saved.get("account:GTEST")).toEqual({
      hello: "next",
      amount: "1",
    });
  });

  it("partitions the legacy default snapshot when an account row is missing", async () => {
    const repo = fakeRepo({
      privateRecords: [
        { id: "1", owner: "GA" },
        { id: "2", owner: "GB" },
      ],
    });
    const tree = await loadAccountStateTree(repo as never, "GA");
    expect(tree.privateRecords).toEqual([{ id: "1", owner: "GA" }]);
  });

  it("keeps growing merkle state off the per-account read path", async () => {
    const repo = fakeRepo();
    const pools = merkleTree(8000).pools;
    await repo.save({
      id: "account:GA",
      tree: {
        pools,
        privateRecords: [
          { id: "spent", owner: "GA", consumed: true, status: "spent" },
          {
            id: "live",
            owner: "GA",
            consumed: false,
            coinNote: { value: "1" },
          },
        ],
      },
    });
    await repo.save({
      id: "account:GB",
      tree: {
        pools: merkleTree(100).pools,
        privateRecords: [{ id: "other", owner: "GB", consumed: false }],
      },
    });
    await promoteSharedPoolSnapshot(repo as never);
    const account = await loadAccountStateTree(repo as never, "GA");
    expect(account.pools).toBeUndefined();
    expect(account.privateRecords).toEqual([
      { id: "live", owner: "GA", consumed: false, coinNote: { value: "1" } },
    ]);
    expect(repo.saved.get("account:GB")?.pools).toBeUndefined();
    const pool = await loadPoolStateTree(repo as never);
    expect(pool?.pools).toEqual(pools);
    const hydrated = await loadHydratedStateTree(repo as never, "GA");
    expect(hydrated.pools).toEqual(pools);
    expect(hydrated.privateRecords).toEqual(account.privateRecords);
  });

  it("does not rewrite the shared merkle snapshot on account record writes", async () => {
    const repo = fakeRepo();
    const pools = merkleTree(4000).pools;
    await repo.save({
      id: POOL_SNAPSHOT_ID,
      tree: { pools },
    });
    const memory = fakeMemory({
      pools: merkleTree(10).pools,
      privateRecords: [{ id: "live", owner: "GA", consumed: false }],
    });
    const adapter = createPostgresStateAdapter(
      repo as never,
      memory,
      "account:GA",
    );
    await adapter.write({
      type: "upsertPrivateRecords",
      operations: [],
    } as never);
    expect(repo.saved.get(POOL_SNAPSHOT_ID)?.pools).toEqual(pools);
    expect(repo.saved.get("account:GA")?.pools).toBeUndefined();
    expect(repo.saved.get("account:GA")?.privateRecords).toEqual([
      { id: "live", owner: "GA", consumed: false },
    ]);
  });

  it("persists a newer merkle snapshot only on pool writes", async () => {
    const repo = fakeRepo();
    await repo.save({
      id: POOL_SNAPSHOT_ID,
      tree: merkleTree(2),
    });
    const memory = fakeMemory(merkleTree(5));
    const adapter = createPostgresStateAdapter(
      repo as never,
      memory,
      "account:GA",
    );
    await adapter.write({
      type: "setLeafEphemeral",
      operations: [],
    } as never);
    expect(commitmentCount(repo.saved.get(POOL_SNAPSHOT_ID))).toBe(2);
    await adapter.write({
      type: "setPoolMerkleState",
      operations: [],
    } as never);
    expect(commitmentCount(repo.saved.get(POOL_SNAPSHOT_ID))).toBe(5);
  });
});
