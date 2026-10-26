import { fetchNpm } from './sources/npm.js';
import { fetchPypi } from './sources/pypi.js';
import { queryOsv } from './sources/osv.js';
import { depsdevVersion, depsdevScorecard } from './sources/depsdev.js';
import { eolFor } from './sources/eol.js';
import { classifyLicense, licenseNote } from './license.js';
import { typosquatCheck, hallucinationPlausibility } from './typosquat.js';
import { evaluate, notFoundEvaluation } from './scoring.js';
import { daysBetween, errMsg, normPypi } from './util.js';

const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const PYPI_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

export function validName(ecosystem, name) {
    if (!name || name.length > 214) return false;
    return ecosystem === 'npm' ? NPM_NAME.test(name) : PYPI_NAME.test(name);
}

const SOURCES = {
    npm: ['registry.npmjs.org', 'api.npmjs.org'],
    pypi: ['pypi.org', 'pypistats.org'],
};

/**
 * Check one package. Never throws for per-package problems: returns verdict "error" (not charged) when a registry lookup fails.
 * @param {{ecosystem:'npm'|'pypi', name:string, version?:string, requestedRange?:string}} spec
 * @param {{http:object, popular:{npm:object,pypi:object}, eolMap?:Map, options?:object, now?:number}} ctx
 */
export async function checkPackage(spec, ctx) {
    const { http, popular, eolMap, options = {}, now = Date.now() } = ctx;
    const { ecosystem, name, version, requestedRange } = spec;
    const started = Date.now();
    const base = {
        recordType: 'package',
        ecosystem,
        name,
        requestedVersion: version || null,
        requestedRange: requestedRange || null,
    };
    const errors = [];

    if (!validName(ecosystem, name)) {
        return { ...base, verdict: 'not_found', riskScore: null, charged: false, reasons: [{ code: 'invalid_name', severity: 'info', points: 0, message: `"${name}" is not a syntactically valid ${ecosystem} package name.` }], checkedAt: new Date(now).toISOString(), latencyMs: 0, errors };
    }

    const index = popular[ecosystem];
    const typo = typosquatCheck(name, ecosystem, index);
    const halluc = hallucinationPlausibility(name, index);
    const osvName = ecosystem === 'pypi' ? normPypi(name) : name;

    let registry;
    try {
        registry = ecosystem === 'npm'
            ? await fetchNpm(http, { name, version, includeDownloads: options.includeDownloads !== false })
            : await fetchPypi(http, { name, version, includeDownloads: options.includeDownloads !== false });
    } catch (e) {
        return { ...base, verdict: 'error', riskScore: null, charged: false, reasons: [{ code: 'registry_lookup_failed', severity: 'info', points: 0, message: `Registry lookup failed: ${errMsg(e)}. Not charged; retry later.` }], checkedAt: new Date(now).toISOString(), latencyMs: Date.now() - started, errors: [errMsg(e)] };
    }
    registry.requestedVersion = version || null;
    errors.push(...registry.errors);

    // ---- not found path
    if (!registry.exists) {
        let vulns = null;
        if (options.includeVulnerabilities !== false) {
            try { vulns = await queryOsv(http, { ecosystem, name: osvName }); } catch (e) { errors.push(`osv: ${errMsg(e)}`); }
        }
        const ev = notFoundEvaluation({ typo, halluc, vulns });
        return {
            ...base,
            verdict: 'not_found',
            riskScore: ev.score,
            charged: true,
            summary: 'Not found in the public registry. Treat as a possibly hallucinated or removed package name.',
            reasons: ev.reasons,
            registry: { exists: false, url: ecosystem === 'npm' ? `https://www.npmjs.com/package/${name}` : `https://pypi.org/project/${normPypi(name)}/` },
            typosquat: typo,
            slopsquat: ev.slopsquat,
            vulnerabilities: vulns ? { count: 0, maxSeverity: 'none', malicious: vulns.malicious } : null,
            checkedAt: new Date(now).toISOString(),
            latencyMs: Date.now() - started,
            sources: SOURCES[ecosystem].concat(vulns ? ['api.osv.dev'] : []),
            dataQuality: errors.length ? 'partial' : 'complete',
            errors,
        };
    }

    const checkVersion = registry.checkedVersion || registry.latestVersion;
    // ---- parallel enrichment
    const [vulnsR, ddR, eolR] = await Promise.allSettled([
        options.includeVulnerabilities !== false && registry.versionExists ? queryOsv(http, { ecosystem, name: osvName, version: checkVersion }) : Promise.resolve(null),
        options.includeDepsDev !== false && registry.versionExists ? depsdevVersion(http, { ecosystem, name: ecosystem === 'pypi' ? normPypi(name) : name, version: checkVersion }) : Promise.resolve(null),
        options.includeEol !== false ? eolFor(http, eolMap, { ecosystem, name: registry.canonicalName || name, version: checkVersion }) : Promise.resolve(null),
    ]);
    const settle = (res, label) => {
        if (res.status === 'fulfilled') return res.value;
        errors.push(`${label}: ${errMsg(res.reason)}`);
        return null;
    };
    const vulns = settle(vulnsR, 'osv');
    const dd = settle(ddR, 'deps.dev');
    const eol = settle(eolR, 'endoflife.date');
    let scorecard = null;
    if (options.includeScorecard && dd?.sourceProject) {
        try { scorecard = await depsdevScorecard(http, dd.sourceProject); } catch (e) { errors.push(`scorecard: ${errMsg(e)}`); }
    }

    let lic = classifyLicense(registry.licenseRaw || dd?.licenses);
    if (lic.category === 'unknown' && dd?.licenses?.length) lic = classifyLicense(dd.licenses);
    if (lic.category === 'unknown' && registry.licenseClassifiers?.length) lic = classifyLicense(registry.licenseClassifiers.join(' OR '));
    const note = licenseNote(lic.category, options.projectLicenseType);
    const license = { spdx: lic.spdx, category: lic.category, note: note.note, compatibility: note.compatibility };

    const ev = evaluate({ registry, vulns, typo, halluc, license, eol, options, now });
    const ageDays = daysBetween(registry.firstPublishedAt, now);
    const sinceRelease = daysBetween(registry.latestReleaseAt, now);
    const staleDays = options.staleDays ?? 730;

    return {
        ...base,
        verdict: ev.verdict,
        riskScore: ev.score,
        charged: true,
        resolvedVersion: registry.versionExists ? checkVersion : null,
        summary: ev.reasons.filter((r) => r.points > 0).slice(0, 3).map((r) => r.message).join(' ') || 'No notable risk signals found.',
        reasons: ev.reasons,
        registry: {
            exists: true,
            url: registry.registryUrl,
            description: registry.description,
            firstPublishedAt: registry.firstPublishedAt || null,
            ageDays,
            latestVersion: registry.latestVersion,
            latestReleaseAt: registry.latestReleaseAt || null,
            daysSinceLastRelease: sinceRelease,
            stale: sinceRelease !== null ? sinceRelease > staleDays : null,
            versionCount: registry.versionCount ?? null,
            versionExists: registry.versionExists,
            maintainerCount: registry.maintainerCount ?? null,
            weeklyDownloads: registry.weeklyDownloads ?? null,
            deprecated: registry.deprecated.flag,
            deprecationMessage: registry.deprecated.message,
            installTimeCode: registry.installHooks ?? null,
            securityHoldingPackage: !!registry.securityHolding,
            repositoryUrl: registry.repositoryUrl || null,
        },
        license,
        vulnerabilities: vulns
            ? { checkedVersion: checkVersion, count: vulns.count, maxSeverity: vulns.maxSeverity, maxCvss: vulns.maxCvss, ids: vulns.ids, top: vulns.top, fixedVersions: vulns.fixedVersions, highestFixedVersion: vulns.highestFixedVersion, knownMalicious: vulns.malicious.listed, maliciousIds: vulns.malicious.ids }
            : null,
        depsDev: dd ? { licenses: dd.licenses, advisoryCount: dd.advisoryCount, isDeprecated: dd.isDeprecated, projectStatus: dd.projectStatus, sourceProject: dd.sourceProject, hasProvenance: dd.slsaProvenance || dd.attestations, scorecard } : null,
        endOfLife: eol,
        typosquat: typo,
        slopsquat: ev.slopsquat,
        checkedAt: new Date(now).toISOString(),
        latencyMs: Date.now() - started,
        sources: [...SOURCES[ecosystem], 'api.osv.dev', 'api.deps.dev'].concat(eol ? ['endoflife.date'] : []),
        dataQuality: errors.length ? 'partial' : 'complete',
        errors,
    };
}
