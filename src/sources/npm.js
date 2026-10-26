import { depsdevPackage } from './depsdev.js';

const enc = (n) => encodeURIComponent(n);

// api.npmjs.org supports comma-separated bulk queries for unscoped names (max 128): batch within a short window
// to cut request volume (and 429s). Scoped names fall back to single requests.
const batchers = new WeakMap();
function batcherFor(http) {
    if (!batchers.has(http)) batchers.set(http, { pending: new Map(), timer: null, prefetched: new Map() });
    return batchers.get(http);
}

/** Bulk-prefetch weekly downloads for many unscoped npm names (100 per request). Failures are ignored (single requests take over). */
export async function prefetchNpmDownloads(http, names) {
    const b = batcherFor(http);
    const todo = [...new Set(names)].filter((n) => !n.startsWith('@') && !b.prefetched.has(n));
    for (let i = 0; i < todo.length; i += 100) {
        const chunk = todo.slice(i, i + 100);
        try {
            const url = `https://api.npmjs.org/downloads/point/last-week/${chunk.map(enc).join(',')}`;
            const { data } = chunk.length === 1 ? await http.request(`https://api.npmjs.org/downloads/point/last-week/${enc(chunk[0])}`) : await http.request(url);
            for (const n of chunk) b.prefetched.set(n, (chunk.length === 1 ? data : data?.[n]) || null);
        } catch { /* fall back to per-package requests */ }
    }
}

function weeklyDownloads(http, name) {
    if (name.startsWith('@')) return http.request(`https://api.npmjs.org/downloads/point/last-week/${enc(name)}`);
    const b = batcherFor(http);
    if (b.prefetched.has(name)) return Promise.resolve({ status: 200, data: b.prefetched.get(name) });
    return new Promise((resolve, reject) => {
        if (!b.pending.has(name)) b.pending.set(name, []);
        b.pending.get(name).push({ resolve, reject });
        if (b.pending.size >= 100) flush(http, b);
        else if (!b.timer) b.timer = setTimeout(() => flush(http, b), 25);
    });
}
async function flush(http, b) {
    clearTimeout(b.timer);
    b.timer = null;
    const batch = b.pending;
    b.pending = new Map();
    const names = [...batch.keys()];
    if (!names.length) return;
    try {
        const { data } = names.length === 1
            ? await http.request(`https://api.npmjs.org/downloads/point/last-week/${enc(names[0])}`)
            : await http.request(`https://api.npmjs.org/downloads/point/last-week/${names.map(enc).join(',')}`);
        for (const [name, waiters] of batch) {
            const entry = names.length === 1 ? data : data?.[name];
            for (const w of waiters) w.resolve({ status: 200, data: entry || null });
        }
    } catch (err) {
        for (const waiters of batch.values()) for (const w of waiters) w.reject(err);
    }
}

async function fullPackumentDates(http, name) {
    // Fallback for very new packages that deps.dev has not indexed yet (such packuments are small).
    const { data } = await http.request(`https://registry.npmjs.org/${enc(name)}`);
    if (!data?.time) return null;
    const entries = Object.entries(data.time).filter(([k]) => k !== 'created' && k !== 'modified' && !k.startsWith('unpublished'));
    return { created: data.time.created || null, versions: entries.map(([version, publishedAt]) => ({ version, publishedAt })) };
}

export async function fetchNpm(http, { name, version, includeDownloads = true }) {
    const out = { ecosystem: 'npm', exists: false, errors: [] };
    const latestP = http.request(`https://registry.npmjs.org/${enc(name)}/latest`);
    const dlP = includeDownloads
        ? weeklyDownloads(http, name).catch((e) => ({ err: e }))
        : Promise.resolve(null);
    const latest = (await latestP).data;
    if (!latest) {
        dlP.catch(() => {});
        return out; // registry 404: not found
    }
    out.exists = true;
    out.canonicalName = latest.name || name;
    out.latestVersion = latest.version;

    let manifest = latest;
    out.versionExists = true;
    if (version && version !== latest.version) {
        const m = (await http.request(`https://registry.npmjs.org/${enc(name)}/${enc(version)}`)).data;
        if (m) manifest = m;
        else out.versionExists = false;
    }
    out.checkedVersion = out.versionExists ? manifest.version : null;

    out.maintainerCount = Array.isArray(latest.maintainers) ? latest.maintainers.length : null;
    out.deprecated = manifest.deprecated ? { flag: true, message: String(manifest.deprecated).slice(0, 300) } : { flag: false, message: null };
    // deprecation of the latest version is the strongest "package is abandoned" signal even when an older version is pinned
    out.latestDeprecated = !!latest.deprecated;
    const scripts = manifest.scripts || {};
    out.installHooks = ['preinstall', 'install', 'postinstall'].some((k) => scripts[k]);
    out.securityHolding = /-security$/.test(String(latest.version)) || /npm\/security-holder/.test(JSON.stringify(latest.bugs || ''));
    out.repositoryUrl = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url || null;
    out.licenseRaw = typeof manifest.license === 'string' ? manifest.license : manifest.license?.type || (Array.isArray(manifest.licenses) ? manifest.licenses.map((l) => l.type).join(' OR ') : null);
    out.description = manifest.description ? String(manifest.description).slice(0, 200) : null;
    out.registryUrl = `https://www.npmjs.com/package/${name}`;

    // dates and version count
    try {
        const dd = await depsdevPackage(http, { ecosystem: 'npm', name });
        let versions = dd.found ? dd.versions : null;
        out.dateSource = 'deps.dev';
        let created = null;
        if (!versions || !versions.length) {
            const fp = await fullPackumentDates(http, name);
            if (fp) {
                versions = fp.versions;
                created = fp.created;
                out.dateSource = 'registry.npmjs.org';
            }
        }
        if (versions?.length) {
            const dates = versions.map((v) => v.publishedAt).filter(Boolean).sort();
            out.firstPublishedAt = created || dates[0] || null;
            out.versionCount = versions.length;
            const lv = versions.find((v) => v.version === latest.version);
            out.latestReleaseAt = lv?.publishedAt || dates[dates.length - 1] || null;
            const cv = versions.find((v) => v.version === out.checkedVersion);
            out.checkedVersionPublishedAt = cv?.publishedAt || null;
        }
    } catch (e) {
        out.errors.push(`dates: ${e.message}`);
    }

    const dl = await dlP;
    if (dl?.err) out.errors.push(`downloads: ${dl.err.message}`);
    else out.weeklyDownloads = dl?.data?.downloads ?? null;
    return out;
}
