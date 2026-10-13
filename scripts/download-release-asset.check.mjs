// Self-check for picking the previous manual pack.
//   node scripts/download-release-asset.check.mjs
import assert from 'node:assert/strict'

import { pickPrevious } from './download-release-asset.mjs'

const PACK = /^ThinkAndSpeak-Manual-Modules-.+\.tar\.gz$/
const rel = (tag, assets = [], draft = false) => ({
  tag_name: tag,
  draft,
  assets: assets.map((name) => ({ id: tag.length, name })),
})
const pack = (tag) => `ThinkAndSpeak-Manual-Modules-${tag}.tar.gz`

// Newest first, as the releases API lists them.
const releases = [
  rel('v3.13.19', [pack('v3.13.19')]),
  rel('v3.13.18'), // released, its manual not generated
  rel('v3.13.17', [pack('v3.13.17'), 'ThinkAndSpeak-User-Manual-v3.13.17.pdf']),
  rel('v3.13.16', [pack('v3.13.16')]),
]

// The release before the tag that has a pack: not the tag itself, not one
// without a pack.
assert.equal(pickPrevious(releases, 'v3.13.19', PACK).release.tag_name, 'v3.13.17')
assert.equal(pickPrevious(releases, 'v3.13.18', PACK).release.tag_name, 'v3.13.17')
// A tag older than the newest release (a manual re-run): still the one before.
assert.equal(pickPrevious(releases, 'v3.13.17', PACK).release.tag_name, 'v3.13.16')
// A tag no release carries yet: the newest with a pack.
assert.equal(pickPrevious(releases, 'v3.13.20', PACK).release.tag_name, 'v3.13.19')
// Nothing before it: no previous, the run is a full one.
assert.equal(pickPrevious(releases, 'v3.13.16', PACK), null)
assert.equal(pickPrevious([], 'v3.13.1', PACK), null)
// A draft is not a release anyone built on.
assert.equal(
  pickPrevious([rel('v2', [pack('v2')], true), rel('v1', [pack('v1')])], 'v3', PACK).release.tag_name,
  'v1',
)

console.log('download-release-asset.check: ok')
