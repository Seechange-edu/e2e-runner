#!/usr/bin/env node
/**
 * Attach one file to the GitHub Release of a tag, replacing a same-name asset
 * so a re-run never fails on `already_exists` (manual-run.yml).
 * Zero dependencies — the Playwright container has no `gh`.
 *
 *   GH_TOKEN=… node upload-release-asset.mjs <owner/repo> <tag> <file>
 *
 * The release is looked up by tag, never by name: the private repo prefixes
 * names with "❌ …" on failure.
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const [repo, tag, file] = process.argv.slice(2)
const token = process.env.GH_TOKEN
if (!repo || !tag || !file || !token) {
  console.error('usage: GH_TOKEN=… node upload-release-asset.mjs <owner/repo> <tag> <file>')
  process.exit(1)
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
}

async function api(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { ...headers, ...init.headers } })
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${url} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.status === 204 ? null : res.json()
}

const name = basename(file)
const release = await api(`https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`)
for (const asset of release.assets || []) {
  if (asset.name === name) {
    await api(`https://api.github.com/repos/${repo}/releases/assets/${asset.id}`, { method: 'DELETE' })
    console.log(`replaced existing ${name}`)
  }
}
const uploaded = await api(
  `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
  { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: readFileSync(file) },
)
console.log(`attached ${name} (${uploaded.size} bytes) to ${repo}@${tag}`)
