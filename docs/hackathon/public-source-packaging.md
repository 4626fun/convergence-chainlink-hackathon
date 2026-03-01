# Public Source Packaging Runbook

This runbook prepares a **public repo or sanitized public mirror** for Chainlink judging while excluding secrets.

## Scope to Include

Required project areas:
- `cre/cre-workflows/**`
- `cre/tests/**`
- `cre/utils/payoutIntegrityAi.ts`
- `cre/scripts/hackathon/mock-cre-api-server.mjs`
- `frontend/api/_handlers/cre/**`
- `frontend/api/_handlers/_routes.ts`
- `frontend/server/agent/eliza/llm.ts`
- `frontend/api/__tests__/creKeeperAiAssess.test.ts`
- `docs/hackathon/**`
- `cre/README.md`

## Secrets and Sensitive Files to Exclude

Do **not** publish:
- `cre/cre-workflows/.env`
- any `.env*` containing real values
- private keys, API keys, auth tokens, credentials

Keep `*.example` env templates only.

## Option A — Public Mirror Branch (recommended)

From your local repo root:

```bash
# 1) Create a clean branch for public export
git checkout -b public-chainlink-submission

# 2) Ensure no secret files are tracked
git rm --cached -f cre/cre-workflows/.env || true
git rm --cached -f "**/.env" || true

# 3) Quick secret scan (tune patterns as needed)
rg -n "(PRIVATE_KEY|API_KEY|SECRET|TOKEN|PASSWORD)" \
  --glob "!**/*.example" \
  --glob "!**/node_modules/**" .

# 4) Verify core submission artifacts exist
test -f docs/hackathon/chainlink-cre-submission.md
test -f docs/hackathon/video-script.md
test -f docs/hackathon/evidence/cre-payout-integrity-local-simulation.md
test -f docs/hackathon/evidence/cre-keepr-queue-local-simulation.md

# 5) Push to a public remote
git remote add public <PUBLIC_REPO_URL>
git push public public-chainlink-submission:main
```

## Option B — Sanitized Export Folder

If you prefer review before publishing:

```bash
mkdir -p /tmp/4626-chainlink-public
rsync -av --delete \
  --exclude ".git" \
  --exclude ".worktrees" \
  --exclude "node_modules" \
  --exclude "out" \
  --exclude "apps/docs-site/build" \
  --exclude ".env" \
  --exclude ".env.local" \
  --exclude ".env.*" \
  /home/akitav2/projects/4626/ /tmp/4626-chainlink-public/
```

Then run the same secret scan on `/tmp/4626-chainlink-public` before uploading to GitHub.

## Final Submission Checklist

- Public repo is accessible without auth
- `cre/README.md` has “Files Using Chainlink”
- Evidence logs are committed under `docs/hackathon/evidence/`
- Video (3-5 min) is uploaded and publicly viewable
- `docs/hackathon/chainlink-cre-submission.md` maps requirements to artifacts
