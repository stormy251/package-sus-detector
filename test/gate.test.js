import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGate, buildMarkdown, normalizeFailOn } from '../src/gate.js';
import { buildSummary } from '../src/summary.js';

const item = (name, verdict, riskScore, extra = {}) => ({ recordType: 'package', ecosystem: 'npm', name, resolvedVersion: '1.0.0', verdict, riskScore, summary: `${name} summary | with pipe`, reasons: [], charged: true, ...extra });
const items = [item('a', 'ok', 0), item('b', 'caution', 30), item('c', 'suspicious', 70), item('d', 'not_found', null), item('e', 'error', null, { charged: false })];

test('normalizeFailOn falls back to never', () => {
    assert.equal(normalizeFailOn('bogus'), 'never');
    assert.equal(normalizeFailOn(undefined), 'never');
    assert.equal(normalizeFailOn('caution'), 'caution');
});

test('gate: never reports only and always passes', () => {
    const g = evaluateGate(items, {});
    assert.equal(g.enabled, false);
    assert.equal(g.passed, true);
    assert.equal(g.exitCode, 0);
    assert.equal(g.incomplete, 1);
});

test('gate: caution fails on caution, suspicious and not_found but not on error or ok', () => {
    const g = evaluateGate(items, { failOn: 'caution' });
    assert.deepEqual(g.failing.map((f) => f.name), ['b', 'c', 'd']);
    assert.equal(g.exitCode, 1);
});

test('gate: suspicious fails on suspicious and not_found', () => {
    assert.deepEqual(evaluateGate(items, { failOn: 'suspicious' }).failing.map((f) => f.name), ['c', 'd']);
});

test('gate: not_found fails only on not_found', () => {
    assert.deepEqual(evaluateGate(items, { failOn: 'not_found' }).failing.map((f) => f.name), ['d']);
});

test('gate: risk score threshold works alone and with failOn', () => {
    assert.deepEqual(evaluateGate(items, { failOnRiskScore: 30 }).failing.map((f) => f.name), ['b', 'c']);
    const both = evaluateGate(items, { failOn: 'not_found', failOnRiskScore: 70 });
    assert.deepEqual(both.failing.map((f) => f.name), ['c', 'd']);
    assert.equal(evaluateGate(items, { failOnRiskScore: 'abc' }).enabled, false);
});

test('gate: passes when nothing crosses the threshold', () => {
    const g = evaluateGate([item('a', 'ok', 0), item('b', 'caution', 20)], { failOn: 'suspicious' });
    assert.equal(g.passed, true);
    assert.equal(g.exitCode, 0);
});

test('buildSummary carries gate and markdown; default fields unchanged', () => {
    const s = buildSummary(items, { failOn: 'suspicious' });
    assert.equal(s.gate.passed, false);
    assert.equal(s.gate.complete, true);
    assert.equal(s.totalChecked, 5);
    assert.equal(s.overall, 'suspicious');
    assert.match(s.markdown, /Package Sus Detector: FAILED/);
    assert.match(s.markdown, /\| `c@1.0.0` \(npm\) \| suspicious \| 70 \|/);
    assert.match(s.markdown, /c summary \\\| with pipe/); // pipes in text are escaped so table rows stay intact
    const plain = buildSummary(items, {});
    assert.match(plain.markdown, /report only/);
    assert.ok(plain.gate.passed);
});

test('markdown: empty summary and early stop warning', () => {
    const s = buildSummary([], {});
    assert.match(s.markdown, /0 package\(s\) checked/);
    const stopped = buildSummary(items, { failOn: 'caution', stoppedEarly: true });
    assert.equal(stopped.gate.complete, false);
    assert.match(stopped.markdown, /were not checked/);
    const capped = buildSummary(items, { failOn: 'caution', notChecked: 7 });
    assert.equal(capped.gate.complete, false);
    assert.equal(capped.gate.notChecked, 7);
    assert.match(capped.markdown, /7 package\(s\) were not checked/);
    assert.match(buildMarkdown(items, buildSummary(items, {}), { enabled: false, passed: true }), /report only/);
});
