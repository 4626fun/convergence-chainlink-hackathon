import { describe, expect, it } from 'vitest';

import {
  createAiFallbackResult,
  deriveDeterministicVerdict,
  normalizeAiResult,
  type PayoutIntegrityAlertLike,
} from '../utils/payoutIntegrityAi.js';

const warningAlert: PayoutIntegrityAlertLike = {
  alertType: 'gauge_distribution_stale',
  severity: 'warning',
  message: 'Distribution is stale',
};

const criticalAlert: PayoutIntegrityAlertLike = {
  alertType: 'payout_recipient_mismatch',
  severity: 'critical',
  message: 'Recipient mismatch',
};

describe('deriveDeterministicVerdict', () => {
  it('returns critical when any critical alert is present', () => {
    expect(deriveDeterministicVerdict([warningAlert, criticalAlert])).toBe('critical');
  });

  it('returns watch when only warning/info alerts are present', () => {
    expect(deriveDeterministicVerdict([warningAlert])).toBe('watch');
  });

  it('returns pass when there are no alerts', () => {
    expect(deriveDeterministicVerdict([])).toBe('pass');
  });
});

describe('createAiFallbackResult', () => {
  it('uses deterministic verdict and default message text', () => {
    const result = createAiFallbackResult([warningAlert], 'llm_unavailable');

    expect(result.enabled).toBe(false);
    expect(result.verdict).toBe('watch');
    expect(result.summary).toContain('deterministic');
    expect(result.error).toBe('llm_unavailable');
  });
});

describe('normalizeAiResult', () => {
  it('normalizes valid AI output fields', () => {
    const result = normalizeAiResult(
      {
        enabled: true,
        verdict: 'critical',
        confidence: 0.94,
        summary: 'Critical mismatch across payout wiring.',
        suggestedAction: 'Pause automation and investigate wiring.',
        provider: 'Groq',
      },
      [criticalAlert],
    );

    expect(result.enabled).toBe(true);
    expect(result.verdict).toBe('critical');
    expect(result.confidence).toBe(0.94);
    expect(result.provider).toBe('Groq');
  });

  it('falls back safely on malformed AI output', () => {
    const result = normalizeAiResult(
      {
        enabled: true,
        verdict: 'definitely-fine',
        confidence: 5,
        summary: '',
        suggestedAction: '',
      },
      [criticalAlert],
    );

    expect(result.enabled).toBe(true);
    expect(result.verdict).toBe('critical');
    expect(result.confidence).toBe(null);
    expect(result.summary.length).toBeGreaterThan(0);
  });
});
