/** CI gate: turns per-package verdicts into a pass/fail decision plus a PR-comment-ready markdown report. The Actor run itself always succeeds. */

export const FAIL_ON_LEVELS = ['never', 'caution', 'suspicious', 'not_found'];

// not_found and suspicious are both "do not install without a human look", so they share a level.
const LEVEL = { ok: 0, caution: 1, suspicious: 2, not_found: 2, error: 0 };
const MIN_LEVEL = { never: Infinity, caution: 1, suspicious: 2, not_found: 2 };

export function normalizeFailOn(v) {
    return FAIL_ON_LEVELS.includes(v) ? v : 'never';
}

export function evaluateGate(items, { failOn = 'never', failOnRiskScore = null } = {}) {
    const mode = normalizeFailOn(failOn);
    const scoreLimit = Number.isFinite(Number(failOnRiskScore)) && Number(failOnRiskScore) > 0 ? Number(failOnRiskScore) : null;
    const failing = [];
    for (const it of items) {
        if (it.verdict === 'error') continue;
        let reason = null;
        if (mode === 'not_found' ? it.verdict === 'not_found' : (LEVEL[it.verdict] ?? 0) >= MIN_LEVEL[mode]) reason = `verdict ${it.verdict}`;
        else if (scoreLimit !== null && typeof it.riskScore === 'number' && it.riskScore >= scoreLimit) reason = `risk score ${it.riskScore} >= ${scoreLimit}`;
        if (reason) failing.push({ ecosystem: it.ecosystem, name: it.name, version: it.resolvedVersion || it.requestedVersion || null, verdict: it.verdict, riskScore: it.riskScore, reason, summary: it.summary || null });
    }
    const configured = mode !== 'never' || scoreLimit !== null;
    return {
        failOn: mode,
        failOnRiskScore: scoreLimit,
        enabled: configured,
        passed: failing.length === 0,
        exitCode: failing.length === 0 ? 0 : 1,
        failingCount: failing.length,
        failing: failing.slice(0, 50),
        incomplete: items.filter((i) => i.verdict === 'error').length,
    };
}

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** Markdown report for a PR comment / GitHub step summary. Lists non-ok packages worst first (max 25). */
export function buildMarkdown(items, summary, gate) {
    const lines = [];
    const status = !gate.enabled ? 'report only' : gate.passed ? 'PASSED' : 'FAILED';
    lines.push(`### Package Sus Detector: ${status}`);
    const c = summary.verdictCounts;
    lines.push(`${summary.totalChecked} package(s) checked: ${c.ok} ok, ${c.caution} caution, ${c.suspicious} suspicious, ${c.not_found} not found${c.error ? `, ${c.error} lookup error(s)` : ''}.`);
    if (gate.enabled) lines.push(`Gate: fail on ${[gate.failOn !== 'never' ? `verdict ${gate.failOn}${gate.failOn === 'caution' ? ' or worse' : gate.failOn === 'suspicious' ? ' or not_found' : ''}` : null, gate.failOnRiskScore ? `risk score >= ${gate.failOnRiskScore}` : null].filter(Boolean).join(' or ')}.`);
    const rank = (i) => (i.riskScore ?? -1) + (i.verdict === 'not_found' ? 1000 : 0);
    const flagged = items.filter((i) => i.verdict !== 'ok' && i.verdict !== 'error').sort((a, b) => rank(b) - rank(a));
    if (flagged.length) {
        lines.push('', '| Package | Verdict | Score | Why |', '| --- | --- | --- | --- |');
        for (const i of flagged.slice(0, 25)) {
            lines.push(`| \`${esc(i.name)}${i.resolvedVersion ? `@${esc(i.resolvedVersion)}` : ''}\` (${i.ecosystem}) | ${i.verdict} | ${i.riskScore ?? '-'} | ${esc(i.summary).slice(0, 160)} |`);
        }
        if (flagged.length > 25) lines.push('', `…and ${flagged.length - 25} more. See the run's dataset for the full list.`);
    }
    if (gate.complete === false) lines.push('', `**Warning:** ${gate.notChecked || 'some'} package(s) were not checked (maxPackages cap, spending limit or abort), so a pass here does not cover them.`);
    if (summary.knownMaliciousListed?.length) lines.push('', `Listed in OSV malicious-packages feed: ${summary.knownMaliciousListed.map((x) => `\`${x}\``).join(', ')}`);
    if (summary.notes?.length) lines.push('', ...summary.notes.map((n) => `- ${esc(n)}`));
    lines.push('', '_Risk signals from public registry and advisory data, not accusations or a guarantee of safety._');
    return lines.join('\n');
}
