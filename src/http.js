// Small HTTP client: descriptive User-Agent, per-host concurrency + min spacing, retries with backoff
// (honours Retry-After), per-request timeout, and an in-memory promise cache (dedupes identical requests).
const DEFAULT_UA = 'package-sus-detector/1.0 (Apify Actor; risk-signal checker for npm/PyPI; +https://apify.com/store)';

const HOST_LIMITS = {
    'registry.npmjs.org': { concurrency: 8, minIntervalMs: 0 },
    'api.npmjs.org': { concurrency: 2, minIntervalMs: 250 },
    'pypi.org': { concurrency: 8, minIntervalMs: 0 },
    'pypistats.org': { concurrency: 2, minIntervalMs: 250 },
    'api.osv.dev': { concurrency: 8, minIntervalMs: 0 },
    'api.deps.dev': { concurrency: 6, minIntervalMs: 0 },
    'endoflife.date': { concurrency: 2, minIntervalMs: 100 },
};
const FALLBACK_LIMIT = { concurrency: 4, minIntervalMs: 100 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class HostGate {
    constructor({ concurrency, minIntervalMs }) {
        this.concurrency = concurrency;
        this.minIntervalMs = minIntervalMs;
        this.active = 0;
        this.queue = [];
        this.nextStart = 0;
    }

    async run(fn) {
        if (this.active >= this.concurrency) await new Promise((resolve) => this.queue.push(resolve));
        this.active++;
        try {
            if (this.minIntervalMs) {
                const now = Date.now();
                const wait = Math.max(0, this.nextStart - now);
                this.nextStart = Math.max(now, this.nextStart) + this.minIntervalMs;
                if (wait) await sleep(wait);
            }
            return await fn();
        } finally {
            this.active--;
            const next = this.queue.shift();
            if (next) next();
        }
    }
}

export function createHttp({
    fetchImpl = globalThis.fetch,
    userAgent = process.env.PSD_USER_AGENT || DEFAULT_UA,
    timeoutMs = 15000,
    maxRetries = 3,
    baseBackoffMs = 400,
    hostLimits = HOST_LIMITS,
    cacheTtlMs = 3000,
    sleepImpl = sleep,
} = {}) {
    const gates = new Map();
    const cache = new Map();
    const stats = { requests: 0, retries: 0, failures: 0, cacheHits: 0, byHost: {} };

    const gateFor = (host) => {
        if (!gates.has(host)) gates.set(host, new HostGate(hostLimits[host] || FALLBACK_LIMIT));
        return gates.get(host);
    };

    async function attempt(url, { method, body, headers }) {
        const host = new URL(url).host;
        let lastErr;
        for (let i = 0; i <= maxRetries; i++) {
            try {
                stats.requests++;
                stats.byHost[host] = (stats.byHost[host] || 0) + 1;
                const res = await gateFor(host).run(() =>
                    fetchImpl(url, {
                        method,
                        body,
                        headers: { 'user-agent': userAgent, accept: 'application/json', ...headers },
                        signal: AbortSignal.timeout(timeoutMs),
                    }),
                );
                if (res.status === 429 || res.status >= 500) {
                    const ra = Number(res.headers?.get?.('retry-after'));
                    lastErr = new Error(`HTTP ${res.status} from ${host}`);
                    lastErr.status = res.status;
                    if (i < maxRetries) {
                        stats.retries++;
                        const wait = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 10000) : baseBackoffMs * 2 ** i + Math.random() * 150;
                        await sleepImpl(wait);
                        continue;
                    }
                    throw lastErr;
                }
                if (res.status === 404 || res.status === 400 || res.status === 410) return { status: res.status, data: null };
                if (!res.ok) {
                    const e = new Error(`HTTP ${res.status} from ${host}`);
                    e.status = res.status;
                    throw e;
                }
                const text = await res.text();
                let data = null;
                try { data = text ? JSON.parse(text) : null; } catch { throw new Error(`Invalid JSON from ${host}`); }
                return { status: res.status, data };
            } catch (err) {
                lastErr = err;
                if (err.status && err.status < 500 && err.status !== 429) break;
                if (i < maxRetries) {
                    stats.retries++;
                    await sleepImpl(baseBackoffMs * 2 ** i);
                    continue;
                }
            }
        }
        stats.failures++;
        throw lastErr;
    }

    /** GET/POST JSON. Resolves {status, data}; 404/400/410 resolve with data=null. Throws on network/5xx/429 after retries. */
    function request(url, { method = 'GET', json, headers, cacheKey } = {}) {
        const body = json === undefined ? undefined : JSON.stringify(json);
        const key = cacheKey || `${method} ${url} ${body || ''}`;
        if (cache.has(key)) {
            stats.cacheHits++;
            return cache.get(key);
        }
        const p = attempt(url, { method, body, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers } });
        cache.set(key, p);
        p.catch(() => cache.delete(key)); // do not cache failures
        // short-lived cache: dedupes the repeated lookups made for one package without holding every response in memory
        if (!cacheTtlMs) cache.delete(key); else p.then(() => setTimeout(() => cache.delete(key), cacheTtlMs).unref(), () => {});
        return p;
    }

    return { request, stats, userAgent };
}
