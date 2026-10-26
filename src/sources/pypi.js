import { normPypi } from '../util.js';

export async function fetchPypi(http, { name, version, includeDownloads = true }) {
    const out = { ecosystem: 'pypi', exists: false, errors: [] };
    const norm = normPypi(name);
    const { data } = await http.request(`https://pypi.org/pypi/${encodeURIComponent(norm)}/json`);
    if (!data) return out;
    const info = data.info || {};
    out.exists = true;
    out.canonicalName = info.name || norm;
    out.latestVersion = info.version;
    out.registryUrl = `https://pypi.org/project/${norm}/`;

    const dlP = includeDownloads
        ? http.request(`https://pypistats.org/api/packages/${encodeURIComponent(norm)}/recent`).catch((e) => ({ err: e }))
        : Promise.resolve(null);

    const releases = data.releases || {};
    const versions = Object.keys(releases).filter((v) => releases[v].length);
    out.versionCount = versions.length;
    const uploadTimes = (v) => (releases[v] || []).map((f) => f.upload_time_iso_8601 || f.upload_time).filter(Boolean).sort();
    const allDates = versions.flatMap(uploadTimes).sort();
    out.firstPublishedAt = allDates[0] || null;
    out.latestReleaseAt = uploadTimes(info.version)[0] || allDates[allDates.length - 1] || null;

    const canonical = (v) => String(v).toLowerCase().replace(/^v/, '').replace(/(\.0)+$/, '').replace(/\.0(?=(a|b|rc|\.post|\.dev))/g, '');
    const matched = version ? versions.find((v) => v === version) || versions.find((v) => canonical(v) === canonical(version)) : null;
    out.versionExists = !version || !!matched;
    out.checkedVersion = out.versionExists ? matched || info.version : null;
    const files = releases[out.checkedVersion] || [];
    out.checkedVersionPublishedAt = uploadTimes(out.checkedVersion)[0] || null;
    const yanked = files.length > 0 && files.every((f) => f.yanked);
    out.yanked = yanked;
    const inactive = (info.classifiers || []).some((c) => /Development Status :: 7 - Inactive/.test(c));
    out.inactiveClassifier = inactive;
    out.deprecated = {
        flag: yanked || inactive,
        message: yanked ? `Release yanked${files[0]?.yanked_reason ? `: ${String(files[0].yanked_reason).slice(0, 200)}` : ''}` : inactive ? 'Classifier "Development Status :: 7 - Inactive"' : null,
    };
    out.latestDeprecated = !!info.yanked || inactive;
    const roles = data.ownership?.roles;
    out.maintainerCount = Array.isArray(roles) && roles.length ? new Set(roles.map((r) => r.user)).size : null; // null = not exposed (e.g. org-owned)
    out.ownedByOrganization = !!data.ownership?.organization;
    out.installHooks = files.length > 0 && !files.some((f) => f.packagetype === 'bdist_wheel'); // sdist-only => setup.py runs at install
    out.repositoryUrl = Object.values(info.project_urls || {}).find((u) => /github\.com|gitlab\.com|bitbucket\.org|codeberg\.org/.test(u)) || info.home_page || null;
    out.licenseRaw = info.license_expression || (info.license && info.license.length <= 120 ? info.license : null) || (info.classifiers || []).find((c) => c.startsWith('License :: '))?.split(' :: ').pop() || (info.license ? info.license.slice(0, 120) : null);
    out.licenseClassifiers = (info.classifiers || []).filter((c) => c.startsWith('License :: ') && !/^License :: OSI Approved$/.test(c)).map((c) => c.split(' :: ').pop());
    out.description = info.summary ? String(info.summary).slice(0, 200) : null;
    out.pypiVulnerabilityCount = Array.isArray(data.vulnerabilities) ? data.vulnerabilities.length : null;

    const dl = await dlP;
    if (dl?.err) out.errors.push(`downloads: ${dl.err.message}`);
    else out.weeklyDownloads = dl?.data?.data?.last_week ?? null;
    return out;
}
