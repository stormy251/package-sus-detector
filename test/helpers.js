import { createHttp } from '../src/http.js';
import { buildIndex } from '../src/typosquat.js';

export const NOW = Date.parse('2026-10-25T12:00:00Z');
export const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();

export function json(body, status = 200, headers = {}) {
    return new Response(body === null ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** routes: array of [predicate(url, init) | string-prefix | RegExp, handler | body | Response]. First match wins. Unmatched -> 404. */
export function mockFetch(routes, log = []) {
    return async (url, init = {}) => {
        log.push({ url, method: init.method || 'GET', body: init.body });
        for (const [m, h] of routes) {
            const hit = typeof m === 'function' ? m(url, init) : m instanceof RegExp ? m.test(url) : url.startsWith(m);
            if (!hit) continue;
            const v = typeof h === 'function' ? await h(url, init) : h;
            return v instanceof Response ? v : json(v);
        }
        return json(null, 404);
    };
}

export function mockHttp(routes, opts = {}) {
    const log = [];
    const http = createHttp({ fetchImpl: mockFetch(routes, log), sleepImpl: async () => {}, ...opts });
    return { http, log };
}

export const popular = {
    npm: buildIndex(['react', 'react-dom', 'lodash', 'express', 'axios', 'left-pad', 'chalk', 'typescript', 'webpack', 'moment'], { generatedAt: 'test' }),
    pypi: buildIndex(['requests', 'numpy', 'pandas', 'django', 'flask', 'boto3', 'urllib3', 'setuptools'], { generatedAt: 'test' }),
};

export const npmLatest = (over = {}) => ({ name: 'pkg', version: '1.2.3', license: 'MIT', maintainers: [{ name: 'a' }, { name: 'b' }], repository: { url: 'git+https://github.com/x/y.git' }, description: 'desc', scripts: {}, ...over });
export const ddPackage = (versions) => ({ packageKey: {}, versions: versions.map(([version, publishedAt, isDefault]) => ({ versionKey: { system: 'NPM', name: 'x', version }, publishedAt, isDefault: !!isDefault })) });
