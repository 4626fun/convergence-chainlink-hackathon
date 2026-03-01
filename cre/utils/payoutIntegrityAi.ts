export type PayoutIntegrityAlertSeverity = 'info' | 'warning' | 'critical';

export type PayoutIntegrityAlertLike = {
  alertType: string;
  severity: PayoutIntegrityAlertSeverity;
  message: string;
  details?: Record<string, unknown>;
};

export type PayoutIntegrityAiVerdict = 'pass' | 'watch' | 'critical' | 'unknown';

export type PayoutIntegrityAiResult = {
  enabled: boolean;
  verdict: PayoutIntegrityAiVerdict;
  confidence: number | null;
  summary: string;
  suggestedAction: string;
  provider?: string;
  error?: string;
};

const MAX_SUMMARY_LENGTH = 280;
const MAX_ACTION_LENGTH = 220;

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function normalizeConfidence(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0 || value > 1) return null;
  return Number(value.toFixed(2));
}

function normalizeVerdict(value: unknown): PayoutIntegrityAiVerdict | null {
  const raw = toText(value).toLowerCase();
  if (raw === 'pass' || raw === 'watch' || raw === 'critical' || raw === 'unknown') {
    return raw;
  }
  return null;
}

function defaultSuggestedAction(verdict: PayoutIntegrityAiVerdict): string {
  if (verdict === 'critical') return 'Pause keeper-triggered writes and investigate immediately.';
  if (verdict === 'watch') return 'Review warnings and monitor closely on the next run.';
  if (verdict === 'pass') return 'No action required; continue normal monitoring cadence.';
  return 'Investigate telemetry and rerun checks.';
}

export function deriveDeterministicVerdict(
  alerts: ReadonlyArray<PayoutIntegrityAlertLike>,
): PayoutIntegrityAiVerdict {
  if (alerts.some((alert) => alert.severity === 'critical')) return 'critical';
  if (alerts.some((alert) => alert.severity === 'warning' || alert.severity === 'info')) return 'watch';
  return 'pass';
}

export function createAiFallbackResult(
  alerts: ReadonlyArray<PayoutIntegrityAlertLike>,
  error?: string,
): PayoutIntegrityAiResult {
  const verdict = deriveDeterministicVerdict(alerts);
  return {
    enabled: false,
    verdict,
    confidence: null,
    summary:
      alerts.length > 0
        ? `AI assessment unavailable; using deterministic checks with ${alerts.length} alert(s).`
        : 'AI assessment unavailable; deterministic checks indicate no active alerts.',
    suggestedAction: defaultSuggestedAction(verdict),
    ...(error ? { error } : {}),
  };
}

export function normalizeAiResult(
  raw: unknown,
  alerts: ReadonlyArray<PayoutIntegrityAlertLike>,
): PayoutIntegrityAiResult {
  const fallback = createAiFallbackResult(alerts);
  if (!raw || typeof raw !== 'object') return fallback;

  const source = raw as Record<string, unknown>;
  const verdict = normalizeVerdict(source.verdict) ?? fallback.verdict;
  const summary = truncate(toText(source.summary) || fallback.summary, MAX_SUMMARY_LENGTH);
  const suggestedAction = truncate(
    toText(source.suggestedAction) || defaultSuggestedAction(verdict),
    MAX_ACTION_LENGTH,
  );

  return {
    enabled: source.enabled === true,
    verdict,
    confidence: normalizeConfidence(source.confidence),
    summary,
    suggestedAction,
    ...(toText(source.provider) ? { provider: toText(source.provider) } : {}),
    ...(toText(source.error) ? { error: toText(source.error) } : {}),
  };
}
