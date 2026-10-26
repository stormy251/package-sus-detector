const enc = encodeURIComponent;

/** purl -> endoflife.date product map (one request per run, cached by http layer). */
export async function loadEolIdentifiers(http) {
    const { data } = await http.request('https://endoflife.date/api/v1/identifiers/purl');
    const map = new Map();
    for (const r of data?.result || []) {
        const m = /^pkg:(npm|pypi)\/(.+)$/.exec(r.identifier);
        if (m) map.set(`${m[1]}:${decodeURIComponent(m[2]).toLowerCase()}`, r.product.name);
    }
    return map;
}

/** Is this package version's release cycle end-of-life according to endoflife.date? Returns null when the package has no mapping. */
export async function eolFor(http, eolMap, { ecosystem, name, version }) {
    const product = eolMap?.get(`${ecosystem}:${name.toLowerCase()}`);
    if (!product || !version) return null;
    const { data } = await http.request(`https://endoflife.date/api/v1/products/${enc(product)}`);
    const releases = data?.result?.releases;
    if (!releases) return null;
    const parts = version.split('.');
    // choose the most specific matching cycle: "4.2" before "4"
    const cycle = releases.find((r) => r.name === parts.slice(0, 2).join('.')) || releases.find((r) => r.name === parts[0]) || releases.find((r) => version.startsWith(`${r.name}.`));
    if (!cycle) return { product, cycle: null, isEol: null };
    return { product, cycle: cycle.name, isEol: !!cycle.isEol, eolFrom: cycle.eolFrom || null, isMaintained: cycle.isMaintained ?? null, latestInCycle: cycle.latest?.name || null };
}
