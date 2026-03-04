import { getDb, isDbConfigured } from "../postgres.js"

let runtimeSchemaEnsured = false

export async function ensureCreRuntimeSchema(): Promise<void> {
  if (!isDbConfigured()) return
  if (runtimeSchemaEnsured) return

  const db = await getDb()
  if (!db) return

  try {
    await db.sql`
      CREATE TABLE IF NOT EXISTS cre_runtime_records (
        id BIGSERIAL PRIMARY KEY,
        workflow TEXT NOT NULL,
        kind TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        payload_json JSONB NOT NULL,
        source TEXT NOT NULL DEFAULT 'cre',
        correlation_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (workflow, kind, idempotency_key)
      );
    `
    await db.sql`
      CREATE INDEX IF NOT EXISTS cre_runtime_records_kind_created_idx
      ON cre_runtime_records (kind, created_at DESC);
    `

    await db.sql`
      CREATE TABLE IF NOT EXISTS cre_runtime_decisions (
        id BIGSERIAL PRIMARY KEY,
        workflow TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        decision_json JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'stored',
        correlation_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (workflow, idempotency_key)
      );
    `
    await db.sql`
      CREATE INDEX IF NOT EXISTS cre_runtime_decisions_created_idx
      ON cre_runtime_decisions (created_at DESC);
    `

    await db.sql`
      CREATE TABLE IF NOT EXISTS cre_runtime_replay_nonces (
        nonce TEXT PRIMARY KEY,
        issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      );
    `
    await db.sql`
      CREATE INDEX IF NOT EXISTS cre_runtime_replay_expires_idx
      ON cre_runtime_replay_nonces (expires_at);
    `

    runtimeSchemaEnsured = true
  } catch (error) {
    runtimeSchemaEnsured = false
    throw error
  }
}
