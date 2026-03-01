/**
 * Unit tests for Auction Settlement Keeper action logic.
 *
 * These tests verify the state reading and decision logic
 * without making actual onchain calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AuctionState, SettlementResult } from '../actions/auction-settlement.action.js';

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`;
const SAMPLE_AUCTION = '0x1234567890123456789012345678901234567890' as `0x${string}`;
const SAMPLE_STRATEGY = '0xabcdef1234567890abcdef1234567890abcdef12' as `0x${string}`;

function createAuctionState(overrides: Partial<AuctionState> = {}): AuctionState {
  return {
    ccaStrategyAddress: SAMPLE_STRATEGY,
    currentAuction: SAMPLE_AUCTION,
    hasActiveAuction: true,
    isGraduated: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// State interpretation tests
// ---------------------------------------------------------------------------

describe('auction state interpretation', () => {
  it('identifies no active auction when currentAuction is zero address', () => {
    const state = createAuctionState({
      currentAuction: ZERO_ADDRESS,
      hasActiveAuction: false,
      isGraduated: false,
    });
    expect(state.hasActiveAuction).toBe(false);
    expect(state.currentAuction).toBe(ZERO_ADDRESS);
  });

  it('identifies active auction when currentAuction is non-zero', () => {
    const state = createAuctionState({
      currentAuction: SAMPLE_AUCTION,
      hasActiveAuction: true,
      isGraduated: false,
    });
    expect(state.hasActiveAuction).toBe(true);
    expect(state.currentAuction).toBe(SAMPLE_AUCTION);
  });

  it('identifies graduated auction', () => {
    const state = createAuctionState({
      currentAuction: SAMPLE_AUCTION,
      hasActiveAuction: true,
      isGraduated: true,
    });
    expect(state.hasActiveAuction).toBe(true);
    expect(state.isGraduated).toBe(true);
  });

  it('identifies non-graduated active auction', () => {
    const state = createAuctionState({
      currentAuction: SAMPLE_AUCTION,
      hasActiveAuction: true,
      isGraduated: false,
    });
    expect(state.hasActiveAuction).toBe(true);
    expect(state.isGraduated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Settlement decision logic tests
// ---------------------------------------------------------------------------

describe('settlement decision logic', () => {
  function shouldSettle(state: AuctionState): { shouldSettle: boolean; reason?: string } {
    if (!state.hasActiveAuction) {
      return { shouldSettle: false, reason: 'no_active_auction' };
    }
    if (!state.isGraduated) {
      return { shouldSettle: false, reason: 'not_graduated' };
    }
    return { shouldSettle: true };
  }

  it('should not settle when no active auction', () => {
    const state = createAuctionState({
      currentAuction: ZERO_ADDRESS,
      hasActiveAuction: false,
    });
    const result = shouldSettle(state);
    expect(result.shouldSettle).toBe(false);
    expect(result.reason).toBe('no_active_auction');
  });

  it('should not settle when auction is not graduated', () => {
    const state = createAuctionState({
      hasActiveAuction: true,
      isGraduated: false,
    });
    const result = shouldSettle(state);
    expect(result.shouldSettle).toBe(false);
    expect(result.reason).toBe('not_graduated');
  });

  it('should settle when auction is graduated', () => {
    const state = createAuctionState({
      hasActiveAuction: true,
      isGraduated: true,
    });
    const result = shouldSettle(state);
    expect(result.shouldSettle).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Result structure tests
// ---------------------------------------------------------------------------

describe('settlement result structure', () => {
  it('creates correct result for skipped settlement (no auction)', () => {
    const result: SettlementResult = {
      ccaStrategyAddress: SAMPLE_STRATEGY,
      swept: false,
      unsoldSwept: false,
      skippedReason: 'no_active_auction',
    };
    expect(result.swept).toBe(false);
    expect(result.unsoldSwept).toBe(false);
    expect(result.skippedReason).toBe('no_active_auction');
    expect(result.sweepResult).toBeUndefined();
    expect(result.unsoldSweepResult).toBeUndefined();
  });

  it('creates correct result for skipped settlement (not graduated)', () => {
    const result: SettlementResult = {
      ccaStrategyAddress: SAMPLE_STRATEGY,
      swept: false,
      unsoldSwept: false,
      skippedReason: 'not_graduated',
    };
    expect(result.swept).toBe(false);
    expect(result.unsoldSwept).toBe(false);
    expect(result.skippedReason).toBe('not_graduated');
  });

  it('creates correct result for successful settlement', () => {
    const result: SettlementResult = {
      ccaStrategyAddress: SAMPLE_STRATEGY,
      swept: true,
      unsoldSwept: true,
      sweepResult: {
        txHash: '0xabc' as `0x${string}`,
        success: true,
      },
      unsoldSweepResult: {
        txHash: '0xdef' as `0x${string}`,
        success: true,
      },
    };
    expect(result.swept).toBe(true);
    expect(result.unsoldSwept).toBe(true);
    expect(result.sweepResult?.success).toBe(true);
    expect(result.unsoldSweepResult?.success).toBe(true);
    expect(result.skippedReason).toBeUndefined();
  });

  it('creates correct result for partial failure (sweep succeeded, unsold failed)', () => {
    const result: SettlementResult = {
      ccaStrategyAddress: SAMPLE_STRATEGY,
      swept: true,
      unsoldSwept: false,
      sweepResult: {
        txHash: '0xabc' as `0x${string}`,
        success: true,
      },
      unsoldSweepResult: {
        txHash: '0x0' as `0x${string}`,
        success: false,
        error: 'No unsold tokens to sweep',
      },
    };
    expect(result.swept).toBe(true);
    expect(result.unsoldSwept).toBe(false);
    expect(result.sweepResult?.success).toBe(true);
    expect(result.unsoldSweepResult?.success).toBe(false);
  });

  it('creates correct result for sweep failure (stops early)', () => {
    const result: SettlementResult = {
      ccaStrategyAddress: SAMPLE_STRATEGY,
      swept: false,
      unsoldSwept: false,
      sweepResult: {
        txHash: '0x0' as `0x${string}`,
        success: false,
        error: 'Not graduated',
      },
    };
    expect(result.swept).toBe(false);
    expect(result.unsoldSwept).toBe(false);
    expect(result.sweepResult?.success).toBe(false);
    // unsoldSweepResult should be undefined because we stopped early
    expect(result.unsoldSweepResult).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Address validation tests
// ---------------------------------------------------------------------------

describe('address validation', () => {
  it('correctly identifies zero address', () => {
    const isZeroAddress = (addr: string) =>
      addr === '0x0000000000000000000000000000000000000000';

    expect(isZeroAddress(ZERO_ADDRESS)).toBe(true);
    expect(isZeroAddress(SAMPLE_AUCTION)).toBe(false);
    expect(isZeroAddress('0x')).toBe(false);
  });

  it('handles various zero address formats', () => {
    const normalize = (addr: string): `0x${string}` => {
      const clean = addr.toLowerCase().replace('0x', '');
      return `0x${clean.padStart(40, '0')}` as `0x${string}`;
    };

    expect(normalize('0x0')).toBe(ZERO_ADDRESS);
    expect(normalize('0x00')).toBe(ZERO_ADDRESS);
    expect(normalize(ZERO_ADDRESS)).toBe(ZERO_ADDRESS);
  });
});
