import { daysBetween } from './util.js';
import { RANK } from './sources/osv.js';

export const DEFAULTS = { newPackageDays: 30, staleDays: 730, abandonedDays: 1460 };

const r = (code, severity, points, message) => ({ code, severity, points, message });

/**
 * Pure scoring function. Produces risk-signal reasons, a 0-100 score and a verdict.
 * All wording describes observable signals; a high score is NOT a finding that a package is malicious.
 */
export function evaluate({ registry, vulns, typo, halluc, license, eol, options = {}, now = Date.now() }) {
    const o = { ...DEFAULTS, ...options };
    const reasons = [];
    const ageDays = daysBetween(registry.firstPublishedAt, now);
    const sinceRelease = daysBetween(registry.latestReleaseAt, now);
    const dl = registry.weeklyDownloads ?? null;
    const established = ageDays !== null && ageDays >= 365 && dl !== null && dl >= 10000;
    const typoFactor = established ? 0.25 : 1;

    if (!registry.versionExists) reasons.push(r('version_not_found', 'medium', 15, `Version ${registry.requestedVersion} was not found in the registry.`));

    if (vulns?.malicious?.listed) reasons.push(r('listed_as_malicious', 'high', 100, `Listed in the OSV malicious-packages feed (${vulns.malicious.ids.join(', ')}).`));

    if (registry.securityHolding) reasons.push(r('security_holding_package', 'high', 30, 'Latest release is an npm security placeholder ("-security" version), which npm uses to replace a package that was removed for security reasons.'));

    // typosquat
    if (typo?.suspected) {
        const m = typo.matches[0];
        const lowTrust = !established && ((ageDays !== null && ageDays < 180) || (dl !== null && dl < 1000));
        if (m.type === 'edit_distance') {
            reasons.push(r('typosquat_similarity', lowTrust ? 'high' : 'low', Math.round((m.distance === 1 ? (lowTrust ? 45 : 25) : lowTrust ? 20 : 10) * typoFactor), `Name is ${m.distance} edit${m.distance > 1 ? 's' : ''} away from popular package "${m.popular}" (rank ${m.rank}).`));
        } else if (m.type === 'separator_variant') {
            reasons.push(r('typosquat_separator_variant', lowTrust ? 'high' : 'low', Math.round((lowTrust ? 40 : 20) * typoFactor), `Name matches popular package "${m.popular}" once separators/punctuation are ignored.`));
        } else {
            reasons.push(r('typosquat_combo', lowTrust ? 'medium' : 'info', Math.round((lowTrust ? 18 : 6) * typoFactor), `Name looks like popular package "${m.popular}" plus a common affix.`));
        }
    }

    if (ageDays !== null) {
        if (ageDays < 7) reasons.push(r('very_new_package', 'high', 25, `First published ${ageDays} day(s) ago.`));
        else if (ageDays <= o.newPackageDays) reasons.push(r('new_package', 'medium', 15, `First published ${ageDays} days ago.`));
        else if (ageDays < 90) reasons.push(r('recent_package', 'low', 5, `First published ${ageDays} days ago.`));
    }

    if (dl !== null) {
        const lowUse = registry.ecosystem === 'npm' ? { vlow: 50, low: 500, mid: 5000 } : { vlow: 100, low: 1000, mid: 10000 };
        if (dl < lowUse.vlow) reasons.push(r('very_low_usage', 'medium', 15, `Only ${dl} downloads in the last week.`));
        else if (dl < lowUse.low) reasons.push(r('low_usage', 'low', 8, `${dl} downloads in the last week.`));
        else if (dl < lowUse.mid) reasons.push(r('modest_usage', 'info', 3, `${dl} downloads in the last week.`));
    }

    if (registry.maintainerCount === 0) reasons.push(r('no_maintainers', 'medium', 10, 'No maintainers listed in registry metadata.'));
    else if (registry.maintainerCount === 1) reasons.push(r('single_maintainer', 'info', 3, 'Single maintainer (bus-factor signal).'));

    if (sinceRelease !== null) {
        if (sinceRelease > o.abandonedDays) reasons.push(r('abandoned', 'medium', 15, `Last release was ${sinceRelease} days ago (> ${o.abandonedDays}).`));
        else if (sinceRelease > o.staleDays) reasons.push(r('stale', 'low', 8, `Last release was ${sinceRelease} days ago (> ${o.staleDays}).`));
    }

    if (registry.deprecated?.flag) reasons.push(r(registry.yanked ? 'yanked' : 'deprecated', 'high', 20, registry.deprecated.message || 'Marked deprecated by the maintainer or registry.'));
    else if (registry.latestDeprecated) reasons.push(r('latest_version_deprecated', 'medium', 15, 'The latest release is marked deprecated/inactive; the package is likely unmaintained.'));

    if (registry.installHooks) {
        const risky = (ageDays !== null && ageDays <= o.newPackageDays) || (dl !== null && dl < 500);
        reasons.push(r('install_time_code', risky ? 'medium' : 'info', risky ? 10 : 2, registry.ecosystem === 'npm' ? 'Package defines preinstall/install/postinstall scripts that run at install time.' : 'Only a source distribution is published for this version, so setup code runs at install time.'));
    }

    if (!registry.repositoryUrl) reasons.push(r('no_repository_link', 'low', 3, 'No source repository link in registry metadata.'));

    // vulnerabilities (version-specific)
    if (vulns && vulns.count > 0) {
        const lvl = vulns.maxSeverity;
        const pts = { critical: 30, high: 20, medium: 10, low: 4, unknown: 8 }[lvl] ?? 8;
        reasons.push(r(`known_vulnerabilities_${lvl}`, ['critical', 'high'].includes(lvl) ? 'high' : 'medium', Math.min(40, pts + Math.min(5, vulns.count - 1)), `${vulns.count} known vulnerabilit${vulns.count === 1 ? 'y' : 'ies'} affect ${registry.checkedVersion || 'this version'} (max severity: ${lvl}${vulns.highestFixedVersion ? `; fix available in ${vulns.highestFixedVersion}` : ''}).`));
    }

    if (license) {
        if (license.category === 'unknown') reasons.push(r('license_missing_or_unrecognised', 'low', 5, 'Licence missing or not recognised.'));
        else if (license.category === 'proprietary') reasons.push(r('license_proprietary', 'low', 5, 'Proprietary/unlicensed package.'));
        else if (['strong-copyleft', 'network-copyleft'].includes(license.category)) reasons.push(r('license_copyleft', 'info', 0, `${license.category} licence (${license.spdx}).`));
        if (license.compatibility === 'review_needed') reasons.push(r('license_review_needed', 'low', 3, 'Licence may conflict with the stated project licence type; review.'));
    }

    if (eol?.isEol) reasons.push(r('release_line_end_of_life', 'medium', 12, `Release line ${eol.cycle} reached end-of-life${eol.eolFrom ? ` on ${eol.eolFrom}` : ''} (endoflife.date).`));

    // slopsquat signal
    const slop = slopsquat({ exists: true, ageDays, dl, typo, halluc, o });
    if (slop.signal === 'high') reasons.push(r('slopsquat_signal_high', 'high', 20, 'Newly created, almost no usage, and the name looks like a plausible AI-suggested package name.'));
    else if (slop.signal === 'medium') reasons.push(r('slopsquat_signal_medium', 'medium', 10, 'New, low-usage package with a name pattern commonly associated with hallucinated or look-alike packages.'));

    const raw = reasons.reduce((s, x) => s + x.points, 0);
    const score = Math.max(0, Math.min(100, Math.round(raw)));
    const highVuln = vulns && ['critical', 'high'].includes(vulns.maxSeverity) && vulns.count > 0;
    const typoHigh = reasons.some((x) => /^typosquat_(similarity|separator_variant)$/.test(x.code) && x.severity === 'high');

    let verdict = 'ok';
    if (vulns?.malicious?.listed || score >= 60 || (typoHigh && score >= 45) || (slop.signal === "high" && score >= 45)) verdict = 'suspicious';
    else if (score >= 25 || highVuln || registry.deprecated?.flag || !registry.versionExists) verdict = 'caution';

    return { reasons: reasons.sort((a, b) => b.points - a.points), score, verdict, slopsquat: slop };
}

export function slopsquat({ exists, ageDays, dl, typo, halluc, o = DEFAULTS }) {
    const plausible = !!halluc?.plausible;
    const basis = [];
    if (halluc?.features?.length) basis.push(...halluc.features.map((f) => `name:${f}`));
    if (!exists) {
        basis.unshift('name_not_registered');
        return { signal: plausible || typo?.suspected ? 'medium' : 'low', plausibleHallucinatedName: plausible, basis, note: 'Name is not registered; an attacker could register it later. Do not assume it exists.' };
    }
    const lowUse = dl === null ? null : dl < 100;
    const isNew = ageDays !== null && ageDays <= o.newPackageDays;
    let signal = 'none';
    if (isNew && lowUse !== false && plausible) signal = 'high';
    else if (isNew && lowUse !== false && (typo?.suspected || ageDays < 7)) signal = 'medium';
    else if (ageDays !== null && ageDays <= 90 && lowUse === true && plausible) signal = 'medium';
    else if (ageDays !== null && ageDays <= 90 && lowUse === true) signal = 'low';
    if (isNew) basis.push('created_recently');
    if (lowUse) basis.push('near_zero_usage');
    return { signal, plausibleHallucinatedName: plausible, basis, note: null };
}

export function notFoundEvaluation({ typo, halluc, vulns }) {
    const reasons = [r('not_in_registry', 'high', 60, 'Package name is not registered in the public registry. AI tools sometimes suggest names that do not exist; an attacker can register such names later (slopsquatting).')];
    if (halluc?.plausible) reasons.push(r('plausible_hallucinated_name', 'medium', 15, 'Name resembles a generic compound of real package words, a pattern common in AI-hallucinated names.'));
    if (typo?.suspected) reasons.push(r('typosquat_similarity', 'medium', 10, `Name is similar to popular package "${typo.matches[0].popular}" (${typo.matches[0].type}).`));
    if (vulns?.malicious?.listed) reasons.push(r('listed_as_malicious', 'high', 100, `The name appears in the OSV malicious-packages feed (${vulns.malicious.ids.join(', ')}); the package has since been removed from the registry.`));
    const score = Math.min(100, reasons.reduce((s, x) => s + x.points, 0));
    return { reasons, score, verdict: 'not_found', slopsquat: slopsquat({ exists: false, typo, halluc }) };
}
export { RANK };
