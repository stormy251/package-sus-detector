import { cvss3Score } from '../cvss.js';
import { cmpVersions } from '../util.js';

const RANK = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
const LABEL = ['none', 'low', 'medium', 'high', 'critical'];
const fromScore = (s) => (s >= 9 ? 'critical' : s >= 7 ? 'high' : s >= 4 ? 'medium' : s > 0 ? 'low' : 'none');
const fromWord = (w) => ({ CRITICAL: 'critical', HIGH: 'high', MODERATE: 'medium', MEDIUM: 'medium', LOW: 'low' })[String(w).toUpperCase()] || null;

export function vulnSeverity(v) {
    let level = 'none';
    let cvss = null;
    for (const s of v.severity || []) {
        const score = cvss3Score(s.score);
        if (score !== null) {
            cvss = Math.max(cvss ?? 0, score);
            if (RANK[fromScore(score)] > RANK[level]) level = fromScore(score);
        }
    }
    const w = fromWord(v.database_specific?.severity);
    if (w && RANK[w] > RANK[level]) level = w;
    // affected[].ecosystem_specific.severity is used by some feeds (e.g. Go/RustSec)
    for (const a of v.affected || []) {
        const e = fromWord(a.ecosystem_specific?.severity);
        if (e && RANK[e] > RANK[level]) level = e;
    }
    return { level, cvss };
}

function fixedVersionsOf(v, ecosystem, name) {
    const out = [];
    for (const a of v.affected || []) {
        if (a.package && (a.package.ecosystem !== ecosystem || a.package.name.toLowerCase() !== name.toLowerCase())) continue;
        for (const r of a.ranges || []) for (const e of r.events || []) if (e.fixed) out.push(e.fixed);
    }
    return out;
}

/** Merge vulnerability records that alias each other (GHSA/CVE/PYSEC) into unique groups. */
export function dedupeVulns(vulns) {
    const groups = [];
    for (const v of vulns) {
        const ids = new Set([v.id, ...(v.aliases || [])]);
        const hit = groups.find((g) => [...ids].some((i) => g.ids.has(i)));
        if (hit) {
            ids.forEach((i) => hit.ids.add(i));
            hit.records.push(v);
        } else groups.push({ ids, records: [v] });
    }
    return groups;
}

export async function queryOsv(http, { ecosystem, name, version }) {
    const osvEco = ecosystem === 'npm' ? 'npm' : 'PyPI';
    const vulns = [];
    let pageToken;
    for (let page = 0; page < 5; page++) {
        const body = { package: { name, ecosystem: osvEco }, ...(version ? { version } : {}), ...(pageToken ? { page_token: pageToken } : {}) };
        const { data } = await http.request('https://api.osv.dev/v1/query', { method: 'POST', json: body });
        vulns.push(...(data?.vulns || []));
        pageToken = data?.next_page_token;
        if (!pageToken) break;
    }
    return summariseVulns(vulns, osvEco, name);
}

export function summariseVulns(vulns, osvEco, name) {
    const malicious = vulns.filter((v) => /^MAL-/.test(v.id) || (v.aliases || []).some((a) => /^MAL-/.test(a)));
    const regular = vulns.filter((v) => !malicious.includes(v));
    const groups = dedupeVulns(regular);
    let maxLevel = 'none';
    let maxCvss = null;
    const fixed = new Set();
    const items = groups.map((g) => {
        let level = 'none';
        let cvss = null;
        for (const r of g.records) {
            const s = vulnSeverity(r);
            if (RANK[s.level] > RANK[level]) level = s.level;
            if (s.cvss !== null) cvss = Math.max(cvss ?? 0, s.cvss);
            fixedVersionsOf(r, osvEco, name).forEach((f) => fixed.add(f));
        }
        if (RANK[level] > RANK[maxLevel]) maxLevel = level;
        if (cvss !== null) maxCvss = Math.max(maxCvss ?? 0, cvss);
        const primary = g.records[0];
        return { id: primary.id, aliases: [...g.ids].filter((i) => i !== primary.id).slice(0, 5), severity: level === 'none' ? 'unknown' : level, summary: (primary.summary || '').slice(0, 140) };
    });
    items.sort((a, b) => (RANK[b.severity] ?? -1) - (RANK[a.severity] ?? -1));
    const fixedVersions = [...fixed].sort(cmpVersions);
    return {
        count: groups.length,
        maxSeverity: groups.length ? (maxLevel === 'none' ? 'unknown' : maxLevel) : 'none',
        maxCvss,
        ids: items.slice(0, 10).map((i) => i.id),
        top: items.slice(0, 5),
        fixedVersions: fixedVersions.slice(-8),
        highestFixedVersion: fixedVersions.length ? fixedVersions[fixedVersions.length - 1] : null,
        malicious: malicious.length
            ? { listed: true, ids: malicious.map((m) => m.id).slice(0, 5), summary: (malicious[0].summary || '').slice(0, 160) }
            : { listed: false, ids: [], summary: null },
    };
}
export { LABEL, RANK };
