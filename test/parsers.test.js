import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePackageSpec, parsePackageJson, parseRequirements } from '../src/parsers.js';
import { buildSpecs } from '../src/input.js';

test('parsePackageSpec: npm forms', () => {
    assert.deepEqual(parsePackageSpec('react'), { ecosystem: 'npm', name: 'react', version: null, requestedRange: null });
    assert.equal(parsePackageSpec('lodash@4.17.15').version, '4.17.15');
    const scoped = parsePackageSpec('@types/node@20.1.0');
    assert.equal(scoped.name, '@types/node');
    assert.equal(scoped.version, '20.1.0');
    assert.equal(parsePackageSpec('@types/node').name, '@types/node');
    const r = parsePackageSpec('npm:express@^4.18.0');
    assert.equal(r.version, null);
    assert.equal(r.requestedRange, '^4.18.0');
});

test('parsePackageSpec: pypi forms', () => {
    assert.deepEqual(parsePackageSpec('pypi:Requests==2.31.0'), { ecosystem: 'pypi', name: 'requests', version: '2.31.0', requestedRange: null });
    const g = parsePackageSpec('pypi:django>=3.2');
    assert.equal(g.version, null);
    assert.equal(g.requestedRange, '>=3.2');
    assert.equal(parsePackageSpec('flask', 'pypi').name, 'flask');
    assert.equal(parsePackageSpec('Pillow[extra]==10.0.0', 'pypi').name, 'pillow');
    assert.equal(parsePackageSpec('  ', 'npm'), null);
});

test('parsePackageJson: sections, ranges, skips', () => {
    const text = JSON.stringify({
        dependencies: { react: '^18.2.0', lodash: '4.17.15', local: 'file:../local', gh: 'github:user/repo', alias: 'npm:left-pad@1.3.0' },
        devDependencies: { jest: '~29.0.0' },
    });
    const r = parsePackageJson(text);
    const by = Object.fromEntries(r.specs.map((s) => [s.name, s]));
    assert.equal(by.lodash.version, '4.17.15');
    assert.equal(by.react.version, null);
    assert.equal(by.react.requestedRange, '^18.2.0');
    assert.equal(by['left-pad'].version, '1.3.0');
    assert.ok(by.jest);
    assert.equal(r.skipped.length, 2);
    assert.equal(parsePackageJson(text, { includeDev: false }).specs.some((s) => s.name === 'jest'), false);
    assert.match(parsePackageJson('{oops').error, /not valid JSON/);
});

test('parseRequirements: pins, ranges, comments, options', () => {
    const txt = `# comment
requests==2.31.0  # inline
Django>=3.2,<4
numpy
-r other.txt
git+https://github.com/x/y.git#egg=y
flask[async]==2.0.1 ; python_version >= "3.8"
`;
    const r = parseRequirements(txt);
    const by = Object.fromEntries(r.specs.map((s) => [s.name, s]));
    assert.equal(by.requests.version, '2.31.0');
    assert.equal(by.django.version, null);
    assert.equal(by.django.requestedRange, '>=3.2');
    assert.equal(by.numpy.version, null);
    assert.equal(by.flask.version, '2.0.1');
    assert.equal(r.specs.length, 4);
    assert.equal(r.skipped.length, 2);
});

test('buildSpecs: combines sources, dedupes, caps', () => {
    const r = buildSpecs({ packages: ['react', 'react', 'pypi:requests'], requirementsTxt: 'requests\nflask', packageJson: '{"dependencies":{"axios":"1.0.0"}}', maxPackages: 3 });
    assert.equal(r.duplicates, 2);
    assert.equal(r.specs.length, 3);
    assert.equal(r.truncated, 1);
    assert.ok(r.notes.some((n) => /maxPackages/.test(n)));
});
