// Regression probe: ~40 well-known legitimate packages must stay "ok", and known look-alike / placeholder
// packages should be flagged. Live network. Usage: node scripts/legit-check.mjs [out.json]
import { writeFile } from 'node:fs/promises';
import { createHttp } from '../src/http.js';
import { loadPopular } from '../src/typosquat.js';
import { loadEolIdentifiers } from '../src/sources/eol.js';
import { checkPackage } from '../src/check.js';
import { prefetchNpmDownloads } from '../src/sources/npm.js';

const LEGIT = {
    npm: ['express', 'react', 'react-dom', 'lodash', 'axios', 'chalk', 'commander', 'moment', 'typescript', 'webpack', 'vue', 'next', 'preact', 'express-session', 'body-parser', 'uuid', 'debug', 'dotenv', 'jest', 'eslint', 'prettier', 'rxjs', 'underscore', 'async', 'bluebird', 'cors', 'mongoose', 'redis', 'ws', 'semver'],
    pypi: ['requests', 'django', 'numpy', 'pandas', 'flask', 'boto3', 'urllib3', 'pytest', 'scipy', 'pydantic', 'fastapi', 'sqlalchemy'],
};
const WATCH = [['npm', 'expres'], ['npm', 'react-codeshift'], ['npm', 'lodashs'], ['npm', 'unused-imports'], ['npm', 'request'], ['npm', 'left-pad'], ['npm', 'node-uuid'], ['pypi', 'pycrypto'], ['pypi', 'nose']];
const http = createHttp();
const popular = { npm: loadPopular('npm'), pypi: loadPopular('pypi') };
const eolMap = await loadEolIdentifiers(http);
await prefetchNpmDownloads(http, [...LEGIT.npm, ...WATCH.filter((w) => w[0] === 'npm').map((w) => w[1])]);
const run = (ecosystem, name) => checkPackage({ ecosystem, name }, { http, popular, eolMap, options: {} });
const legit = [];
for (const e of Object.keys(LEGIT)) for (const n of LEGIT[e]) legit.push(await run(e, n));
const watch = [];
for (const [e, n] of WATCH) watch.push(await run(e, n));
const row = (r) => `${r.ecosystem.padEnd(5)} ${r.name.padEnd(18)} ${r.verdict.padEnd(10)} ${String(r.riskScore).padStart(3)}  ${r.reasons.filter((x) => x.points > 0).map((x) => x.code).join(',')}`;
console.log('--- legitimate packages (expect ok) ---');
legit.forEach((r) => console.log(row(r)));
const bad = legit.filter((r) => r.verdict !== 'ok');
console.log(`\nlegit: ${legit.length} checked, ${legit.length - bad.length} ok, ${bad.length} not ok${bad.length ? ': ' + bad.map((r) => r.name).join(', ') : ''}`);
console.log('\n--- watch list (look-alikes, placeholders, deprecated) ---');
watch.forEach((r) => console.log(row(r)));
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify({ legit, watch }, null, 1));
process.exit(bad.length ? 1 : 0);
