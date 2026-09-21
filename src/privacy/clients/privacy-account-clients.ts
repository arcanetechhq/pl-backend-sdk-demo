import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Repository } from "typeorm";
import type {
  StellarPrivacyClient,
  StellarTransactEnvironment,
} from "@arcanetech/privacy-sdk-stellar";
import type { StateBridgeAdapter } from "@arcanetech/privacy-sdk-core/state";
import type { InMemoryStateAdapter } from "@arcanetech/privacy-sdk-state-memory";
import type { DemoEnv } from "../../config/env";
import { deriveAccountKeypairs } from "../../accounts/hd-wallet";
import { SdkStateRow } from "../../persistence/sdk-state.entity";
import { WalletScalarEntity } from "../../persistence/wallet-scalar.entity";
import {
  accountSnapshotId,
  createPostgresStateAdapter,
  hydrateMemoryAdapter,
  loadHydratedStateTree,
  promoteSharedPoolSnapshot,
  richerPoolBranch,
} from "../state";
import { wrapTransactEngineToProveAtPrepare } from "./wrap-transact-engine";
import { kytInspectAuthorization } from "../kyt";
import { importEsm } from "../../lib/esm";
import {
  transactionNoteLayoutFromSdk,
  type TransactionNoteLayout,
} from "../notes";

export type AccountClientSession = {
  publicKey: string;
  client: StellarPrivacyClient;
  memory: InMemoryStateAdapter;
};

export type AccountClientRegistry = {
  layout: TransactionNoteLayout;
  getClient(publicKey: string): StellarPrivacyClient;
  getKeypair(publicKey: string): Keypair;
  refresh(publicKeys: string[]): Promise<void>;
};

export async function bootstrapAccountClients(input: {
  env: DemoEnv;
  sdkState: Repository<SdkStateRow>;
  scalars: Repository<WalletScalarEntity>;
}): Promise<AccountClientRegistry> {
  const keypairs = new Map<string, Keypair>();
  for (const keypair of deriveAccountKeypairs(
    input.env.mnemonic,
    input.env.accountCount,
  )) {
    keypairs.set(keypair.publicKey(), keypair);
  }
  const stellar = await importEsm<
    typeof import("@arcanetech/privacy-sdk-stellar")
  >("@arcanetech/privacy-sdk-stellar");
  const moduleRequire = createRequire(__filename);
  const wasmPath = moduleRequire.resolve(
    "@arcanetech/stellar-privacy-pool-zk-sdk/sdk.wasm",
  );
  const wasmFile = await readFile(wasmPath);
  const sdkWasm = new ArrayBuffer(wasmFile.byteLength);
  new Uint8Array(sdkWasm).set(wasmFile);
  const assets = { sdkWasm };
  await promoteSharedPoolSnapshot(input.sdkState);
  const sessions = new Map<string, AccountClientSession>();
  for (const publicKey of keypairs.keys()) {
    const session = await createAccountSession({
      env: input.env,
      stellar,
      assets,
      publicKey,
      keypairs,
      sdkState: input.sdkState,
      scalars: input.scalars,
    });
    sessions.set(publicKey, session);
  }
  const layout = await resolveTransactionLayout(stellar, input.env);
  return {
    layout,
    getClient(publicKey: string) {
      const session = sessions.get(publicKey);
      if (!session) {
        throw new Error(`No privacy client for ${publicKey}`);
      }
      return session.client;
    },
    getKeypair(publicKey: string) {
      const keypair = keypairs.get(publicKey);
      if (!keypair) {
        throw new Error(`No keypair for ${publicKey}`);
      }
      return keypair;
    },
    async refresh(publicKeys: string[]) {
      for (const publicKey of publicKeys) {
        const session = sessions.get(publicKey);
        if (!session) {
          continue;
        }
        const loaded = await loadHydratedStateTree(input.sdkState, publicKey);
        const pool = richerPoolBranch(session.memory.getState(), loaded);
        session.memory.resetState(pool ? { ...loaded, ...pool } : loaded);
      }
    },
  };
}

async function createAccountSession(input: {
  env: DemoEnv;
  stellar: typeof import("@arcanetech/privacy-sdk-stellar");
  assets: { sdkWasm: ArrayBuffer };
  publicKey: string;
  keypairs: Map<string, Keypair>;
  sdkState: Repository<SdkStateRow>;
  scalars: Repository<WalletScalarEntity>;
}): Promise<AccountClientSession> {
  const memory = await hydrateMemoryAdapter(input.sdkState, input.publicKey);
  const state: StateBridgeAdapter = createPostgresStateAdapter(
    input.sdkState,
    memory,
    accountSnapshotId(input.publicKey),
  );
  let clientSlot: StellarPrivacyClient | undefined;
  const transactEnvironment: StellarTransactEnvironment = {
    network: {
      id: "stellar-testnet",
      rpcUrl: input.env.sorobanRpcUrl,
      networkPassphrase: input.env.networkPassphrase,
      poolContract: input.env.poolContract,
      registryContract: input.env.registryContract,
      applicationId: input.stellar.resolvePoolApplicationId(
        input.env.applicationId,
      ),
    },
    zkConfigNonce: input.env.zkConfigNonce,
    ...(input.env.zkArtifactBaseUrl
      ? { zkArtifactBaseUrl: input.env.zkArtifactBaseUrl }
      : {}),
    auditPublicKey: input.stellar.parseAuditPublicKeyFromEnvHex(
      input.env.auditPublicKeyHex,
    ),
    kyt: {
      apiBaseUrl: input.env.kytApiBaseUrl,
      kytPassageRegistryContract: input.env.kytPassageRegistryContract,
      registerPassageOnChain: false,
      ...kytInspectAuthorization(input.env.kytInspectToken),
    },
    signTransaction: async (payload) => {
      const keypair = input.keypairs.get(payload.address);
      if (!keypair) {
        throw new Error(`No keypair for ${payload.address}`);
      }
      const tx = TransactionBuilder.fromXDR(
        payload.xdr,
        payload.networkPassphrase,
      );
      tx.sign(keypair);
      return { signedTxXdr: tx.toXDR() };
    },
    resolveTokenContractId: (assetId) => {
      if (
        assetId === input.env.assetId ||
        assetId === input.env.tokenContract
      ) {
        return input.env.tokenContract;
      }
      return input.env.tokenContract;
    },
    resolveWalletPublicKey: async () => input.publicKey,
    ensureSenderPrivKeyScalarHex: async (privateAddressStpl1) => {
      const row = await input.scalars.findOneBy({
        privateAddress: privateAddressStpl1,
      });
      if (!row) {
        throw new Error(`Missing spend scalar for ${privateAddressStpl1}`);
      }
      return row.scalarHex;
    },
    resolveTransferRecipientAtExecute: async (recipient) => {
      if (!clientSlot) {
        throw new Error("Privacy client is not ready.");
      }
      return clientSlot.resolveTransferRecipient(recipient);
    },
  };
  const resolved = await input.stellar.resolveStellarPrivacyClientConfig(
    {
      network: transactEnvironment.network,
      wallet: {
        getAddress: async () => input.publicKey,
        authorizeMessage: async (message) => {
          const keypair = input.keypairs.get(input.publicKey);
          if (!keypair) {
            throw new Error(`No keypair for ${input.publicKey}`);
          }
          const bytes =
            typeof message === "string"
              ? Buffer.from(message, "utf8")
              : Buffer.from(message);
          return keypair.sign(bytes);
        },
        signTransactionPayload: async (payload) => ({
          ...payload,
          signed: true,
        }),
      },
      state,
      assets: input.assets,
      auditPublicKeyHex: input.env.auditPublicKeyHex,
      transactEnvironment,
      policy: input.stellar.createStellarPolicyAdapterFromEnvironment(
        transactEnvironment,
      ),
    },
    async (factoryInput) => {
      const engine = await input.stellar.createDefaultTransactEngine(
        factoryInput.assets ?? input.assets,
        factoryInput.transactEnvironment,
      );
      if (!factoryInput.transactEnvironment) {
        return engine;
      }
      return wrapTransactEngineToProveAtPrepare({
        engine,
        environment: factoryInput.transactEnvironment,
        poolService: input.stellar.getPrivacyPoolService(),
        finalizeSpendOperationAtExecute:
          input.stellar.finalizeSpendOperationAtExecute,
      });
    },
  );
  if (!resolved.ok) {
    throw new Error("Privacy SDK client rejected during initialization.");
  }
  const created = input.stellar.createStellarPrivacyClientFromResolvedConfig(
    resolved.config,
  );
  if (!input.stellar.isStellarPrivacyClient(created)) {
    throw new Error("Privacy SDK client rejected during initialization.");
  }
  clientSlot = created;
  await created.upsertAssets([
    {
      id: 1,
      assetId: input.env.assetId,
      name: input.env.assetName,
      logoUrl: null,
      issuerAddress: null,
      clientContract: input.env.tokenContract,
      poolContracts: [input.env.poolContract],
      poolContract: input.env.poolContract,
      mintable: false,
      mintAmount: null,
      decimals: input.env.assetDecimals,
    },
  ]);
  return { publicKey: input.publicKey, client: created, memory };
}

async function resolveTransactionLayout(
  stellar: typeof import("@arcanetech/privacy-sdk-stellar"),
  env: DemoEnv,
): Promise<TransactionNoteLayout> {
  const zk = await importEsm<
    typeof import("@arcanetech/stellar-privacy-pool-zk-sdk")
  >("@arcanetech/stellar-privacy-pool-zk-sdk");
  const fromNonce = transactionNoteLayoutFromSdk(
    zk.layoutForKnownNonce(env.zkConfigNonce),
  );
  const live = transactionNoteLayoutFromSdk(
    (await stellar.getPrivacyPoolService().getInitializedSdk()).getLayout(),
  );
  if (fromNonce.nIns !== live.nIns || fromNonce.nOuts !== live.nOuts) {
    console.warn(
      `Nonce ${env.zkConfigNonce.toString()} table is ${fromNonce.nIns}x${fromNonce.nOuts}, initialized SDK is ${live.nIns}x${live.nOuts}`,
    );
  }
  return live;
}
