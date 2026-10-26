import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPackage } from '../src/check.js';
import { evaluate, notFoundEvaluation } from '../src/scoring.js';
import { buildSummary } from '../src/summary.js';
import { classifyLicense, licenseNote } from '../src/license.js';
import { NOW, daysAgo, json, mockHttp, popular, npmLatest, ddPackage } from './helpers.js';

const osvEmpty = ['https://api.osv.dev/v1/query', { vulns: [] }];
const ctxFor = (routes, options = {}) => {
    const m = mockHttp(routes);
    return { ...m, ctx: { http: m.http, popular, options, now: NOW } };
};

test('npm: healthy established package -> ok', async () => {
    const { ctx } = ctxFor([
        ['https://registry.npmjs.org/react/latest', npmLatest({ name: 'react', version: '19.0.0' })],
        ['https://api.npmjs.org/downloads/point/last-week/react', { downloads: 120000000 }],
        ['https://api.deps.dev/v3/systems/npm/packages/react/versions/19.0.0', { licenses: ['MIT'], advisoryKeys: [] }],
        ['https://api.deps.dev/v3/systems/npm/packages/react', ddPackage([['0.1.0', daysAgo(5000)], ['19.0.0', daysAgo(30), true]])],
        osvEmpty,
    ]);
    const r = await checkPackage({ ecosystem: 'npm', name: 'react' }, ctx);
    assert.equal(r.verdict, 'ok');
    assert.equal(r.riskScore, 0);
    assert.equal(r.registry.ageDays, 5000);
    assert.equal(r.registry.daysSinceLastRelease, 30);
    assert.equal(r.registry.weeklyDownloads, 120000000);
    assert.equal(r.registry.maintainerCount, 2);
    assert.equal(r.typosquat.isPopular, true);
    assert.equal(r.charged, true);
    assert.equal(r.dataQuality, 'complete');
});

test('npm: not found -> not_found with plausible-hallucination signal and slopsquat', async () => {
    const { ctx } = ctxFor([osvEmpty]);
    const r = await checkPackage({ ecosystem: 'npm', name: 'react-super-auth-helper-pro' }, ctx);
    assert.equal(r.verdict, 'not_found');
    assert.ok(r.riskScore >= 60);
    assert.ok(r.reasons.some((x) => x.code === 'not_in_registry'));
    assert.ok(r.reasons.some((x) => x.code === 'plausible_hallucinated_name'));
    assert.equal(r.slopsquat.signal, 'medium');
    assert.equal(r.registry.exists, false);
});

test('npm: removed malicious name (registry 404, OSV MAL record) -> flagged', async () => {
    const { ctx } = ctxFor([['https://api.osv.dev/v1/query', { vulns: [{ id: 'MAL-2026-9', summary: 'Malicious code in x' }] }]]);
    const r = await checkPackage({ ecosystem: 'npm', name: 'some-removed-pkg' }, ctx);
    assert.equal(r.verdict, 'not_found');
    assert.equal(r.riskScore, 100);
    assert.equal(r.vulnerabilities.malicious.listed, true);
});

test('npm: brand-new typosquat-like package with install script -> suspicious', async () => {
    const { ctx } = ctxFor([
        ['https://registry.npmjs.org/reactt/latest', npmLatest({ name: 'reactt', version: '1.0.0', maintainers: [{ name: 'z' }], scripts: { postinstall: 'node x.js' } })],
        ['https://api.npmjs.org/downloads/point/last-week/reactt', { downloads: 12 }],
        ['https://api.deps.dev/v3/systems/npm/packages/reactt/versions/1.0.0', { licenses: ['MIT'], advisoryKeys: [] }],
        ['https://api.deps.dev/v3/systems/npm/packages/reactt', ddPackage([['1.0.0', daysAgo(3), true]])],
        osvEmpty,
    ]);
    const r = await checkPackage({ ecosystem: 'npm', name: 'reactt' }, ctx);
    assert.equal(r.verdict, 'suspicious');
    const codes = r.reasons.map((x) => x.code);
    for (const c of ['typosquat_similarity', 'very_new_package', 'very_low_usage', 'install_time_code']) assert.ok(codes.includes(c), c);
    assert.ok(r.riskScore >= 60);
    assert.ok(r.typosquat.matches[0].popular === 'react');
});

test('npm: deprecated + vulnerable pinned version -> caution with fixed versions', async () => {
    const vuln = { id: 'GHSA-aaaa', aliases: ['CVE-2020-1'], summary: 'Prototype pollution', database_specific: { severity: 'HIGH' }, affected: [{ package: { name: 'lodash', ecosystem: 'npm' }, ranges: [{ events: [{ introduced: '0' }, { fixed: '4.17.21' }] }] }] };
    const { ctx, log } = ctxFor([
        ['https://registry.npmjs.org/lodash/4.17.15', npmLatest({ name: 'lodash', version: '4.17.15', deprecated: 'use something else' })],
        ['https://registry.npmjs.org/lodash/latest', npmLatest({ name: 'lodash', version: '4.18.1' })],
        ['https://api.npmjs.org/downloads/point/last-week/lodash', { downloads: 90000000 }],
        ['https://api.deps.dev/v3/systems/npm/packages/lodash/versions/4.17.15', { licenses: ['MIT'], advisoryKeys: [{ id: 'x' }] }],
        ['https://api.deps.dev/v3/systems/npm/packages/lodash', ddPackage([['4.17.15', daysAgo(2400)], ['4.18.1', daysAgo(200), true]])],
        ['https://api.osv.dev/v1/query', (u, init) => { assert.equal(JSON.parse(init.body).version, '4.17.15'); return { vulns: [vuln] }; }],
    ]);
    const r = await checkPackage({ ecosystem: 'npm', name: 'lodash', version: '4.17.15' }, ctx);
    assert.equal(r.verdict, 'caution');
    assert.equal(r.resolvedVersion, '4.17.15');
    assert.equal(r.vulnerabilities.count, 1);
    assert.equal(r.vulnerabilities.maxSeverity, 'high');
    assert.equal(r.vulnerabilities.highestFixedVersion, '4.17.21');
    assert.equal(r.registry.deprecated, true);
    assert.ok(log.length > 0);
});

test('npm: pinned version that does not exist -> caution/version_not_found, no OSV call', async () => {
    const { ctx, log } = ctxFor([
        ['https://registry.npmjs.org/react/latest', npmLatest({ name: 'react', version: '19.0.0' })],
        ['https://api.npmjs.org/downloads/point/last-week/react', { downloads: 1e8 }],
        ['https://api.deps.dev/v3/systems/npm/packages/react', ddPackage([['19.0.0', daysAgo(30), true], ['0.1.0', daysAgo(4000)]])],
    ]);
    const r = await checkPackage({ ecosystem: 'npm', name: 'react', version: '99.9.9' }, ctx);
    assert.equal(r.verdict, 'caution');
    assert.ok(r.reasons.some((x) => x.code === 'version_not_found'));
    assert.equal(log.some((l) => l.url.includes('osv.dev')), false);
});

test('pypi: normalisation, equal-version matching, owner count, downloads', async () => {
    const pypiDoc = {
        info: { name: 'Django', version: '6.1.2', license_expression: 'BSD-3-Clause', classifiers: [], summary: 'web', project_urls: { Source: 'https://github.com/django/django' } },
        ownership: { organization: null, roles: [{ role: 'Owner', user: 'a' }, { role: 'Owner', user: 'b' }] },
        releases: { '2.2': [{ upload_time_iso_8601: daysAgo(2000), packagetype: 'bdist_wheel' }], '6.1.2': [{ upload_time_iso_8601: daysAgo(10), packagetype: 'bdist_wheel' }] },
        vulnerabilities: [],
    };
    const { ctx } = ctxFor([
        ['https://pypi.org/pypi/django/json', pypiDoc],
        ['https://pypistats.org/api/packages/django/recent', { data: { last_week: 5000000 } }],
        ['https://api.deps.dev/v3/systems/pypi/packages/django/versions/2.2', { licenses: ['BSD-3-Clause'], advisoryKeys: [] }],
        ['https://api.osv.dev/v1/query', (u, init) => { const b = JSON.parse(init.body); assert.equal(b.package.ecosystem, 'PyPI'); assert.equal(b.package.name, 'django'); return { vulns: [{ id: 'PYSEC-1', severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }] }] }; }],
    ]);
    const r = await checkPackage({ ecosystem: 'pypi', name: 'Django', version: '2.2.0' }, ctx);
    assert.equal(r.resolvedVersion, '2.2');
    assert.equal(r.registry.maintainerCount, 2);
    assert.equal(r.registry.weeklyDownloads, 5000000);
    assert.equal(r.vulnerabilities.maxSeverity, 'critical');
    assert.equal(r.vulnerabilities.maxCvss, 9.8);
    assert.equal(r.verdict, 'caution');
});

test('pypi: yanked release is flagged', async () => {
    const { ctx } = ctxFor([
        ['https://pypi.org/pypi/oldpkg/json', { info: { name: 'oldpkg', version: '1.0', license: 'MIT', classifiers: [] }, ownership: { roles: [] }, releases: { '1.0': [{ upload_time_iso_8601: daysAgo(900), yanked: true, yanked_reason: 'broken', packagetype: 'sdist' }] } }],
        ['https://pypistats.org/', { data: { last_week: 20000 } }],
        osvEmpty,
    ]);
    const r = await checkPackage({ ecosystem: 'pypi', name: 'oldpkg' }, ctx);
    assert.ok(r.reasons.some((x) => x.code === 'yanked'));
    assert.equal(r.registry.maintainerCount, null);
    assert.equal(r.verdict, 'caution');
});

test('known malicious listing forces suspicious', async () => {
    const { ctx } = ctxFor([
        ['https://registry.npmjs.org/evil-lib/latest', npmLatest({ name: 'evil-lib' })],
        ['https://api.npmjs.org/', { downloads: 5000000 }],
        ['https://api.deps.dev/v3/systems/npm/packages/evil-lib', ddPackage([['1.2.3', daysAgo(900), true]])],
        ['https://api.osv.dev/v1/query', { vulns: [{ id: 'MAL-2026-1', summary: 'Malicious code in evil-lib' }] }],
    ]);
    const r = await checkPackage({ ecosystem: 'npm', name: 'evil-lib' }, ctx);
    assert.equal(r.verdict, 'suspicious');
    assert.equal(r.vulnerabilities.knownMalicious, true);
});

test('upstream failure on one source yields partial data, run continues', async () => {
    const { ctx } = ctxFor([
        ['https://registry.npmjs.org/axios/latest', npmLatest({ name: 'axios', version: '1.0.0' })],
        ['https://api.npmjs.org/', { downloads: 5e7 }],
        ['https://api.deps.dev/v3/systems/npm/packages/axios', ddPackage([['1.0.0', daysAgo(900), true]])],
        ['https://api.osv.dev/', json(null, 500)],
    ]);
    const r = await checkPackage({ ecosystem: 'npm', name: 'axios' }, ctx);
    assert.equal(r.dataQuality, 'partial');
    assert.ok(r.errors.some((e) => e.startsWith('osv:')));
    assert.ok(['ok', 'caution'].includes(r.verdict));
});

test('registry outage -> verdict error, not charged, does not throw', async () => {
    const { ctx } = ctxFor([['https://registry.npmjs.org/', json(null, 503)]]);
    const r = await checkPackage({ ecosystem: 'npm', name: 'whatever' }, ctx);
    assert.equal(r.verdict, 'error');
    assert.equal(r.charged, false);
    assert.equal(r.riskScore, null);
});

test('invalid name -> not_found, not charged, no network', async () => {
    const { ctx, log } = ctxFor([]);
    const r = await checkPackage({ ecosystem: 'npm', name: 'Not Valid!!' }, ctx);
    assert.equal(r.verdict, 'not_found');
    assert.equal(r.charged, false);
    assert.equal(log.length, 0);
});

test('evaluate: score is capped at 100 and verdict thresholds hold', () => {
    const base = { ecosystem: 'npm', versionExists: true, firstPublishedAt: daysAgo(400), latestReleaseAt: daysAgo(30), weeklyDownloads: 1e6, maintainerCount: 3, deprecated: { flag: false }, repositoryUrl: 'x' };
    const clean = evaluate({ registry: base, vulns: null, typo: { suspected: false }, halluc: { plausible: false }, license: { category: 'permissive' }, now: NOW });
    assert.equal(clean.verdict, 'ok');
    const stale = evaluate({ registry: { ...base, latestReleaseAt: daysAgo(1600), weeklyDownloads: 100 }, vulns: null, typo: { suspected: false }, halluc: { plausible: false }, license: { category: 'permissive' }, now: NOW });
    assert.ok(stale.reasons.some((x) => x.code === 'abandoned'));
    const huge = evaluate({ registry: { ...base, firstPublishedAt: daysAgo(1), weeklyDownloads: 0, deprecated: { flag: true, message: 'd' }, maintainerCount: 0 }, vulns: { count: 3, maxSeverity: 'critical', malicious: { listed: true, ids: ['MAL-1'] } }, typo: { suspected: true, matches: [{ popular: 'react', rank: 1, type: 'edit_distance', distance: 1 }] }, halluc: { plausible: true, features: [] }, license: { category: 'unknown' }, now: NOW });
    assert.equal(huge.score, 100);
    assert.equal(huge.verdict, 'suspicious');
    assert.equal(notFoundEvaluation({ typo: { suspected: false }, halluc: { plausible: false }, vulns: null }).verdict, 'not_found');
});

test('established package close to a popular name gets reduced typosquat weight', () => {
    const reg = { ecosystem: 'npm', versionExists: true, firstPublishedAt: daysAgo(2000), latestReleaseAt: daysAgo(100), weeklyDownloads: 500000, maintainerCount: 2, deprecated: { flag: false }, repositoryUrl: 'x' };
    const ev = evaluate({ registry: reg, vulns: null, typo: { suspected: true, matches: [{ popular: 'react', rank: 1, type: 'edit_distance', distance: 1 }] }, halluc: { plausible: false }, license: { category: 'permissive' }, now: NOW });
    assert.equal(ev.verdict, 'ok');
    assert.ok(ev.score < 10);
});

test('license classification and compatibility note', () => {
    assert.equal(classifyLicense('MIT').category, 'permissive');
    assert.equal(classifyLicense('GPL-3.0-only').category, 'strong-copyleft');
    assert.equal(classifyLicense('AGPL-3.0').category, 'network-copyleft');
    assert.equal(classifyLicense('LGPL-2.1').category, 'weak-copyleft');
    assert.equal(classifyLicense('MIT OR GPL-2.0').category, 'permissive');
    assert.equal(classifyLicense('UNLICENSED').category, 'proprietary');
    assert.equal(classifyLicense(null).category, 'unknown');
    assert.equal(licenseNote('strong-copyleft', 'proprietary').compatibility, 'review_needed');
    assert.equal(licenseNote('permissive', 'proprietary').compatibility, 'likely_compatible');
    assert.equal(licenseNote('permissive', 'unspecified').compatibility, null);
});

test('summary: counts, worst offenders, overall', () => {
    const items = [
        { ecosystem: 'npm', name: 'a', verdict: 'ok', riskScore: 0, reasons: [], charged: true },
        { ecosystem: 'npm', name: 'b', verdict: 'suspicious', riskScore: 80, reasons: [{ code: 'x', points: 80 }], charged: true, vulnerabilities: { count: 2, knownMalicious: true } },
        { ecosystem: 'pypi', name: 'c', verdict: 'error', riskScore: null, reasons: [], charged: false },
    ];
    const s = buildSummary(items, { startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:10Z' });
    assert.equal(s.totalChecked, 3);
    assert.equal(s.verdictCounts.suspicious, 1);
    assert.equal(s.overall, 'suspicious');
    assert.equal(s.worstOffenders[0].name, 'b');
    assert.equal(s.chargedPackages, 2);
    assert.deepEqual(s.knownMaliciousListed, ['npm:b']);
    assert.equal(s.durationSeconds, 10);
});
