import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttp } from '../src/http.js';
import { json, mockFetch } from './helpers.js';

test('retries on 429/5xx then succeeds; honours Retry-After; does not cache failures', async () => {
    let n = 0;
    const waits = [];
    const http = createHttp({
        fetchImpl: mockFetch([['https://x.test/a', () => (++n < 3 ? json(null, n === 1 ? 429 : 503, n === 1 ? { 'retry-after': '2' } : {}) : { ok: true })]]),
        sleepImpl: async (ms) => waits.push(ms),
    });
    const r = await http.request('https://x.test/a');
    assert.deepEqual(r.data, { ok: true });
    assert.equal(n, 3);
    assert.equal(waits[0], 2000);
    assert.equal(http.stats.retries, 2);
});

test('gives up after maxRetries and throws', async () => {
    const http = createHttp({ fetchImpl: mockFetch([['https://x.test/', () => json(null, 500)]]), sleepImpl: async () => {}, maxRetries: 2 });
    await assert.rejects(http.request('https://x.test/z'), /HTTP 500/);
    assert.equal(http.stats.failures, 1);
});

test('404 resolves with null data; identical requests are cached', async () => {
    let n = 0;
    const http = createHttp({ fetchImpl: mockFetch([['https://x.test/nf', () => { n++; return json(null, 404); }]]), sleepImpl: async () => {} });
    const [a, b] = await Promise.all([http.request('https://x.test/nf'), http.request('https://x.test/nf')]);
    assert.equal(a.data, null);
    assert.equal(b.status, 404);
    assert.equal(n, 1);
    assert.equal(http.stats.cacheHits, 1);
});

test('per-host concurrency limit is respected', async () => {
    let active = 0, max = 0;
    const http = createHttp({
        hostLimits: { 'c.test': { concurrency: 2, minIntervalMs: 0 } },
        fetchImpl: async () => { active++; max = Math.max(max, active); await new Promise((r) => setTimeout(r, 15)); active--; return json({ ok: 1 }); },
        sleepImpl: async () => {},
    });
    await Promise.all(Array.from({ length: 8 }, (_, i) => http.request(`https://c.test/${i}`)));
    assert.equal(max, 2);
});

test('sends descriptive User-Agent', async () => {
    let ua;
    const http = createHttp({ fetchImpl: async (u, init) => { ua = init.headers['user-agent']; return json({}); }, userAgent: 'package-sus-detector/1.0 (test)' });
    await http.request('https://x.test/ua');
    assert.match(ua, /package-sus-detector/);
});

test('invalid JSON from upstream throws', async () => {
    const http = createHttp({ fetchImpl: async () => new Response('<html>', { status: 200 }), sleepImpl: async () => {}, maxRetries: 0 });
    await assert.rejects(http.request('https://x.test/html'), /Invalid JSON/);
});
