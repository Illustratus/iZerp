// Guard against version drift between package.json and the VERSION constant
// baked into izerp-lib.js (which is what gets exported into .izerp files and
// shown in the UI).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

const pkg = JSON.parse(read('../../package.json'));
const lib = read('../../izerp-lib.js');
const m = lib.match(/const\s+VERSION\s*=\s*'([^']+)'/);

test('izerp-lib.js declares a VERSION', () => {
  assert.ok(m, 'VERSION constant found in izerp-lib.js');
});

test('package.json major.minor matches the library VERSION', () => {
  const libVer = m[1];                          // e.g. "1.3"
  const pkgMajorMinor = pkg.version.split('.').slice(0, 2).join('.'); // "1.3.0" -> "1.3"
  assert.equal(pkgMajorMinor, libVer,
    `package.json (${pkg.version}) and izerp-lib.js VERSION (${libVer}) disagree`);
});
