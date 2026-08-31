#!/usr/bin/env node
/**
 * Validate a dispatch / workflow_dispatch payload against profiles.json.
 * Zero dependencies. Writes GitHub Actions outputs when GITHUB_OUTPUT is set.
 *
 * Identity is owner/repo: that name is looked up in the allowlist, then
 * checkout, test command, and commit status all target that same repository.
 *
 * Env in:
 *   E2E_OWNER, E2E_REPO, E2E_SHA, E2E_REF, E2E_PREVIOUS, E2E_RUN_ALL,
 *   E2E_REASON, E2E_PROFILE, E2E_EVENT_TYPE
 */
import { readFileSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHA_RE = /^[0-9a-f]{40}$/i
const PREVIOUS_RE = /^[A-Za-z0-9._/-]+$/
const RELEASE_REF_PREFIX = 'refs/heads/release/'
const ALLOWED_REASONS = new Set(['release-push', 'workflow_dispatch', ''])
const ALIAS_EVENT = 'tns-frontend-e2e'
const FALLBACK_CONTEXT = 'e2e/release-gate'

const file = JSON.parse(readFileSync(join(ROOT, 'profiles.json'), 'utf8'))
const profiles = Array.isArray(file.profiles) ? file.profiles : []

function trim(value) {
  if (value == null) return ''
  return String(value).trim()
}

function isTrue(value) {
  const v = trim(value).toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

function writeOutput(key, value) {
  const str = value == null ? '' : String(value)
  if (!process.env.GITHUB_OUTPUT) return
  if (str.includes('\n') || str.includes('\r')) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}<<EOF\n${str}\nEOF\n`)
    return
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${str}\n`)
}

function emit(fields) {
  for (const [key, value] of Object.entries(fields)) {
    writeOutput(key, value)
  }
}

function fail(message, extra = {}) {
  console.error(`::error::${message}`)
  emit({
    resolve_ok: 'false',
    write_status: extra.writeStatus ? 'true' : 'false',
    owner: extra.owner || '',
    repo: extra.repo || '',
    sha: extra.sha || '',
    status_context: extra.statusContext || FALLBACK_CONTEXT,
    error_message: message,
  })
  process.exit(1)
}

const eventType = trim(process.env.E2E_EVENT_TYPE)
if (eventType === 'backend-release-cut') {
  fail('event_type backend-release-cut is not accepted (TNS §5.7 deferred; frontend-only trigger)')
}

let owner = trim(process.env.E2E_OWNER)
let repo = trim(process.env.E2E_REPO)
const profileId = trim(process.env.E2E_PROFILE)
const shaRaw = trim(process.env.E2E_SHA)
const ref = trim(process.env.E2E_REF)
const previous = trim(process.env.E2E_PREVIOUS)
const runAll = isTrue(process.env.E2E_RUN_ALL)
const reason = trim(process.env.E2E_REASON)

// Alias only names the TNS frontend target. Generic e2e-run must send owner/repo.
if (eventType === ALIAS_EVENT) {
  if (!owner) owner = 'Seechange-edu'
  if (!repo) repo = 'think-and-speak-frontend'
}

if (!owner || !repo) {
  fail('payload missing owner/repo — this runner only accepts a registered repository name')
}

const profile = profiles.find((p) => p.owner === owner && p.repo === repo) || null

const shaValid = SHA_RE.test(shaRaw)
const sha = shaValid ? shaRaw.toLowerCase() : ''
const writeStatus = shaValid && Boolean(owner) && Boolean(repo)

if (!profile) {
  fail(`repo ${owner}/${repo} is not in the profile allowlist`, {
    writeStatus,
    owner,
    repo,
    sha,
  })
}

if (profileId && profileId !== profile.id) {
  fail(
    `profile '${profileId}' does not match registered repo ${owner}/${repo} (expected '${profile.id}')`,
    {
      writeStatus,
      owner,
      repo,
      sha,
      statusContext: profile.statusContext,
    },
  )
}

if (!shaValid) {
  fail('sha must be a 40-character hex commit', {
    writeStatus: false,
    owner,
    repo,
    statusContext: profile.statusContext,
  })
}

if (!ref) {
  fail('ref is required', {
    writeStatus: true,
    owner,
    repo,
    sha,
    statusContext: profile.statusContext,
  })
}

if (profile.requireReleaseRef && !ref.startsWith(RELEASE_REF_PREFIX) && !runAll) {
  fail(`ref must start with ${RELEASE_REF_PREFIX} (runAll=true is the manual exception)`, {
    writeStatus: true,
    owner,
    repo,
    sha,
    statusContext: profile.statusContext,
  })
}

if (runAll && !ref.startsWith(RELEASE_REF_PREFIX)) {
  console.log(
    `::warning::runAll=true with non-release ref '${ref}' — allowed for manual full runs only`,
  )
}

if (reason && !ALLOWED_REASONS.has(reason)) {
  fail(`reason '${reason}' is not allowed (expected release-push | workflow_dispatch)`, {
    writeStatus: true,
    owner,
    repo,
    sha,
    statusContext: profile.statusContext,
  })
}

if (previous && !PREVIOUS_RE.test(previous)) {
  fail('previous contains characters that are not allowed in a tag/ref', {
    writeStatus: true,
    owner,
    repo,
    sha,
    statusContext: profile.statusContext,
  })
}

const commandBase = runAll ? profile.commandAll : profile.commandAffected
if (!commandBase) {
  fail(`profile '${profile.id}' is missing commandAffected/commandAll`, {
    writeStatus: true,
    owner,
    repo,
    sha,
    statusContext: profile.statusContext,
  })
}

const command = previous ? `${commandBase} --previous=${previous}` : commandBase
/**
 * How many runners this profile's suite is split across, and the matrix that
 * spawns them.
 *
 * The split itself is the target repo's business (its scripts/e2e-shard.mjs
 * decides which modules a shard owns); all this side does is say how many and
 * hand each runner its index. Absent or 1 means one runner and a `[0]` matrix —
 * the same single job the workflow ran before sharding existed, so a profile
 * that never sets `shards` is unaffected.
 *
 * 🔴 shards must not exceed the account groups in the target's
 * tests/e2e/accounts.ts, or two runners drive one student mailbox. That check
 * cannot live here (this repo cannot see that roster), so accounts.ts throws on
 * it instead, using the E2E_SHARD_TOTAL the workflow passes down.
 */
const shards = Math.max(1, Math.floor(Number(profile.shards) || 1))
const shardMatrix = JSON.stringify(Array.from({ length: shards }, (_, i) => i))
/**
 * The Playwright version the target's suite runs as, read off the profile's
 * container tag: `mcr.microsoft.com/playwright:v1.57.0-jammy` -> `1.57.0`.
 *
 * The merge-report job needs it. `playwright merge-reports` refuses blob
 * reports written by a different version, and that job runs OUTSIDE the
 * container on purpose (pulling a ~2 GB browser image just to unzip reports
 * costs more than the merge), so it cannot read the version off a local
 * install. Deriving it from the container instead of adding a second field
 * keeps the two from drifting: the image IS what wrote the blobs.
 *
 * Empty when the container carries no `:v<x.y.z>` tag. The workflow turns that
 * into a readable error rather than guessing a version and failing later on an
 * unreadable report-format mismatch.
 */
const playwrightVersion =
  String(profile.container || '').match(/:v(\d+\.\d+\.\d+)/)?.[1] || ''
const secretEnv = Array.isArray(profile.secretEnv) ? profile.secretEnv.join(',') : ''
// Non-secret, profile-pinned environment for the test step (E2E_ENV, shard
// index, ...). Kept in profiles.json rather than in the workflow so a second
// product can point at its own environment without editing e2e-run.yml.
const profileEnv = JSON.stringify(profile.env && typeof profile.env === 'object' ? profile.env : {})

emit({
  resolve_ok: 'true',
  write_status: 'true',
  owner: profile.owner,
  repo: profile.repo,
  sha,
  ref,
  previous,
  run_all: runAll ? 'true' : 'false',
  reason,
  profile_id: profile.id,
  status_context: profile.statusContext,
  runtime: profile.runtime,
  container: profile.container || '',
  playwright_version: playwrightVersion,
  timeoutMinutes: String(profile.timeoutMinutes || 75),
  shards: String(shards),
  shard_matrix: shardMatrix,
  concurrencyGroup: profile.concurrencyGroup,
  probe_url: profile.probeUrl || '',
  install: profile.install || '',
  command,
  secret_env: secretEnv,
  profile_env: profileEnv,
  error_message: '',
})

console.log(`profile=${profile.id} ${profile.owner}/${profile.repo}@${sha}`)
console.log(`runtime=${profile.runtime} runAll=${runAll} ref=${ref} shards=${shards}`)
if (runAll) console.log('command mode: full journey (--run-all)')
else console.log('command mode: affected journey')
process.exit(0)
