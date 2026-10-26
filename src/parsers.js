import { normPypi } from './util.js';

const EXACT_SEMVER = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;

/** Parse "name", "name@1.2.3", "@scope/name@1.2.3", "npm:name@1.2.3", "pypi:name==1.2.3", "name==1.2.3". */
export function parsePackageSpec(raw, defaultEcosystem = 'npm') {
    let s = String(raw ?? '').trim();
    if (!s) return null;
    let ecosystem = defaultEcosystem;
    const pref = /^(npm|pypi|pip|python):/i.exec(s);
    if (pref) {
        ecosystem = /^npm$/i.test(pref[1]) ? 'npm' : 'pypi';
        s = s.slice(pref[0].length).trim();
    }
    if (ecosystem === 'npm') {
        const m = /^(@[^/@\s]+\/[^@\s]+|[^@\s]+)(?:@(.+))?$/.exec(s);
        if (!m) return { ecosystem, name: s, version: null, invalid: true };
        return { ecosystem, name: m[1].toLowerCase(), ...versionPart(m[2], 'npm') };
    }
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*(?:(===|==|~=|>=|<=|!=|>|<)\s*([^\s;,]+))?/.exec(s) || /^(.+)$/.exec(s);
    if (!m) return { ecosystem, name: s, version: null, invalid: true };
    const name = m[1];
    if (m[3] && (m[2] === '==' || m[2] === '===') && !m[3].includes('*')) return { ecosystem, name: normPypi(name), version: m[3], requestedRange: null };
    return { ecosystem, name: normPypi(name), version: null, requestedRange: m[2] ? `${m[2]}${m[3]}` : null };
}

function versionPart(v, ecosystem) {
    if (!v) return { version: null, requestedRange: null };
    const t = v.trim();
    const m = EXACT_SEMVER.exec(t);
    if (m) return { version: m[1], requestedRange: null };
    if (/^(latest|next|beta|canary|rc|\*|x)$/i.test(t) || /^[\^~><=|\s]|[xX*]|\|\||\s-\s/.test(t) || ecosystem !== 'npm') return { version: null, requestedRange: t };
    return { version: null, requestedRange: t };
}

/** Extract specs from a package.json string. Non-registry specs (git, file, link, workspace, URL) are skipped and reported. */
export function parsePackageJson(text, { includeDev = true } = {}) {
    let json;
    try { json = JSON.parse(text); } catch (e) { return { specs: [], skipped: [], error: `package.json is not valid JSON: ${e.message}` }; }
    const sections = ['dependencies', 'optionalDependencies', 'peerDependencies', ...(includeDev ? ['devDependencies'] : [])];
    const specs = [];
    const skipped = [];
    for (const sec of sections) {
        for (const [name, range] of Object.entries(json[sec] || {})) {
            if (typeof range === 'string' && /^(git|git\+|github:|file:|link:|workspace:|https?:|\.{0,2}\/|[\w.-]+\/[\w.-]+$)/.test(range) && !/^npm:/.test(range)) {
                skipped.push({ name, spec: range, reason: 'non-registry specifier' });
                continue;
            }
            let pkgName = name;
            let r = range;
            const alias = /^npm:(@?[^@]+)@(.+)$/.exec(String(range)); // "alias": "npm:real-name@^1.0.0"
            if (alias) { pkgName = alias[1]; r = alias[2]; }
            specs.push({ ecosystem: 'npm', name: pkgName.toLowerCase(), ...versionPart(String(r), 'npm'), section: sec });
        }
    }
    return { specs, skipped };
}

/** Extract specs from a requirements.txt string. */
export function parseRequirements(text) {
    const specs = [];
    const skipped = [];
    const lines = String(text).replace(/\\\r?\n/g, ' ').split(/\r?\n/);
    for (let line of lines) {
        line = line.replace(/\s+#.*$/, '').replace(/^#.*$/, '').trim();
        if (!line) continue;
        if (/^-/.test(line) || /^(git\+|https?:|file:|\.{1,2}\/|\/)/.test(line) || /@\s*(git\+|https?:|file:)/.test(line)) {
            skipped.push({ spec: line.slice(0, 120), reason: 'option, URL, VCS or local path' });
            continue;
        }
        line = line.split(/\s*;\s*/)[0].split(/\s+--hash/)[0].trim();
        const p = parsePackageSpec(line, 'pypi');
        if (p && !p.invalid) specs.push({ ...p, ecosystem: 'pypi', section: 'requirements.txt' });
    }
    return { specs, skipped };
}
