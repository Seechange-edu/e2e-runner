#!/usr/bin/env node
/**
 * Validate a `manual-run` dispatch against profiles.json (manual-run.yml).
 * Zero dependencies. Reads the payload from $GITHUB_EVENT_PATH and writes
 * GitHub Actions outputs.
 *
 * 🔴 The payload carries the manual account's password. It is checked for
 * presence here and NEVER emitted, logged or put in an output: outputs and
 * logs are public. The job that needs it reads it from the event file itself
 * and masks it first (manual-run.yml, "Generate the manual").
 */
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SHA_RE = /^[0-9a-f]{40}$/i
// Release tags only (build-manual.mjs names the document after it), including
// letter-suffixed ones such as v3.12.2-a, which ship to PROD as well.
const TAG_RE = /^v\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$/

const text = (value) => (value == null ? '' : String(value).trim())

export function resolveManual(payload, profiles) {
  const owner = text(payload.owner)
  const repo = text(payload.repo)
  const profile = profiles.find((p) => p.owner === owner && p.repo === repo)
  if (!profile) throw new Error(`${owner}/${repo} is not registered in profiles.json`)
  if (!profile.manual) throw new Error(`${owner}/${repo} has no manual profile`)

  const sha = text(payload.sha)
  if (!SHA_RE.test(sha)) throw new Error('sha must be 40 hex characters')
  const tag = text(payload.tag)
  if (!TAG_RE.test(tag)) throw new Error(`tag must look like v1.2.3, got '${tag}'`)
  if (!text(payload.email)) throw new Error('email is missing from the payload')
  if (!text(payload.password)) throw new Error('password is missing from the payload')

  const m = profile.manual
  return {
    owner,
    repo,
    sha,
    tag,
    profile_id: profile.id,
    container: profile.container || '',
    install: profile.install || '',
    yarn_cache: profile.yarnCache || '',
    status_context: m.statusContext,
    timeoutMinutes: String(m.timeoutMinutes || 60),
    env_file: m.envFile || '',
    command: m.command,
    build: m.build,
    asset: String(m.asset || '').replaceAll('{tag}', tag),
    deploy_repo: m.deployRepo || '',
    deploy_prefix: m.deployPrefix || '',
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const { profiles = [] } = JSON.parse(readFileSync(join(root, 'profiles.json'), 'utf8'))
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  try {
    const out = resolveManual(event.client_payload || {}, profiles)
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        Object.entries(out).map(([k, v]) => `${k}=${v}\n`).join(''),
      )
    }
    console.log(`manual ${out.owner}/${out.repo} ${out.tag}@${out.sha}`)
  } catch (err) {
    console.log(`::error::${err.message}`)
    process.exit(1)
  }
}
