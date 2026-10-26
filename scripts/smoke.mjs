// Live smoke test against the real public registries (no Apify platform needed).
// Usage: node scripts/smoke.mjs [concurrency]   -> prints a table and writes smoke-results/smoke.json
import { mkdir, writeFile } from 'node:fs/promises';
import { createHttp } from '../src/http.js';
import { loadPopular } from '../src/typosquat.js';
import { loadEolIdentifiers } from '../src/sources/eol.js';
import { checkPackage } from '../src/check.js';
import { parsePackageSpec } from '../src/parsers.js';

const concurrency = Number(process.argv[2] || 8);
const INPUT = [
    'npm:react', 'npm:lodash', 'npm:express', 'npm:@types/node', 'npm:request', 'npm:left-pad',
    'npm:lodash@4.17.15', 'npm:minimist@1.2.0', 'npm:node-fetch@2.6.0',
    'npm:lodahs', 'npm:reactt', 'npm:expresss', 'npm:react-dom-utils-helper-pro', 'npm:express-ai-validator-helper-pro',
    'pypi:requests', 'pypi:numpy', 'pypi:django==2.2.0', 'pypi:pyyaml==5.3', 'pypi:pillow==6.0.0',
    'pypi:reqeusts', 'pypi:flask-super-auth-helper', 'pypi:nose', 'pypi:python-dateutil',
];
const http = createHttp();
const popular = { npm: loadPopular('npm'), pypi: loadPopular('pypi') };
const t0 = Date.now();
const eolMap = await loadEolIdentifiers(http);
const eolMs = Date.now() - t0;
const specs = INPUT.map((s) => parsePackageSpec(s));
const results = new Array(specs.length);
let next = 0;
const wall0 = Date.now();
await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < specs.length) {
        const i = next++;
        results[i] = await checkPackage(specs[i], { http, popular, eolMap, options: { includeScorecard: false } });
    }
}));
const wallMs = Date.now() - wall0;
const lat = results.map((r) => r.latencyMs).sort((a, b) => a - b);
const pct = (p) => lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))];
console.log('package'.padEnd(42), 'verdict'.padEnd(11), 'score', 'ms'.padStart(5), 'top reasons');
for (const r of results) {
    console.log(`${r.ecosystem}:${r.name}${r.requestedVersion ? '@' + r.requestedVersion : ''}`.padEnd(42), r.verdict.padEnd(11), String(r.riskScore).padStart(5), String(r.latencyMs).padStart(5), (r.reasons || []).filter((x) => x.points > 0).slice(0, 3).map((x) => x.code).join(','));
}
const stats = {
    packages: results.length,
    concurrency,
    wallMs,
    eolIdentifierLoadMs: eolMs,
    wallMsPerPackage: Math.round(wallMs / results.length),
    latencyMs: { min: lat[0], p50: pct(50), p90: pct(90), max: lat[lat.length - 1], mean: Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) },
    httpRequests: http.stats.requests,
    requestsPerPackage: +(http.stats.requests / results.length).toFixed(1),
    retries: http.stats.retries,
    failures: http.stats.failures,
    byHost: http.stats.byHost,
    verdicts: results.reduce((m, r) => ((m[r.verdict] = (m[r.verdict] || 0) + 1), m), {}),
    partial: results.filter((r) => r.dataQuality === 'partial').length,
    errorsSample: results.flatMap((r) => r.errors || []).slice(0, 5),
    rssMbEnd: Math.round(process.memoryUsage().rss / 1048576),
    heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1048576),
};
console.log(JSON.stringify(stats, null, 2));
await mkdir('smoke-results', { recursive: true });
await writeFile('smoke-results/smoke.json', JSON.stringify({ stats, results }, null, 2));
