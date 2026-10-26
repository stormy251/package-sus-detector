import { evaluateGate, buildMarkdown } from './gate.js';

const VERDICTS = ['ok', 'caution', 'suspicious', 'not_found', 'error'];

export function buildSummary(items, { startedAt, finishedAt, notes = [], httpStats = {}, stoppedEarly = false, popularMeta = {}, failOn = 'never', failOnRiskScore = null, notChecked = 0 } = {}) {
    const counts = Object.fromEntries(VERDICTS.map((v) => [v, 0]));
    for (const it of items) counts[it.verdict] = (counts[it.verdict] || 0) + 1;
    const scored = items.filter((i) => typeof i.riskScore === 'number');
    const worst = [...scored].sort((a, b) => b.riskScore - a.riskScore).slice(0, 5).map((i) => ({ ecosystem: i.ecosystem, name: i.name, version: i.resolvedVersion || i.requestedVersion || null, verdict: i.verdict, riskScore: i.riskScore, topReasons: (i.reasons || []).filter((r) => r.points > 0).slice(0, 3).map((r) => r.code) }));
    const vulnerable = items.filter((i) => i.vulnerabilities?.count > 0);
    const worstVerdict = counts.suspicious ? 'suspicious' : counts.not_found ? 'not_found' : counts.caution ? 'caution' : counts.error ? 'incomplete' : 'ok';
    const out = {
        recordType: 'summary',
        totalChecked: items.length,
        verdictCounts: counts,
        overall: worstVerdict,
        averageRiskScore: scored.length ? Math.round(scored.reduce((s, i) => s + i.riskScore, 0) / scored.length) : null,
        packagesWithKnownVulnerabilities: vulnerable.length,
        totalKnownVulnerabilities: vulnerable.reduce((s, i) => s + i.vulnerabilities.count, 0),
        knownMaliciousListed: items.filter((i) => i.vulnerabilities?.knownMalicious).map((i) => `${i.ecosystem}:${i.name}`),
        worstOffenders: worst,
        chargedPackages: items.filter((i) => i.charged).length,
        notes,
        stoppedEarly,
        startedAt,
        finishedAt,
        durationSeconds: startedAt && finishedAt ? Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 100) / 10 : null,
        httpRequests: httpStats.requests ?? null,
        popularListsGeneratedAt: popularMeta,
        disclaimer: 'Risk signals only, derived from public registry metadata and advisory databases. A signal is not proof of wrongdoing; verify before acting.',
    };
    out.gate = { ...evaluateGate(items, { failOn, failOnRiskScore }), complete: !stoppedEarly && !notChecked, notChecked };
    out.markdown = buildMarkdown(items, out, out.gate);
    return out;
}
