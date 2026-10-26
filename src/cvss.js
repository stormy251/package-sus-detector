// CVSS v3.x base score from a vector string. (v4 vectors are not scored here; OSV's database_specific.severity is used instead.)
const W = {
    AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
    AC: { L: 0.77, H: 0.44 },
    UI: { N: 0.85, R: 0.62 },
    CIA: { H: 0.56, L: 0.22, N: 0 },
};
const roundUp = (x) => {
    const i = Math.round(x * 100000);
    return i % 10000 === 0 ? i / 100000 : (Math.floor(i / 10000) + 1) / 10;
};
export function cvss3Score(vector) {
    if (typeof vector !== 'string' || !/^CVSS:3\.[01]\//.test(vector)) return null;
    const m = Object.fromEntries(vector.split('/').slice(1).map((p) => p.split(':')));
    if (!(m.AV in W.AV) || !(m.AC in W.AC) || !(m.UI in W.UI) || !(m.C in W.CIA) || !(m.I in W.CIA) || !(m.A in W.CIA) || !['U', 'C'].includes(m.S)) return null;
    const changed = m.S === 'C';
    const pr = { N: 0.85, L: changed ? 0.68 : 0.62, H: changed ? 0.5 : 0.27 }[m.PR];
    if (pr === undefined) return null;
    const iss = 1 - (1 - W.CIA[m.C]) * (1 - W.CIA[m.I]) * (1 - W.CIA[m.A]);
    const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
    const expl = 8.22 * W.AV[m.AV] * W.AC[m.AC] * pr * W.UI[m.UI];
    if (impact <= 0) return 0;
    return changed ? roundUp(Math.min(1.08 * (impact + expl), 10)) : roundUp(Math.min(impact + expl, 10));
}
