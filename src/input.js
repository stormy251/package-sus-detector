import { parsePackageSpec, parsePackageJson, parseRequirements } from './parsers.js';
import { parseLockfile } from './lockfiles.js';

export const MAX_PACKAGES_HARD_CAP = 5000;

/** Turn Actor input into a de-duplicated list of package specs plus bookkeeping about what was skipped. */
export function buildSpecs(input = {}) {
    const ecosystem = input.ecosystem === 'pypi' ? 'pypi' : 'npm';
    const notes = [];
    const raw = [];
    for (const p of input.packages || []) {
        const spec = parsePackageSpec(p, ecosystem);
        if (spec) raw.push({ ...spec, section: 'packages' });
    }
    if (input.packageJson && String(input.packageJson).trim()) {
        const r = parsePackageJson(String(input.packageJson), { includeDev: input.includeDevDependencies !== false });
        if (r.error) notes.push(r.error);
        raw.push(...r.specs);
        if (r.skipped.length) notes.push(`${r.skipped.length} package.json entries skipped (non-registry specifiers): ${r.skipped.slice(0, 5).map((s) => s.name).join(', ')}${r.skipped.length > 5 ? ', …' : ''}`);
    }
    if (input.requirementsTxt && String(input.requirementsTxt).trim()) {
        const r = parseRequirements(String(input.requirementsTxt));
        raw.push(...r.specs);
        if (r.skipped.length) notes.push(`${r.skipped.length} requirements.txt lines skipped (options/URLs/VCS/local paths).`);
    }
    let unchanged = 0;
    if (input.lockfile && String(input.lockfile).trim()) {
        const r = parseLockfile(String(input.lockfile), { includeDev: input.includeDevDependencies !== false });
        if (r.error) notes.push(r.error);
        else {
            let lockSpecs = r.specs;
            if (input.baseLockfile && String(input.baseLockfile).trim()) {
                const b = parseLockfile(String(input.baseLockfile), { includeDev: true });
                if (b.error) notes.push(`baseLockfile ignored: ${b.error}`);
                else if (b.type !== r.type) notes.push(`baseLockfile ignored: it is ${b.type} but lockfile is ${r.type}.`);
                else {
                    const known = new Set(b.specs.map((x) => `${x.ecosystem}:${x.name}@${x.version}`));
                    lockSpecs = r.specs.filter((x) => !known.has(`${x.ecosystem}:${x.name}@${x.version}`));
                    unchanged = r.specs.length - lockSpecs.length;
                    notes.push(`Lockfile diff: ${lockSpecs.length} added or changed package version(s) checked; ${unchanged} unchanged entr${unchanged === 1 ? 'y' : 'ies'} skipped.`);
                }
            }
            raw.push(...lockSpecs);
            if (r.skipped.length) notes.push(`${r.skipped.length} ${r.type} entries skipped (workspace links, git/file/URL sources): ${r.skipped.slice(0, 5).map((s) => s.name).join(', ')}${r.skipped.length > 5 ? ', …' : ''}`);
        }
    }
    const seen = new Set();
    const specs = [];
    let duplicates = 0;
    for (const s of raw) {
        if (s.invalid && !s.name) continue;
        const key = `${s.ecosystem}:${s.name}@${s.version || s.requestedRange || ''}`;
        if (seen.has(key)) { duplicates++; continue; }
        seen.add(key);
        specs.push(s);
    }
    const cap = Math.min(Number(input.maxPackages) > 0 ? Number(input.maxPackages) : 500, MAX_PACKAGES_HARD_CAP);
    let truncated = 0;
    if (specs.length > cap) { truncated = specs.length - cap; specs.length = cap; notes.push(`Input had more packages than maxPackages (${cap}); ${truncated} were not checked.`); }
    if (duplicates) notes.push(`${duplicates} duplicate entries removed.`);
    return { specs, notes, duplicates, truncated, unchanged };
}
