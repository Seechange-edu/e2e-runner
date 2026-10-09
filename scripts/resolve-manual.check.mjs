// Self-check for the manual-run payload resolver.
//   node scripts/resolve-manual.check.mjs
import assert from 'node:assert/strict'

import { resolveManual } from './resolve-manual.mjs'

const profiles = [
  {
    id: 'tns-frontend',
    owner: 'Seechange-edu',
    repo: 'think-and-speak-frontend',
    container: 'img:v1',
    install: 'yarn install',
    yarnCache: 'yarn.lock',
    manual: { statusContext: 'manual/user-manual', timeoutMinutes: 60 },
  },
  { id: 'no-manual', owner: 'Seechange-edu', repo: 'other' },
]
const sha = 'a'.repeat(40)
const ok = {
  owner: 'Seechange-edu',
  repo: 'think-and-speak-frontend',
  sha,
  tag: 'v3.13.15',
  email: 'm@x.com',
  password: 'secret',
}

const r = resolveManual(ok, profiles)
assert.equal(r.tag, 'v3.13.15')
assert.equal(r.profile_id, 'tns-frontend')
assert.equal(r.status_context, 'manual/user-manual')
// Letter-suffixed releases (v3.12.2-a) ship to PROD too.
assert.equal(resolveManual({ ...ok, tag: 'v3.12.2-a' }, profiles).tag, 'v3.12.2-a')
// The password is never an output: outputs land in public logs.
assert.ok(!JSON.stringify(r).includes('secret'))

const rejects = (payload, re) =>
  assert.throws(() => resolveManual({ ...ok, ...payload }, profiles), re)
rejects({ repo: 'unknown' }, /not registered/)
rejects({ repo: 'other' }, /no manual/)
rejects({ sha: 'nope' }, /sha/)
rejects({ tag: 'v1.2.3; rm -rf /' }, /tag/)
rejects({ tag: 'for-other-v1.2.3' }, /tag/)
rejects({ email: '' }, /email/)
rejects({ password: '' }, /password/)

console.log('resolve-manual.check: ok')
