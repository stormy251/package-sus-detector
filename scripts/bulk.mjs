// Throughput + false-positive probe: checks the top-N most popular npm and PyPI packages (should be mostly "ok").
// Usage: node scripts/bulk.mjs [perEcosystem=150] [concurrency=8]
import { mkdir, writeFile } from 'node:fs/promises';
import { createHttp } from '../src/http.js';
import { loadPopular } from '../src/typosquat.js';
import { loadEolIdentifiers } from '../src/sources/eol.js';
import { checkPackage } from '../src/check.js';
import { prefetchNpmDownloads } from '../src/sources/npm.js';

const n = Number(process.argv[2] || 150);
const concurrency = Number(process.argv[3] || 8);
const http = createHttp();
const popular = { npm: loadPopular('npm'), pypi: loadPopular('pypi') };
const eolMap = await loadEolIdentifiers(http);
const specs = [
    ...popular.npm.names.slice(0, n).map((name) => ({ ecosystem: 'npm', name })),
    ...popular.pypi.names.slice(0, n).map((name) => ({ ecosystem: 'pypi', name })),
];
await prefetchNpmDownloads(http, specs.filter((x) => x.ecosystem === 'npm').map((x) => x.name));
const results = new Array(specs.length);
let next = 0;
const t0 = Date.now();
const cpu0 = process.cpuUsage();
await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < specs.length) {
        const i = next++;
        results[i] = await checkPackage(specs[i], { http, popular, eolMap, options: {} });
    }
}));
const wallMs = Date.now() - t0;
const cpu = process.cpuUsage(cpu0);
const lat = results.map((r) => r.latencyMs).sort((a, b) => a - b);
const verdicts = results.reduce((m, r) => ((m[r.verdict] = (m[r.verdict] || 0) + 1), m), {});
const flagged = results.filter((r) => r.verdict !== 'ok').map((r) => `${r.ecosystem}:${r.name}=${r.verdict}(${r.riskScore}) ${r.reasons.filter((x) => x.points > 0).slice(0, 3).map((x) => x.code).join(',')}`);
const stats = {
    packages: results.length, concurrency, wallMs, packagesPerSecond: +(results.length / (wallMs / 1000)).toFixed(2),
    latencyMs: { p50: lat[Math.floor(lat.length * 0.5)], p90: lat[Math.floor(lat.length * 0.9)], max: lat[lat.length - 1] },
    httpRequests: http.stats.requests, requestsPerPackage: +(http.stats.requests / results.length).toFixed(2), retries: http.stats.retries, failures: http.stats.failures, byHost: http.stats.byHost,
    verdicts, partial: results.filter((r) => r.dataQuality === 'partial').length,
    cpuSeconds: +((cpu.user + cpu.system) / 1e6).toFixed(2), rssMbEnd: Math.round(process.memoryUsage().rss / 1048576),
    errorsSample: [...new Set(results.flatMap((r) => r.errors || []))].slice(0, 8),
};
console.log(JSON.stringify(stats, null, 2));
console.log('non-ok among top popular:\n' + flagged.join('\n'));
await mkdir('smoke-results', { recursive: true });
await writeFile('smoke-results/bulk.json', JSON.stringify({ stats, flagged, results }, null, 2));
