// Licence classification + simple compatibility note. This is a convenience signal, not legal advice.
const PERMISSIVE = /^(mit|apache software|mozilla public license 2|isc license|python software foundation|mit-0|isc|bsd|bsd-[23]-clause|0bsd|apache|apache-2\.0|apache 2\.0|unlicense|cc0|cc0-1\.0|zlib|python-2\.0|psf|bsl-1\.0|wtfpl|blueoak|artistic-2\.0|x11|curl|hpnd)/i;
const WEAK = /(lgpl|mpl|epl|cddl|eupl|cpl|ms-rl)/i;
const NETWORK = /(agpl|affero|sspl|osl-3|rpl)/i;
const STRONG = /(gpl|general public license)/i;

export function classifyLicense(raw) {
    const text = Array.isArray(raw) ? raw.join(' OR ') : String(raw || '').trim();
    if (!text || /^(unknown|none|n\/a)$/i.test(text)) return { spdx: null, category: 'unknown' };
    if (/^unlicensed$/i.test(text) || /proprietary|commercial|see license/i.test(text)) return { spdx: text, category: 'proprietary' };
    if (text.length > 120) return { spdx: text.slice(0, 80) + '…', category: 'unknown' }; // PyPI sometimes holds the full licence text
    const alts = text.replace(/[()]/g, '').split(/\s+OR\s+/i);
    const cats = alts.map((a) => {
        const t = a.trim();
        if (NETWORK.test(t)) return 'network-copyleft';
        if (WEAK.test(t)) return 'weak-copyleft';
        if (STRONG.test(t)) return 'strong-copyleft';
        if (PERMISSIVE.test(t)) return 'permissive';
        return 'unknown';
    });
    // for "A OR B" the consumer may pick the most permissive alternative
    const order = ['permissive', 'weak-copyleft', 'strong-copyleft', 'network-copyleft', 'unknown'];
    const best = alts.length > 1 ? order.find((o) => cats.includes(o) && o !== 'unknown') || 'unknown' : cats[0];
    return { spdx: text, category: best };
}

export function licenseNote(category, projectLicenseType) {
    const base = {
        permissive: 'Permissive licence; low obligations beyond attribution.',
        'weak-copyleft': 'Weak copyleft; modifications to the library itself may need to be shared.',
        'strong-copyleft': 'Strong copyleft (GPL family); may impose obligations on distributed combined works.',
        'network-copyleft': 'Network copyleft (AGPL/SSPL family); can apply to software offered over a network.',
        proprietary: 'Proprietary or unlicensed; no open-source grant detected. Check terms before use.',
        unknown: 'Licence missing or not recognised; review manually.',
    }[category];
    let compat = null;
    if (projectLicenseType && projectLicenseType !== 'unspecified') {
        if (['strong-copyleft', 'network-copyleft'].includes(category) && ['permissive', 'proprietary'].includes(projectLicenseType)) compat = 'review_needed';
        else if (category === 'proprietary' || category === 'unknown') compat = 'review_needed';
        else compat = 'likely_compatible';
    }
    return { note: base, compatibility: compat };
}
