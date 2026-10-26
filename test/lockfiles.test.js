import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLockfileType, parseLockfile, parsePackageLock, parseYarnLock, parsePnpmLock, parseTomlPackageLock, parsePipfileLock } from '../src/lockfiles.js';
import { buildSpecs } from '../src/input.js';

const pkgLockV3 = JSON.stringify({
    name: 'app', lockfileVersion: 3, requires: true,
    packages: {
        '': { name: 'app', dependencies: { lodash: '4.17.15' } },
        'node_modules/lodash': { version: '4.17.15', resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.15.tgz' },
        'node_modules/@types/node': { version: '20.1.0', dev: true, resolved: 'https://registry.npmjs.org/@types/node/-/node-20.1.0.tgz' },
        'node_modules/a/node_modules/lodash': { version: '3.10.1' },
        'node_modules/mine': { resolved: 'packages/mine', link: true },
        'node_modules/gitdep': { version: '1.0.0', resolved: 'git+ssh://git@github.com/x/y.git#abc' },
        'node_modules/alias': { name: 'left-pad', version: '1.3.0' },
        'packages/mine': { name: 'mine', version: '1.0.0' },
    },
});

test('detectLockfileType recognises each format', () => {
    assert.equal(detectLockfileType(pkgLockV3), 'package-lock');
    assert.equal(detectLockfileType('# yarn lockfile v1\n\nlodash@^4.17.0:\n  version "4.17.21"\n'), 'yarn-lock');
    assert.equal(detectLockfileType('__metadata:\n  version: 8\n\n"lodash@npm:^4.17.0":\n  version: 4.17.21\n'), 'yarn-lock');
    assert.equal(detectLockfileType("lockfileVersion: '9.0'\n\npackages:\n  lodash@4.17.21:\n    resolution: {integrity: x}\n"), 'pnpm-lock');
    assert.equal(detectLockfileType('[[package]]\nname = "requests"\nversion = "2.31.0"\n\n[metadata]\nlock-version = "2.0"\ncontent-hash = "abc"\n'), 'poetry-lock');
    assert.equal(detectLockfileType('version = 1\nrequires-python = ">=3.11"\n\n[[package]]\nname = "requests"\nversion = "2.31.0"\nsource = { registry = "https://pypi.org/simple" }\n'), 'uv-lock');
    assert.equal(detectLockfileType(JSON.stringify({ _meta: { pipfile: {} }, default: {}, develop: {} })), 'pipfile-lock');
    assert.equal(detectLockfileType('hello'), null);
});

test('package-lock v3: nested names, dev filter, links, git, alias name', () => {
    const r = parsePackageLock(pkgLockV3);
    const k = r.specs.map((s) => `${s.name}@${s.version}`).sort();
    assert.deepEqual(k, ['@types/node@20.1.0', 'left-pad@1.3.0', 'lodash@3.10.1', 'lodash@4.17.15']);
    assert.ok(r.skipped.some((s) => s.name === 'mine'));
    assert.ok(r.skipped.some((s) => s.name === 'gitdep'));
    const noDev = parsePackageLock(pkgLockV3, { includeDev: false });
    assert.ok(!noDev.specs.some((s) => s.name === '@types/node'));
});

test('package-lock v1: nested dependencies', () => {
    const v1 = JSON.stringify({ lockfileVersion: 1, dependencies: { a: { version: '1.0.0', dependencies: { b: { version: '2.0.0' } } }, c: { version: 'npm:left-pad@1.3.0' } } });
    const r = parsePackageLock(v1);
    assert.deepEqual(r.specs.map((s) => `${s.name}@${s.version}`).sort(), ['a@1.0.0', 'b@2.0.0', 'left-pad@1.3.0']);
});

test('package-lock: invalid JSON reports an error', () => {
    assert.match(parsePackageLock('{nope').error, /not valid JSON/);
});

test('yarn.lock v1 and berry', () => {
    const v1 = `# yarn lockfile v1\n\n\n"@types/node@^20.0.0", "@types/node@^20.1.0":\n  version "20.1.0"\n  resolved "https://registry.yarnpkg.com/@types/node/-/node-20.1.0.tgz#abc"\n\nlodash@^4.17.0:\n  version "4.17.21"\n  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz#x"\n  dependencies:\n    foo "^1"\n\ngitdep@github:x/y:\n  version "1.0.0"\n  resolved "https://codeload.github.com/x/y/tar.gz/abc"\n`;
    const r = parseYarnLock(v1);
    assert.deepEqual(r.specs.map((s) => `${s.name}@${s.version}`).sort(), ['@types/node@20.1.0', 'lodash@4.17.21']);
    assert.equal(r.skipped.length, 1);
    const berry = `__metadata:\n  version: 8\n  cacheKey: 10\n\n"lodash@npm:^4.17.0":\n  version: 4.17.21\n  resolution: "lodash@npm:4.17.21"\n  checksum: abc\n\n"app@workspace:.":\n  version: 0.0.0-use.local\n  resolution: "app@workspace:."\n\n"alias@npm:left-pad@^1.0.0":\n  version: 1.3.0\n  resolution: "left-pad@npm:1.3.0"\n`;
    const b = parseYarnLock(berry);
    assert.deepEqual(b.specs.map((s) => `${s.name}@${s.version}`).sort(), ['left-pad@1.3.0', 'lodash@4.17.21']);
    assert.ok(b.skipped.some((s) => s.name === 'app'));
});

test('pnpm-lock v9, v6 and v5 keys', () => {
    const v9 = `lockfileVersion: '9.0'\n\nimporters:\n  .:\n    dependencies:\n      lodash:\n        specifier: ^4.17.0\n        version: 4.17.21\n\npackages:\n  lodash@4.17.21:\n    resolution: {integrity: sha512-x}\n  '@types/node@20.1.0':\n    resolution: {integrity: sha512-y}\n  react-dom@18.2.0:\n    resolution: {integrity: sha512-z}\n\nsnapshots:\n  lodash@4.17.21: {}\n  react-dom@18.2.0(react@18.2.0):\n    dependencies:\n      react: 18.2.0\n`;
    assert.deepEqual(parsePnpmLock(v9).specs.map((s) => `${s.name}@${s.version}`).sort(), ['@types/node@20.1.0', 'lodash@4.17.21', 'react-dom@18.2.0']);
    const v6 = `lockfileVersion: '6.0'\n\npackages:\n\n  /lodash@4.17.21:\n    resolution: {integrity: x}\n  /@types/node@20.1.0:\n    resolution: {integrity: y}\n  github.com/x/y/abc:\n    resolution: {tarball: https://codeload.github.com/x/y/tar.gz/abc}\n`;
    assert.deepEqual(parsePnpmLock(v6).specs.map((s) => `${s.name}@${s.version}`).sort(), ['@types/node@20.1.0', 'lodash@4.17.21']);
    const v5 = `lockfileVersion: 5.4\n\npackages:\n\n  /lodash/4.17.21:\n    resolution: {integrity: x}\n  /@types/node/20.1.0:\n    resolution: {integrity: y}\n  /react-dom/18.2.0_react@18.2.0:\n    resolution: {integrity: z}\n`;
    assert.deepEqual(parsePnpmLock(v5).specs.map((s) => `${s.name}@${s.version}`).sort(), ['@types/node@20.1.0', 'lodash@4.17.21', 'react-dom@18.2.0']);
});

test('poetry.lock and uv.lock', () => {
    const poetry = `[[package]]\nname = "Requests"\nversion = "2.31.0"\ndescription = "x"\n\n[package.dependencies]\nurllib3 = ">=1.21"\n\n[[package]]\nname = "my-git-dep"\nversion = "0.1.0"\n\n[package.source]\ntype = "git"\nurl = "https://github.com/x/y"\n\n[[package]]\nname = "legacy-ok"\nversion = "1.0.0"\n\n[package.source]\ntype = "legacy"\nurl = "https://example.org/simple"\n\n[metadata]\nlock-version = "2.0"\ncontent-hash = "abc"\n`;
    const p = parseTomlPackageLock(poetry);
    assert.deepEqual(p.specs.map((s) => `${s.name}@${s.version}`).sort(), ['legacy-ok@1.0.0', 'requests@2.31.0']);
    assert.equal(p.skipped.length, 1);
    const uv = `version = 1\nrequires-python = ">=3.11"\n\n[[package]]\nname = "requests"\nversion = "2.31.0"\nsource = { registry = "https://pypi.org/simple" }\n\n[[package]]\nname = "myproj"\nversion = "0.1.0"\nsource = { editable = "." }\n`;
    const u = parseTomlPackageLock(uv, 'uv-lock');
    assert.deepEqual(u.specs.map((s) => `${s.name}@${s.version}`), ['requests@2.31.0']);
    assert.equal(u.skipped.length, 1);
});

test('Pipfile.lock', () => {
    const j = JSON.stringify({ _meta: { pipfile: {} }, default: { Requests: { version: '==2.31.0' }, loose: { version: '*' } }, develop: { pytest: { version: '==8.0.0' }, gitdep: { git: 'https://x', ref: 'a' } } });
    assert.deepEqual(parsePipfileLock(j).specs.map((s) => `${s.name}@${s.version}`).sort(), ['pytest@8.0.0', 'requests@2.31.0']);
    assert.deepEqual(parsePipfileLock(j, { includeDev: false }).specs.map((s) => s.name), ['requests']);
});

test('parseLockfile: unknown format reports an error', () => {
    assert.match(parseLockfile('what is this').error, /not recognised/);
});

test('buildSpecs: lockfile only, and lockfile diff against a base', () => {
    const base = JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/lodash': { version: '4.17.15' }, 'node_modules/react': { version: '18.2.0' } } });
    const head = JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/lodash': { version: '4.17.21' }, 'node_modules/react': { version: '18.2.0' }, 'node_modules/new-pkg': { version: '0.0.1' } } });
    const all = buildSpecs({ lockfile: head });
    assert.equal(all.specs.length, 3);
    const diff = buildSpecs({ lockfile: head, baseLockfile: base });
    assert.deepEqual(diff.specs.map((s) => `${s.name}@${s.version}`).sort(), ['lodash@4.17.21', 'new-pkg@0.0.1']);
    assert.equal(diff.unchanged, 1);
    assert.ok(diff.notes.some((n) => /Lockfile diff: 2 added or changed/.test(n)));
    const same = buildSpecs({ lockfile: head, baseLockfile: head });
    assert.equal(same.specs.length, 0);
    assert.equal(same.unchanged, 3);
    const mismatch = buildSpecs({ lockfile: head, baseLockfile: '[[package]]\nname = "x"\nversion = "1"\n' });
    assert.equal(mismatch.specs.length, 3);
    assert.ok(mismatch.notes.some((n) => /baseLockfile ignored/.test(n)));
    const bad = buildSpecs({ lockfile: 'garbage' });
    assert.equal(bad.specs.length, 0);
    assert.ok(bad.notes.some((n) => /not recognised/.test(n)));
});
