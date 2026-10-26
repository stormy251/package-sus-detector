export const DAY_MS = 86400000;

export function daysBetween(fromIso, to = Date.now()) {
    if (!fromIso) return null;
    const t = Date.parse(fromIso);
    if (Number.isNaN(t)) return null;
    return Math.floor((to - t) / DAY_MS);
}

/** Normalise a PyPI name per PEP 503. */
export const normPypi = (n) => n.toLowerCase().replace(/[-_.]+/g, '-');

/** Loose version compare (numeric dotted segments, pre-release suffix sorts lower). Good enough for sorting fixed-version hints. */
export function cmpVersions(a, b) {
    const parse = (v) => {
        const [core, pre] = String(v).replace(/^v/, '').split(/[-+]/);
        return { nums: core.split('.').map((x) => parseInt(x, 10) || 0), pre: pre ?? null };
    };
    const A = parse(a), B = parse(b);
    for (let i = 0; i < Math.max(A.nums.length, B.nums.length); i++) {
        const d = (A.nums[i] || 0) - (B.nums[i] || 0);
        if (d) return d;
    }
    if (A.pre && !B.pre) return -1;
    if (!A.pre && B.pre) return 1;
    return 0;
}

export function errMsg(e) {
    return e?.message ? String(e.message).slice(0, 200) : String(e).slice(0, 200);
}
