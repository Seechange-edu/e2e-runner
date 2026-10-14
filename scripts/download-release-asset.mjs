#!/usr/bin/env node
/**
 * Fetch the manual pack of the release BEFORE a tag, so the manual only
 * regenerates what changed (manual-run.yml). Zero dependencies.
 *
 *   GH_TOKEN=… node download-release-asset.mjs <owner/repo> <tag> <out.tar.gz>
 *
 * Prints {"tag": "<previous tag>", "name": "<asset>"} and writes the archive;
 * prints nothing and exits 0 when there is no previous pack (the run is then a
 * full one). The release is found in the list, never by name: the private repo
 * prefixes names with "❌ …" on failure.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

// ponytail: the ThinkAndSpeak- prefix only covers packs built before the rename
// (up to v3.14.1); once no release in the list carries one, drop it.
export const PACK =
  /^(?:AI-English-GYM|ThinkAndSpeak)-Manual-Modules-.+\.tar\.gz$/

/**
 * `releases` newest first, as the API lists them. The previous pack is the
 * newest one of the releases OLDER than `tag` (all of them when `tag` has no
 * release yet); a draft is not a release anyone built on.
 */
export function pickPrevious(releases, tag, pattern = PACK) {
  const published = releases.filter((r) => !r.draft)
  const at = published.findIndex((r) => r.tag_name === tag)
  const older = at === -1 ? published : published.slice(at + 1)
  for (const release of older) {
    const asset = (release.assets ?? []).find((a) => pattern.test(a.name))
    if (asset) return { release, asset }
  }
  return null
}

async function main() {
  const [repo, tag, out] = process.argv.slice(2)
  const token = process.env.GH_TOKEN
  if (!repo || !tag || !out || !token) {
    console.error('usage: GH_TOKEN=… node download-release-asset.mjs <owner/repo> <tag> <out.tar.gz>')
    process.exit(1)
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }

  const list = await fetch(
    `https://api.github.com/repos/${repo}/releases?per_page=100`,
    { headers: { ...headers, Accept: 'application/vnd.github+json' } },
  )
  if (!list.ok) {
    throw new Error(`GET releases → HTTP ${list.status}: ${(await list.text()).slice(0, 200)}`)
  }
  const found = pickPrevious(await list.json(), tag)
  if (!found) return

  // The asset endpoint redirects to storage; fetch drops Authorization on the
  // cross-origin hop, which is what we want.
  const file = await fetch(
    `https://api.github.com/repos/${repo}/releases/assets/${found.asset.id}`,
    { headers: { ...headers, Accept: 'application/octet-stream' } },
  )
  if (!file.ok) {
    throw new Error(`GET asset ${found.asset.name} → HTTP ${file.status}`)
  }
  writeFileSync(out, Buffer.from(await file.arrayBuffer()))
  console.log(JSON.stringify({ tag: found.release.tag_name, name: found.asset.name }))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`::error::${err.message}`)
    process.exit(1)
  })
}
