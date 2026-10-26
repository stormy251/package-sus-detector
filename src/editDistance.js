/** Optimal-string-alignment (Damerau-Levenshtein) distance with an early-exit cutoff. Returns cutoff+1 when exceeded. */
export function osaDistance(a, b, cutoff = 3) {
    if (a === b) return 0;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > cutoff) return cutoff + 1;
    let prev2 = new Array(lb + 1).fill(0);
    let prev = Array.from({ length: lb + 1 }, (_, j) => j);
    for (let i = 1; i <= la; i++) {
        const cur = new Array(lb + 1);
        cur[0] = i;
        let rowMin = cur[0];
        for (let j = 1; j <= lb; j++) {
            const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
            let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
            if (i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) {
                v = Math.min(v, prev2[j - 2] + 1);
            }
            cur[j] = v;
            if (v < rowMin) rowMin = v;
        }
        if (rowMin > cutoff) return cutoff + 1;
        prev2 = prev;
        prev = cur;
    }
    return Math.min(prev[lb], cutoff + 1);
}
