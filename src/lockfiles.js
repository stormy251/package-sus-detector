import { normPypi } from './util.js';

/**
 * Lockfile parsers. Every parser returns { type, specs, skipped, error? } where specs are
 * { ecosystem, name, version (exact), requestedRange: null, section } objects, de-duplicated by name@version.
 * No external YAML/TOML dependency: the formats are read with small, defensive line parsers.
 */

export const LOCKFILE_TYPES = ['package-lock', 'yarn-lock', 'pnpm-lock', 'poetry-lock', 'uv-lock', 'pipfile-lock'];

export function detectLockfileType(text) {
    const t = String(text ?? '').replace(/^\uFEFF/, '');
    const head = t.trimStart();
    if (head.startsWith('{')) {
        try {
            const j = JSON.parse(head);
            if (j && (j.lockfileVersion !== undefined || j.packages || (j.dependencies && j.name !== undefined && j.requires !== undefined))) return 'package-lock';
            if (j && (j._meta?.pipfile || j.default || j.develop) && j._meta) return 'pipfile-lock';
            if (j && j.lockfileVersion !== undefined) return 'package-lock';
        } catch { /* fall through */ }
        return null;
    }
    if (/^# yarn lockfile v1/m.test(t) || /^__metadata:\s*$/m.test(t) || /^"?(@?[^@\s"]+)@(npm:|[^\s:]+)[^\n]*:\s*$/m.test(t) && /^\s+version:? "?\d/m.test(t)) return 'yarn-lock';
    if (/^lockfileVersion:/m.test(t) && /^(packages|snapshots|importers):\s*$/m.test(t)) return 'pnpm-lock';
    if (/^\[\[package\]\]\s*$/m.test(t)) {
        if (/^\[metadata\]/m.test(t) && /content-hash\s*=/.test(t)) return 'poetry-lock';
        if (/^version\s*=\s*\d+\s*$/m.test(t) && /^revision\s*=|requires-python\s*=|^\[manifest\]|source\s*=\s*\{/m.test(t)) return 'uv-lock';
        return 'poetry-lock';
    }
    return null;
}

function uniq(specs) {
    const seen = new Set();
    const out = [];
    for (const s of specs) {
        const k = `${s.ecosystem}:${s.name}@${s.version}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(s);
    }
    return out;
}

const isRegistryResolved = (r) => !r || /^https?:\/\//i.test(r) && !/(github\.com|gitlab\.com|bitbucket\.org|codeload)/i.test(r) || /registry|npm/i.test(r);

/** package-lock.json (lockfileVersion 1, 2, 3) and npm-shrinkwrap.json */
export function parsePackageLock(text, { includeDev = true } = {}) {
    let json;
    try { json = JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch (e) { return { type: 'package-lock', specs: [], skipped: [], error: `package-lock.json is not valid JSON: ${e.message}` }; }
    const specs = [];
    const skipped = [];
    const consider = (name, entry) => {
        if (!name || !entry || typeof entry !== 'object') return;
        if (entry.link || !entry.version) { skipped.push({ name, reason: entry.link ? 'workspace link' : 'no version' }); return; }
        if (!includeDev && (entry.dev || entry.devOptional)) return;
        if (/^(file:|link:|git|github:|https?:)/i.test(String(entry.version)) || !/^\d/.test(String(entry.version))) { skipped.push({ name, reason: 'non-registry version' }); return; }
        if (entry.resolved && !isRegistryResolved(entry.resolved)) { skipped.push({ name, reason: 'non-registry source' }); return; }
        specs.push({ ecosystem: 'npm', name: String(name).toLowerCase(), version: String(entry.version), requestedRange: null, section: 'package-lock' });
    };
    if (json.packages && typeof json.packages === 'object') {
        for (const [key, entry] of Object.entries(json.packages)) {
            if (key === '') continue;
            const idx = key.lastIndexOf('node_modules/');
            if (idx === -1) continue; // workspace package folders
            const name = entry?.name && !entry.name.includes('/node_modules/') ? entry.name : key.slice(idx + 'node_modules/'.length);
            consider(name, entry);
        }
    } else if (json.dependencies && typeof json.dependencies === 'object') {
        const walk = (deps) => {
            for (const [name, entry] of Object.entries(deps || {})) {
                const alias = /^npm:(@?[^@]+)@(.+)$/.exec(String(entry?.version || ''));
                if (alias) consider(alias[1], { ...entry, version: alias[2] });
                else consider(name, entry);
                if (entry?.dependencies) walk(entry.dependencies);
            }
        };
        walk(json.dependencies);
    } else {
        return { type: 'package-lock', specs: [], skipped: [], error: 'package-lock.json has neither "packages" nor "dependencies".' };
    }
    return { type: 'package-lock', specs: uniq(specs), skipped };
}

/** yarn.lock (classic v1 and berry v2+) */
export function parseYarnLock(text) {
    const specs = [];
    const skipped = [];
    const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
    let header = null;
    let version = null;
    let resolved = null;
    let resolution = null;
    const flush = () => {
        if (!header) return;
        const first = header.split(',')[0].trim().replace(/^"|"$/g, '');
        const at = first.indexOf('@', 1);
        let name = at > 0 ? first.slice(0, at) : first;
        let range = at > 0 ? first.slice(at + 1) : '';
        if (resolution) { // berry: name@npm:1.2.3 or name@workspace:., name@patch:..., name@https://...
            const rAt = resolution.replace(/^"|"$/g, '').indexOf('@', 1);
            const proto = resolution.replace(/^"|"$/g, '').slice(rAt + 1);
            if (!/^npm:/.test(proto)) { skipped.push({ name, reason: `non-registry resolution (${proto.split(':')[0]})` }); header = null; return; }
        }
        const alias = /^npm:(@?[^@]+)@/.exec(range); // "alias@npm:real@^1.0.0"
        if (alias) name = alias[1];
        if (/^(git|github:|file:|link:|https?:)/i.test(range) || (resolved && !isRegistryResolved(resolved) && !resolution)) { skipped.push({ name, reason: 'non-registry source' }); }
        else if (version && /^\d/.test(version)) specs.push({ ecosystem: 'npm', name: name.toLowerCase(), version, requestedRange: null, section: 'yarn.lock' });
        header = null;
    };
    for (const line of lines) {
        if (!line.trim() || line.startsWith('#')) continue;
        if (!/^\s/.test(line)) {
            flush();
            version = null; resolved = null; resolution = null;
            if (line.startsWith('__metadata')) { header = null; continue; }
            if (line.trimEnd().endsWith(':')) header = line.trimEnd().slice(0, -1);
            continue;
        }
        if (!header) continue;
        let m;
        if ((m = /^ {2}version:?\s+"?([^"\s]+)"?\s*$/.exec(line))) version = m[1];
        else if ((m = /^ {2}resolved\s+"?([^"\s]+)"?/.exec(line))) resolved = m[1];
        else if ((m = /^ {2}resolution:\s+"?([^"\s]+)"?/.exec(line))) resolution = m[1];
    }
    flush();
    return { type: 'yarn-lock', specs: uniq(specs), skipped };
}

/** pnpm-lock.yaml (v5 "/name/1.2.3", v6 "/name@1.2.3", v9 "name@1.2.3" under packages/snapshots) */
export function parsePnpmLock(text) {
    const specs = [];
    const skipped = [];
    let section = null;
    for (const raw of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
        if (/^\S/.test(raw)) { section = /^(packages|snapshots):\s*$/.exec(raw)?.[1] || null; continue; }
        if (!section) continue;
        const m = /^ {2}(?:'([^']+)'|"([^"]+)"|([^\s'"][^:]*?)):\s*(?:\{.*)?$/.exec(raw);
        if (!m) continue;
        let key = (m[1] || m[2] || m[3]).trim();
        key = key.replace(/^\//, '');
        if (/^(https?:|git|file:|link:)/i.test(key) || /@(https?:|git|file:|link:)/i.test(key) || /\/tarball\//.test(key)) { skipped.push({ name: key.slice(0, 80), reason: 'non-registry source' }); continue; }
        let name = null;
        let version = null;
        let r;
        if ((r = /^(@[^/@]+\/[^@/]+|[^@/\s]+)@(\d[^()\s_]*)/.exec(key))) { name = r[1]; version = r[2]; }
        else if ((r = /^(@[^/]+\/[^/]+|[^/]+)\/(\d[^_()\s/]*)/.exec(key))) { name = r[1]; version = r[2]; }
        if (name && version) specs.push({ ecosystem: 'npm', name: name.toLowerCase(), version, requestedRange: null, section: 'pnpm-lock' });
    }
    return { type: 'pnpm-lock', specs: uniq(specs), skipped };
}

/** poetry.lock and uv.lock ([[package]] blocks) */
export function parseTomlPackageLock(text, type = 'poetry-lock') {
    const specs = [];
    const skipped = [];
    let cur = null;
    const flush = () => {
        if (!cur) return;
        if (cur.name && cur.version) {
            if (cur.nonRegistry) skipped.push({ name: cur.name, reason: 'non-registry source' });
            else specs.push({ ecosystem: 'pypi', name: normPypi(cur.name), version: cur.version, requestedRange: null, section: type === 'uv-lock' ? 'uv.lock' : 'poetry.lock' });
        }
        cur = null;
    };
    let inSource = false;
    for (const raw of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
        const line = raw.trim();
        if (line === '[[package]]') { flush(); cur = {}; inSource = false; continue; }
        if (/^\[.+\]$/.test(line) && line !== '[[package]]') {
            inSource = line === '[package.source]';
            if (!cur) continue;
            continue;
        }
        if (!cur) continue;
        let m;
        if (!inSource && (m = /^name\s*=\s*"([^"]+)"/.exec(line))) cur.name = m[1];
        else if (!inSource && (m = /^version\s*=\s*"([^"]+)"/.exec(line))) cur.version = m[1];
        else if (inSource && (m = /^type\s*=\s*"([^"]+)"/.exec(line)) && m[1] !== 'legacy') cur.nonRegistry = true;
        else if (!inSource && (m = /^source\s*=\s*\{(.*)\}/.exec(line)) && !/registry\s*=/.test(m[1])) cur.nonRegistry = true;
    }
    flush();
    return { type, specs: uniq(specs), skipped };
}

/** Pipfile.lock: "default" and "develop" sections with "==x.y.z" pins */
export function parsePipfileLock(text, { includeDev = true } = {}) {
    let json;
    try { json = JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch (e) { return { type: 'pipfile-lock', specs: [], skipped: [], error: `Pipfile.lock is not valid JSON: ${e.message}` }; }
    const specs = [];
    const skipped = [];
    for (const sec of ['default', ...(includeDev ? ['develop'] : [])]) {
        for (const [name, e] of Object.entries(json[sec] || {})) {
            const m = /^===?\s*(.+)$/.exec(e?.version || '');
            if (!m || e.git || e.path || e.file || e.editable) { skipped.push({ name, reason: 'non-registry or unpinned' }); continue; }
            specs.push({ ecosystem: 'pypi', name: normPypi(name), version: m[1].trim(), requestedRange: null, section: 'Pipfile.lock' });
        }
    }
    return { type: 'pipfile-lock', specs: uniq(specs), skipped };
}

/** Auto-detect format and parse. `type` may force a format. */
export function parseLockfile(text, { includeDev = true, type } = {}) {
    const t = type && LOCKFILE_TYPES.includes(type) ? type : detectLockfileType(text);
    switch (t) {
        case 'package-lock': return parsePackageLock(text, { includeDev });
        case 'yarn-lock': return parseYarnLock(text);
        case 'pnpm-lock': return parsePnpmLock(text);
        case 'poetry-lock': return parseTomlPackageLock(text, 'poetry-lock');
        case 'uv-lock': return parseTomlPackageLock(text, 'uv-lock');
        case 'pipfile-lock': return parsePipfileLock(text, { includeDev });
        default: return { type: null, specs: [], skipped: [], error: 'Lockfile format not recognised. Supported: package-lock.json / npm-shrinkwrap.json, yarn.lock, pnpm-lock.yaml, poetry.lock, uv.lock, Pipfile.lock.' };
    }
}
