// Fetches the lists of popular package names bundled into the Actor (used for typosquat distance).
// Sources (free, public):
//  - npm:  wooorm/npm-high-impact (MIT)  -> lib/top-download.js
//  - PyPI: hugovk/top-pypi-packages      -> top-pypi-packages.min.json (30-day downloads, ClickHouse-sourced)
// Run: npm run fetch-popular   (output: data/popular-npm.json, data/popular-pypi.json)
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const TOP_N = Number(process.env.TOP_N || 5000);
const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

async function getText(url) {
    const res = await fetch(url, { headers: { 'user-agent': 'package-sus-detector-build/1.0' } });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.text();
}

const npmSrc = await getText('https://raw.githubusercontent.com/wooorm/npm-high-impact/main/lib/top-download.js');
const npmNames = [...npmSrc.matchAll(/^\s*'([^']+)',?\s*$/gm)].map((m) => m[1]).slice(0, TOP_N);

const pypi = JSON.parse(await getText('https://hugovk.github.io/top-pypi-packages/top-pypi-packages.min.json'));
const pypiNames = pypi.rows.map((r) => r.project.toLowerCase().replace(/[-_.]+/g, '-')).slice(0, TOP_N);

const stamp = new Date().toISOString();
await writeFile(path.join(dataDir, 'popular-npm.json'), JSON.stringify({ generatedAt: stamp, source: 'wooorm/npm-high-impact top-download', names: npmNames }));
await writeFile(path.join(dataDir, 'popular-pypi.json'), JSON.stringify({ generatedAt: stamp, source: 'hugovk/top-pypi-packages', sourceLastUpdate: pypi.last_update, names: pypiNames }));
console.log(`npm: ${npmNames.length} names, pypi: ${pypiNames.length} names`);
