# Seechange E2E Runner

Public GitHub Actions executor for **private-repo** end-to-end tests.

**Duty:** accept a **registered repository name**, then **read / test / write
status on that same repository only**. `owner` + `repo` in the payload is the
target. Checkout, the test command, and commit status all use that pair (plus
the payload SHA). This runner never tests repo A and reports on repo B, and it
never checkouts a name that is not in [`profiles.json`](profiles.json).

This repository has **no product code**. Minutes are billed here, not to the
private repo.

Do not fork this repository and enable Actions. There is no `pull_request`
trigger on purpose: a fork PR would let anyone drive a checkout of a private
repo against a live DEV API.

Logs are public. This workflow never uploads artifacts, never prints `.env` /
tokens, and never records Playwright traces.

## How a private SHA points at this run

The private repo's `release.yml` (or equivalent) looks at commit status
`context` from the profile (TNS frontend: `e2e/release-gate`). The status
`target_url` is this public run:

`https://github.com/Seechange-edu/e2e-runner/actions/runs/<id>`

Click the status on the private commit → this run.

## First profile: TNS frontend

Only `Seechange-edu/think-and-speak-frontend` is registered in
[`profiles.json`](profiles.json). **Only that frontend repo may dispatch.**
Think & Speak backend / ai-tutor do not trigger E2E (gate spec §5.7 deferred).

| Item | Value |
| --- | --- |
| Event | `e2e-run` (alias `tns-frontend-e2e`) |
| Status context | `e2e/release-gate` |
| Command | private `scripts/run-affected.mjs --release --built --trace=off` |
| Concurrency | `e2e-tns-frontend` (queue, do not cancel) |
| Target environment | **UAT** (`E2E_ENV=uat` from the profile's `env`) |
| Probe | `https://uat-app-api.thinkandspeak.com/` |
| Timeout | `timeoutMinutes: 75` — see the note below before changing it |

`runAll=true` is **manual full runs only** (`workflow_dispatch`). Default
release cuts use the affected selector in the private repo.

### `timeoutMinutes` is paired with a watchdog

The private repo's `e2e-gate-watchdog.yml` reads `timeoutMinutes` out of THIS
file at runtime and fails any release tip that has been `pending` for longer
than `timeoutMinutes + 15`. Raising the timeout here therefore moves the
watchdog too, automatically — that is the point. Do not hard-code a deadline on
the private side.

Playwright image tag must stay aligned with the private `package.json`
(`@playwright/test ^1.57.0` → `mcr.microsoft.com/playwright:v1.57.0-jammy`).
Bump the tag in `profiles.json` when the private repo bumps Playwright.

## Dispatch contract

`repository_dispatch` `client_payload` (or matching `workflow_dispatch` inputs):

```json
{
  "owner": "Seechange-edu",
  "repo": "think-and-speak-frontend",
  "sha": "<40 hex>",
  "ref": "refs/heads/release/v1.2.3",
  "previous": "v1.2.2",
  "runAll": false,
  "reason": "release-push",
  "profile": "tns-frontend"
}
```

- Target key is **`owner` + `repo`**. It must match a row in `profiles.json`.
  Optional `profile` must be that row's `id`; it cannot point at a different repo.
- Checkout, install, test command, and `e2e/release-gate` (or the profile's
  `statusContext`) all use that same `owner/repo` + `sha`.
- `command` / `script` / `context` in the payload are ignored. How to run lives
  only in `profiles.json`.
- `reason` is `release-push` or `workflow_dispatch`. `backend-release-cut` is
  rejected.
- Unknown `owner/repo` fails **before** checkout.

## Credentials (`ACTION_TOKEN`, no GitHub App)

Both sides reuse the **existing org `ACTION_TOKEN`** (already used by frontend
`release.yml` / `release-gate.yml`; covers Seechange-edu repositories). Do not
create `E2E_TOKEN` or `TNS_E2E_DISPATCH_TOKEN`.

| Where | Secret | Used for |
| --- | --- | --- |
| **Frontend** (already there) | `ACTION_TOKEN` | `repository_dispatch` → this public runner |
| **This repo** (`e2e-runner`) | `ACTION_TOKEN` | checkout the registered private SHA + write commit status |
| **This repo** (`e2e-runner`) | `E2E_ACCOUNT_PASSWORD` | the one password every E2E account shares |

Add `ACTION_TOKEN` on e2e-runner as a **repository secret** with the same value
(or grant this repo an existing org secret of that name). `mint-token` uses it
first. `E2E_APP_ID` / `E2E_APP_PRIVATE_KEY` are optional and skipped when the PAT is set.

Ordinary org members do not create tokens. After the secret exists here, members
push `release/**` or run **E2E release gate** on the frontend.

## Org-admin setup (not done by this tree)

1. Create `Seechange-edu/e2e-runner` as **public**.
2. Settings → Actions → General:
   - Disable fork pull-request workflows from outside collaborators.
   - Require approval for first-time contributors.
   - Default `GITHUB_TOKEN` permissions: read (not read and write).
3. Put secret `ACTION_TOKEN` on this repo (same value as the private repos).
4. Put secret **`E2E_ACCOUNT_PASSWORD`** on this repo — one password, shared by
   every E2E account.

   There used to be ten secrets here, an EMAIL and a PASSWORD per role. Both
   halves of that were wrong. Emails are **not secrets** (they were already
   committed in plain text in the private repo), and per-role passwords bought
   no isolation — they all sat in this same store and would leak together. What
   they did buy was an org-admin ticket for every shard added.

   The roster now lives in the private repo at `tests/e2e/accounts.ts`, reviewed
   in a PR. Adding a shard is one array entry there; nothing changes here.

   The private suite has **no fallback password**: if this secret is missing the
   run fails immediately rather than quietly logging in as `Aa123456`.

   Which accounts have to exist, and what each needs configured (16 menu keys,
   finished questionnaire, an active journey plan), is
   `docs/e2e/e2e-release-gate-solution.md` §0.5.4 in the private repo. Short
   version: **N + 5 accounts, and N = 1 today** — sharding is not implemented.

   Addresses use the neutral prefix `tns-e2e-*`, never a real person's name:
   **logs here are public** and failure text prints the address.

5. Run **Probe API** once. Record the HTTP code below. If the runner cannot
   reach the target API (timeout / 000 / 5xx gateway), stop — do not checkout
   private code.

Recorded probe HTTP code: _(fill after first public run)_

## Add another private repo

This is a generic executor. A second product (for example CMS) is a new
profile, not a copy of the TNS workflow.

1. Add an object to `profiles.json` (allowlist + command + status context +
   concurrency group + probe URL + secrets names). **Code review this file.**
2. This repo's `ACTION_TOKEN` must be able to Contents-Read + statuses-Write **that** private repo (the org token already can).
3. Add that profile's account secrets on this repo.
4. If `runtime` is not `playwright`, add a job in
   `.github/workflows/e2e-run.yml` gated on that runtime. The first release
   only implements `playwright`. Non-secret, per-profile variables (which
   environment to build against, shard index) belong in that profile's `env`
   object, not in the workflow.
5. That private repo's own dispatcher sends `e2e-run` with **its**
   `owner/repo/sha`. TNS backend must not dispatch the TNS frontend profile.

## Local check of the allowlist script

```bash
E2E_OWNER=Seechange-edu \
E2E_REPO=think-and-speak-frontend \
E2E_SHA=0123456789abcdef0123456789abcdef01234567 \
E2E_REF=refs/heads/release/v1.0.0 \
E2E_REASON=release-push \
node scripts/resolve-profile.mjs
```

A repo that is not in `profiles.json` must exit 1 before any checkout.
