import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { osaDistance } from './editDistance.js';
import { normPypi } from './util.js';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const collapse = (n) => n.toLowerCase().replace(/[^a-z0-9]/g, '');

const COMBO_AFFIXES = ['js', 'node', 'nodejs', 'py', 'python', 'py3', 'python3', 'official', 'secure', 'new', 'fix', 'fixed', 'api', 'sdk', 'client', 'cli', 'lib', 'core', 'pro', 'plus', 'free', 'real', 'original', 'latest', 'v2', 'v3', '2', '3', 'dev'];
const GENERIC_TOKENS = new Set(['utils', 'util', 'helper', 'helpers', 'toolkit', 'manager', 'wrapper', 'easy', 'simple', 'super', 'fast', 'smart', 'auto', 'advanced', 'enhanced', 'pro', 'plus', 'lite', 'ai', 'gpt', 'llm', 'agent', 'tools', 'kit', 'handler', 'connector', 'integration', 'plugin', 'extension', 'client', 'sdk', 'core', 'lib', 'api', 'secure', 'auth', 'validator', 'parser', 'formatter']);

export function loadPopular(ecosystem) {
    const file = ecosystem === 'npm' ? 'popular-npm.json' : 'popular-pypi.json';
    const { names, generatedAt, source } = JSON.parse(readFileSync(path.join(dataDir, file), 'utf8'));
    return buildIndex(names, { generatedAt, source });
}

export function buildIndex(names, meta = {}) {
    const rank = new Map();
    const collapsed = new Map();
    const byLen = new Map();
    names.forEach((n, i) => {
        rank.set(n, i + 1);
        const c = collapse(n);
        if (!collapsed.has(c)) collapsed.set(c, n);
        if (!byLen.has(n.length)) byLen.set(n.length, []);
        byLen.get(n.length).push(n);
    });
    // token set for plausibility check: single-word popular names (react, flask, django ...)
    const wordNames = new Set(names.filter((n) => /^[a-z]{4,}$/.test(n)).slice(0, 1500));
    return { names, rank, collapsed, byLen, wordNames, meta };
}

/** Compare a package name with the popular-name index. */
export function typosquatCheck(name, ecosystem, index) {
    const norm = ecosystem === 'pypi' ? normPypi(name) : name.toLowerCase();
    const result = { suspected: false, isPopular: false, matches: [], indexSize: index.names.length };
    if (index.rank.has(norm)) {
        result.isPopular = true;
        result.popularRank = index.rank.get(norm);
        return result;
    }
    const matches = new Map();
    const add = (popular, type, distance) => {
        const prev = matches.get(popular);
        const strength = { separator_variant: 3, edit_distance: 2, combo: 1 }[type];
        if (!prev || strength > prev.strength) matches.set(popular, { popular, rank: index.rank.get(popular), type, distance, strength });
    };

    const c = collapse(norm);
    const sepVariant = index.collapsed.get(c);
    if (sepVariant && sepVariant !== norm && c.length >= 4) add(sepVariant, 'separator_variant', 0);

    // edit distance 1 (len >= 5), 2 (len >= 9) on normalised name
    if (norm.length >= 5) {
        const maxD = norm.length >= 9 ? 2 : 1;
        for (let len = norm.length - maxD; len <= norm.length + maxD; len++) {
            for (const cand of index.byLen.get(len) || []) {
                if (cand.length < 5) continue;
                const d = osaDistance(norm, cand, maxD);
                if (d >= 1 && d <= maxD) add(cand, 'edit_distance', d);
            }
        }
    }

    // combosquatting: popular name +/- a common affix
    const parts = norm.split(/[-_.@/]+/).filter(Boolean);
    if (parts.length >= 2) {
        const stripped = parts.filter((p) => !COMBO_AFFIXES.includes(p));
        if (stripped.length && stripped.length < parts.length) {
            const joined = stripped.join('-');
            if (index.rank.has(joined) && joined.length >= 4 && index.rank.get(joined) <= 2000) add(joined, 'combo', 0);
        }
    }
    const m = norm.match(/^(.{4,}?)(js|py|2|3)$/);
    if (m && index.rank.has(m[1]) && index.rank.get(m[1]) <= 2000) add(m[1], 'combo', 0);

    result.matches = [...matches.values()].sort((a, b) => b.strength - a.strength || a.distance - b.distance || a.rank - b.rank).slice(0, 3).map(({ strength, ...r }) => r);
    result.suspected = result.matches.length > 0;
    result.strongest = result.matches[0]?.type || null;
    return result;
}

/** Heuristic: does this name look like something an LLM would invent (generic compound of real package words)? */
export function hallucinationPlausibility(name, index) {
    const norm = name.toLowerCase().replace(/^@/, '').replace(/\//g, '-');
    const tokens = norm.split(/[-_.]+/).filter(Boolean);
    const features = [];
    if (tokens.length >= 3) features.push('three_or_more_tokens');
    if (tokens.some((t) => GENERIC_TOKENS.has(t))) features.push('generic_suffix_or_prefix');
    if (tokens.some((t) => index.wordNames.has(t))) features.push('contains_popular_package_word');
    if (tokens.length >= 2 && tokens.every((t) => /^[a-z]+$/.test(t))) features.push('all_plain_words');
    const plausible = features.length >= 3 || (features.includes('contains_popular_package_word') && features.includes('generic_suffix_or_prefix'));
    return { plausible, features };
}
