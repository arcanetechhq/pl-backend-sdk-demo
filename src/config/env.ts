export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name} environment variable`);
  }
  return value;
}

export function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

export function optionalNonEmptyEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

const DECIMAL_APPLICATION_ID = /^\d+$/u;

export function requireDecimalApplicationId(value: string): string {
  if (!DECIMAL_APPLICATION_ID.test(value)) {
    throw new Error(
      "APPLICATION_ID must be association.audit_id (decimal Fr), not a UUID or foreignId.",
    );
  }
  return value;
}

export function defaultProveWorkers(accountCount: number): number {
  return Math.min(2, Math.max(1, Math.floor(accountCount / 2)));
}

export function parsePositiveNumber(name: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

export function intervalMsFromMinutes(minutes: number): number {
  return Math.max(1000, Math.round(minutes * 60_000));
}

export type DemoEnv = {
  port: number;
  databaseUrl: string;
  relayerOrigin: string;
  mnemonic: string;
  accountCount: number;
  proveWorkers: number;
  networkPassphrase: string;
  horizonUrl: string;
  sorobanRpcUrl: string;
  friendbotUrl: string;
  poolContract: string;
  registryContract: string;
  kytPassageRegistryContract: string;
  kytApiBaseUrl: string;
  kytInspectToken: string | undefined;
  applicationId: string;
  auditPublicKeyHex: string;
  zkConfigNonce: bigint;
  zkArtifactBaseUrl: string | undefined;
  assetId: string;
  tokenContract: string;
  assetName: string;
  assetDecimals: number;
  databaseCA: string | undefined;
  txIntervalMinutes: number;
  txAmountXlm: number;
  depositAmountXlm: number;
};

export function loadDemoEnv(): DemoEnv {
  const zkArtifactBaseUrl = process.env.ZK_ARTIFACT_BASE_URL?.trim();
  const kytInspectToken = optionalNonEmptyEnv("KYT_INSPECT_TOKEN");
  const accountCount = Number.parseInt(optionalEnv("ACCOUNT_COUNT", "5"), 10);
  return {
    port: Number.parseInt(optionalEnv("PORT", "3000"), 10),
    databaseUrl: requiredEnv("DATABASE_URL"),
    relayerOrigin: requiredEnv("RELAYER_ORIGIN").replace(/\/$/u, ""),
    mnemonic: requiredEnv("STELLAR_MNEMONIC"),
    accountCount,
    proveWorkers: Math.max(
      1,
      Number.parseInt(
        optionalEnv("PROVE_WORKERS", String(defaultProveWorkers(accountCount))),
        10,
      ),
    ),
    networkPassphrase: optionalEnv(
      "STELLAR_NETWORK_PASSPHRASE",
      "Test SDF Network ; September 2015",
    ),
    horizonUrl: optionalEnv(
      "HORIZON_URL",
      "https://horizon-testnet.stellar.org",
    ),
    sorobanRpcUrl: optionalEnv(
      "SOROBAN_RPC_URL",
      "https://soroban-testnet.stellar.org",
    ),
    friendbotUrl: optionalEnv("FRIENDBOT_URL", "https://friendbot.stellar.org"),
    poolContract: requiredEnv("POOL_CONTRACT"),
    registryContract: requiredEnv("REGISTRY_CONTRACT"),
    kytPassageRegistryContract: requiredEnv("KYT_PASSAGE_REGISTRY_CONTRACT"),
    kytApiBaseUrl: requiredEnv("KYT_API_BASE_URL").replace(/\/$/u, ""),
    ...(kytInspectToken ? { kytInspectToken } : { kytInspectToken: undefined }),
    applicationId: requireDecimalApplicationId(requiredEnv("APPLICATION_ID")),
    auditPublicKeyHex: requiredEnv("STELLAR_AUDIT_PUBLIC_KEY"),
    zkConfigNonce: BigInt(optionalEnv("ZK_CONFIG_NONCE", "3")),
    ...(zkArtifactBaseUrl
      ? { zkArtifactBaseUrl }
      : { zkArtifactBaseUrl: undefined }),
    assetId: optionalEnv("ASSET_ID", "XLM"),
    tokenContract: optionalEnv(
      "TOKEN_CONTRACT",
      "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    ),
    assetName: optionalEnv("ASSET_NAME", "Stellar"),
    assetDecimals: Number.parseInt(optionalEnv("ASSET_DECIMALS", "7"), 10),
    databaseCA: optionalNonEmptyEnv("DATABASE_CA"),
    txIntervalMinutes: parsePositiveNumber(
      "TX_INTERVAL_MINUTES",
      optionalEnv("TX_INTERVAL_MINUTES", "30"),
    ),
    txAmountXlm: parsePositiveNumber(
      "TX_AMOUNT_XLM",
      optionalEnv("TX_AMOUNT_XLM", "1"),
    ),
    depositAmountXlm: parsePositiveNumber(
      "DEPOSIT_AMOUNT_XLM",
      optionalEnv("DEPOSIT_AMOUNT_XLM", "10"),
    ),
  };
}
