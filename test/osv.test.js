import test from 'node:test';
import assert from 'node:assert/strict';
import { cvss3Score } from '../src/cvss.js';
import { summariseVulns, vulnSeverity, queryOsv } from '../src/sources/osv.js';
import { mockHttp } from './helpers.js';

test('cvss3Score matches reference values', () => {
    assert.equal(cvss3Score('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'), 9.8);
    assert.equal(cvss3Score('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H'), 10);
    assert.equal(cvss3Score('CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:N'), 7.4);
    assert.equal(cvss3Score('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N'), 0);
    assert.equal(cvss3Score('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N'), null);
});

test('vulnSeverity uses cvss vector and database_specific', () => {
    assert.equal(vulnSeverity({ severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }] }).level, 'critical');
    assert.equal(vulnSeverity({ database_specific: { severity: 'MODERATE' } }).level, 'medium');
    assert.equal(vulnSeverity({}).level, 'none');
});

test('summariseVulns: dedupes aliases, collects fixes, separates malware', () => {
    const vulns = [
        { id: 'GHSA-1', aliases: ['CVE-1'], database_specific: { severity: 'HIGH' }, affected: [{ package: { name: 'lodash', ecosystem: 'npm' }, ranges: [{ events: [{ introduced: '0' }, { fixed: '4.17.21' }] }] }] },
        { id: 'CVE-1', aliases: ['GHSA-1'], database_specific: { severity: 'HIGH' } },
        { id: 'GHSA-2', database_specific: { severity: 'LOW' }, affected: [{ package: { name: 'lodash', ecosystem: 'npm' }, ranges: [{ events: [{ fixed: '4.17.9' }] }] }] },
        { id: 'MAL-2025-1', summary: 'Malicious code in lodash-x' },
    ];
    const s = summariseVulns(vulns, 'npm', 'lodash');
    assert.equal(s.count, 2);
    assert.equal(s.maxSeverity, 'high');
    assert.deepEqual(s.fixedVersions, ['4.17.9', '4.17.21']);
    assert.equal(s.highestFixedVersion, '4.17.21');
    assert.equal(s.malicious.listed, true);
    assert.deepEqual(s.malicious.ids, ['MAL-2025-1']);
});

test('queryOsv follows pagination', async () => {
    let calls = 0;
    const { http } = mockHttp([['https://api.osv.dev/v1/query', (u, init) => {
        calls++;
        const b = JSON.parse(init.body);
        return b.page_token ? { vulns: [{ id: 'B' }] } : { vulns: [{ id: 'A' }], next_page_token: 'p2' };
    }]]);
    const r = await queryOsv(http, { ecosystem: 'npm', name: 'x', version: '1.0.0' });
    assert.equal(calls, 2);
    assert.equal(r.count, 2);
    assert.equal(r.maxSeverity, 'unknown');
});
