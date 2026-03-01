/**
 * Unit tests for Vault Keeper action logic.
 *
 * These tests verify the decision logic (shouldTend, shouldReport)
 * without making actual onchain calls.
 */

import { describe, it, expect } from 'vitest';
import { shouldTend, shouldReport, type VaultState } from '../actions/vault-keeper.action.js';
import { REPORT_INTERVAL_SECONDS } from '../config.js';

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

const SAMPLE_VAULT = '0x1234567890123456789012345678901234567890' as `0x${string}`;

function createVaultState(overrides: Partial<VaultState> = {}): VaultState {
  return {
    vaultAddress: SAMPLE_VAULT,
    coinBalance: 10n * 10n ** 18n, // 10 tokens
    deploymentThreshold: 5n * 10n ** 18n, // 5 tokens
    minimumTotalIdle: 2n * 10n ** 18n, // 2 tokens
    totalStrategyWeight: 10000n, // 100%
    lastReport: BigInt(Math.floor(Date.now() / 1000) - 3600), // 1 hour ago
    isShutdown: false,
    paused: false,
    totalAssets: 100n * 10n ** 18n,
    totalAssetsAtLastReport: 95n * 10n ** 18n,
    blockTimestamp: BigInt(Math.floor(Date.now() / 1000)),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// shouldTend() tests
// ---------------------------------------------------------------------------

describe('shouldTend', () => {
  it('returns true when coinBalance > deploymentThreshold', () => {
    const state = createVaultState({
      coinBalance: 10n * 10n ** 18n,
      deploymentThreshold: 5n * 10n ** 18n,
      minimumTotalIdle: 2n * 10n ** 18n,
    });
    expect(shouldTend(state)).toBe(true);
  });

  it('returns false when coinBalance < deploymentThreshold', () => {
    const state = createVaultState({
      coinBalance: 3n * 10n ** 18n,
      deploymentThreshold: 5n * 10n ** 18n,
      minimumTotalIdle: 2n * 10n ** 18n,
    });
    expect(shouldTend(state)).toBe(false);
  });

  it('uses minimumTotalIdle when higher than deploymentThreshold', () => {
    const state = createVaultState({
      coinBalance: 10n * 10n ** 18n,
      deploymentThreshold: 5n * 10n ** 18n,
      minimumTotalIdle: 15n * 10n ** 18n, // Higher than deployment threshold
    });
    // coinBalance (10) is not > minimumTotalIdle (15)
    expect(shouldTend(state)).toBe(false);
  });

  it('returns false when vault is shutdown', () => {
    const state = createVaultState({
      isShutdown: true,
      coinBalance: 100n * 10n ** 18n,
    });
    expect(shouldTend(state)).toBe(false);
  });

  it('returns false when vault is paused', () => {
    const state = createVaultState({
      paused: true,
      coinBalance: 100n * 10n ** 18n,
    });
    expect(shouldTend(state)).toBe(false);
  });

  it('returns false when no strategies are active', () => {
    const state = createVaultState({
      totalStrategyWeight: 0n,
      coinBalance: 100n * 10n ** 18n,
    });
    expect(shouldTend(state)).toBe(false);
  });

  it('returns false when coinBalance equals threshold exactly', () => {
    const state = createVaultState({
      coinBalance: 5n * 10n ** 18n,
      deploymentThreshold: 5n * 10n ** 18n,
      minimumTotalIdle: 2n * 10n ** 18n,
    });
    expect(shouldTend(state)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldReport() tests
// ---------------------------------------------------------------------------

describe('shouldReport', () => {
  it('returns true when > 24h since last report', () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const state = createVaultState({
      lastReport: now - BigInt(REPORT_INTERVAL_SECONDS + 1),
      blockTimestamp: now,
    });
    expect(shouldReport(state)).toBe(true);
  });

  it('returns false when < 24h since last report', () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const state = createVaultState({
      lastReport: now - BigInt(REPORT_INTERVAL_SECONDS - 1000),
      blockTimestamp: now,
    });
    expect(shouldReport(state)).toBe(false);
  });

  it('returns false when exactly 24h since last report', () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const state = createVaultState({
      lastReport: now - BigInt(REPORT_INTERVAL_SECONDS),
      blockTimestamp: now,
    });
    expect(shouldReport(state)).toBe(false);
  });

  it('returns false when vault is shutdown', () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const state = createVaultState({
      isShutdown: true,
      lastReport: now - BigInt(REPORT_INTERVAL_SECONDS * 2),
      blockTimestamp: now,
    });
    expect(shouldReport(state)).toBe(false);
  });

  it('returns false when vault is paused', () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const state = createVaultState({
      paused: true,
      lastReport: now - BigInt(REPORT_INTERVAL_SECONDS * 2),
      blockTimestamp: now,
    });
    expect(shouldReport(state)).toBe(false);
  });

  it('returns false when no strategies are active', () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const state = createVaultState({
      totalStrategyWeight: 0n,
      lastReport: now - BigInt(REPORT_INTERVAL_SECONDS * 2),
      blockTimestamp: now,
    });
    expect(shouldReport(state)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('handles zero coinBalance', () => {
    const state = createVaultState({ coinBalance: 0n });
    expect(shouldTend(state)).toBe(false);
  });

  it('handles very large balances', () => {
    const state = createVaultState({
      coinBalance: 10n ** 30n, // 1 trillion tokens
      deploymentThreshold: 10n ** 20n,
    });
    expect(shouldTend(state)).toBe(true);
  });

  it('handles lastReport of 0 (never reported)', () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const state = createVaultState({
      lastReport: 0n,
      blockTimestamp: now,
    });
    expect(shouldReport(state)).toBe(true);
  });
});
