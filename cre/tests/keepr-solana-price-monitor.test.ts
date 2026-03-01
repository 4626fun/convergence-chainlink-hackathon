import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  readContractMock,
  fetchActiveVaultsMock,
  alertInfoMock,
  alertWarningMock,
  alertCriticalMock,
  loadKeeperKeypairMock,
} = vi.hoisted(() => ({
  readContractMock: vi.fn(),
  fetchActiveVaultsMock: vi.fn(),
  alertInfoMock: vi.fn(async () => {}),
  alertWarningMock: vi.fn(async () => {}),
  alertCriticalMock: vi.fn(async () => {}),
  loadKeeperKeypairMock: vi.fn(),
}));

vi.mock('../utils/onchain.js', () => ({
  readContract: readContractMock,
}));

vi.mock('../utils/registry.js', () => ({
  fetchActiveVaults: fetchActiveVaultsMock,
}));

vi.mock('../utils/alerts.js', () => ({
  alertInfo: alertInfoMock,
  alertWarning: alertWarningMock,
  alertCritical: alertCriticalMock,
}));

vi.mock('../utils/solana.js', () => ({
  loadKeeperKeypair: loadKeeperKeypairMock,
}));

import { executeSolanaPriceMonitor } from '../actions/keepr-solana-price-monitor.action.js';

const ENV_KEYS = [
  'ORACLE_ADDRESS',
  'DLMM_POOL_ADDRESS',
  'CREATOR_COIN_ADDRESS',
  'CREATOR_COIN',
  'VAULT_ADDRESS',
  'SOLANA_RPC_URL',
  'SOL_PRICE_USD',
] as const;

const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as Record<string, string | undefined>;

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe('keepr solana price monitor dynamic config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readContractMock.mockResolvedValue(0n);
    fetchActiveVaultsMock.mockResolvedValue([]);
    setEnv('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com');
    setEnv('SOL_PRICE_USD', '200');
    setEnv('DLMM_POOL_ADDRESS', 'So11111111111111111111111111111111111111112');
    setEnv('CREATOR_COIN_ADDRESS', undefined);
    setEnv('CREATOR_COIN', undefined);
    setEnv('VAULT_ADDRESS', undefined);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      setEnv(key, ORIGINAL_ENV[key]);
    }
  });

  it('falls back to registry oracle when ORACLE_ADDRESS is placeholder', async () => {
    setEnv('ORACLE_ADDRESS', '0xCreatorOracle');
    setEnv('CREATOR_COIN_ADDRESS', '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

    fetchActiveVaultsMock.mockResolvedValue([
      {
        vaultAddress: '0x1111111111111111111111111111111111111111',
        chainId: 8453,
        creatorCoinAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        oracleAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        groupId: 'group-a',
      },
      {
        vaultAddress: '0x2222222222222222222222222222222222222222',
        chainId: 8453,
        creatorCoinAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        oracleAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
        groupId: 'group-b',
      },
    ]);

    const result = await executeSolanaPriceMonitor();

    expect(fetchActiveVaultsMock).toHaveBeenCalledWith(8453);
    expect(readContractMock).toHaveBeenCalledWith(
      expect.objectContaining({
        address: '0xcccccccccccccccccccccccccccccccccccccccc',
        functionName: 'creatorPriceUSD',
      }),
    );
    expect(result.basePriceUsd).toBe('0.000000');
  });

  it('prefers a valid ORACLE_ADDRESS from env and skips registry lookup', async () => {
    setEnv('ORACLE_ADDRESS', '0x8C044aeF10d05bcC53912869db89f6e1f37bC6fC');

    await executeSolanaPriceMonitor();

    expect(fetchActiveVaultsMock).not.toHaveBeenCalled();
    expect(readContractMock).toHaveBeenCalledWith(
      expect.objectContaining({
        address: '0x8C044aeF10d05bcC53912869db89f6e1f37bC6fC',
        functionName: 'creatorPriceUSD',
      }),
    );
  });

  it('handles invalid DLMM_POOL_ADDRESS without throwing after reading oracle', async () => {
    setEnv('ORACLE_ADDRESS', '0x8C044aeF10d05bcC53912869db89f6e1f37bC6fC');
    setEnv('DLMM_POOL_ADDRESS', 'DLMM_Pool_Pubkey');
    readContractMock.mockResolvedValue(1_230_000_000_000_000_000n);

    const result = await executeSolanaPriceMonitor();

    expect(result.basePriceUsd).toBe('1.230000');
    expect(result.solanaPriceUsd).toBe('0');
    expect(result.action).toBe('none');
    expect(loadKeeperKeypairMock).not.toHaveBeenCalled();
  });

  it('shows additional decimals for tiny non-zero oracle prices', async () => {
    setEnv('ORACLE_ADDRESS', '0x8C044aeF10d05bcC53912869db89f6e1f37bC6fC');
    setEnv('DLMM_POOL_ADDRESS', 'DLMM_Pool_Pubkey');
    // 0.000000003501889432 USD (1e18-scaled oracle value)
    readContractMock.mockResolvedValue(3_501_889_432n);

    const result = await executeSolanaPriceMonitor();

    expect(result.basePriceUsd).toBe('0.000000003502');
    expect(result.solanaPriceUsd).toBe('0');
    expect(result.action).toBe('none');
  });

  it('derives oracle creator-per-sol when oracle and SOL price are available', async () => {
    setEnv('ORACLE_ADDRESS', '0x8C044aeF10d05bcC53912869db89f6e1f37bC6fC');
    setEnv('DLMM_POOL_ADDRESS', 'DLMM_Pool_Pubkey');
    setEnv('SOL_PRICE_USD', '200');
    readContractMock.mockResolvedValue(2_000_000_000_000_000_000n); // $2.00 per creator coin

    const result = await executeSolanaPriceMonitor();

    expect(result.basePriceUsd).toBe('2.000000');
    expect(result.oracleCreatorPerSol).toBe('100.00');
    expect(result.solanaCreatorPerSol).toBeUndefined();
  });
});
