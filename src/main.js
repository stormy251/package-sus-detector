import { Actor, log } from 'apify';
import { createHttp } from './http.js';
import { buildSpecs } from './input.js';
import { checkPackage } from './check.js';
import { loadPopular } from './typosquat.js';
import { loadEolIdentifiers } from './sources/eol.js';
import { buildSummary } from './summary.js';
import { errMsg } from './util.js';
import { prefetchNpmDownloads } from './sources/npm.js';

const EVENT = 'package-checked';

await Actor.init();
try {
    const input = (await Actor.getInput()) || {};
    const startedAt = new Date().toISOString();
    const { specs, notes, unchanged, truncated } = buildSpecs(input);
    if (!specs.length && unchanged > 0) {
        // lockfile diff with nothing new to check: a successful, free, empty run (never a failed one)
        const summary = buildSummary([], { startedAt, finishedAt: new Date().toISOString(), notes, failOn: input.failOn, failOnRiskScore: input.failOnRiskScore });
        await Actor.setValue('SUMMARY', summary);
        if (input.includeSummaryItem !== false) await Actor.pushData(summary);
        await Actor.setStatusMessage('No new or changed packages in the lockfile diff; nothing to check.');
    } else if (!specs.length) {
        await Actor.fail('No packages to check. Provide "packages", "packageJson", "requirementsTxt" or "lockfile".');
    } else {
        const http = createHttp();
        const popular = { npm: loadPopular('npm'), pypi: loadPopular('pypi') };
        const options = {
            includeDownloads: input.includeDownloads !== false,
            includeVulnerabilities: input.includeVulnerabilities !== false,
            includeDepsDev: input.includeDepsDev !== false,
            includeEol: input.includeEol !== false,
            includeScorecard: input.includeScorecard === true,
            projectLicenseType: input.projectLicenseType || 'unspecified',
            newPackageDays: Number(input.newPackageDays) || 30,
            staleDays: Number(input.staleDays) || 730,
        };
        let eolMap = null;
        if (options.includeEol) {
            try { eolMap = await loadEolIdentifiers(http); } catch (e) { log.warning(`endoflife.date unavailable: ${errMsg(e)}`); }
        }
        if (options.includeDownloads) await prefetchNpmDownloads(http, specs.filter((x) => x.ecosystem === 'npm').map((x) => x.name));
        log.info(`Checking ${specs.length} package(s)…`);

        const concurrency = Math.min(Math.max(Number(input.concurrency) || 8, 1), 16);
        const items = new Array(specs.length);
        let next = 0;
        let stop = false;
        let stoppedEarly = false;

        Actor.on('aborting', () => { stop = true; });

        async function worker() {
            while (!stop) {
                const i = next++;
                if (i >= specs.length) return;
                let item;
                try {
                    item = await checkPackage(specs[i], { http, popular, eolMap, options });
                } catch (e) {
                    // defensive: checkPackage should not throw, but one bad package must never fail the run
                    item = { recordType: 'package', ecosystem: specs[i].ecosystem, name: specs[i].name, requestedVersion: specs[i].version || null, verdict: 'error', riskScore: null, charged: false, reasons: [{ code: 'internal_error', severity: 'info', points: 0, message: errMsg(e) }], checkedAt: new Date().toISOString() };
                }
                items[i] = item;
                const { charged, ...record } = item;
                if (charged) {
                    // pushData with an event name saves the item and charges 'package-checked' in one call (respects the user's max-spend limit)
                    const res = await Actor.pushData(record, EVENT);
                    if (res?.eventChargeLimitReached) {
                        log.warning('Spending limit reached; stopping early.');
                        stop = true;
                        stoppedEarly = true;
                    }
                } else {
                    await Actor.pushData(record);
                }
            }
        }
        await Promise.all(Array.from({ length: Math.min(concurrency, specs.length) }, worker));

        const done = items.filter(Boolean);
        if (done.length < specs.length) {
            stoppedEarly = true;
            notes.push(`${specs.length - done.length} package(s) were not checked because the run stopped early (spending limit or abort).`);
        }
        const summary = buildSummary(done, {
            startedAt,
            finishedAt: new Date().toISOString(),
            notes,
            httpStats: http.stats,
            stoppedEarly,
            popularMeta: { npm: popular.npm.meta.generatedAt, pypi: popular.pypi.meta.generatedAt },
            failOn: input.failOn,
            failOnRiskScore: input.failOnRiskScore,
            notChecked: truncated + (specs.length - done.length),
        });
        await Actor.setValue('SUMMARY', summary);
        if (input.includeSummaryItem !== false) await Actor.pushData(summary); // no event name: not charged
        await Actor.setStatusMessage(`Checked ${done.length}: ${summary.verdictCounts.ok} ok, ${summary.verdictCounts.caution} caution, ${summary.verdictCounts.suspicious} suspicious, ${summary.verdictCounts.not_found} not found, ${summary.verdictCounts.error} errors.${summary.gate.enabled ? ` CI gate ${summary.gate.passed ? 'passed' : `FAILED (${summary.gate.failingCount} package(s))`}.` : ''}`);
        log.info(`Done. HTTP stats: ${JSON.stringify(http.stats)}`);
    }
} catch (e) {
    log.exception(e, 'Actor crashed');
    await Actor.fail(errMsg(e));
}
await Actor.exit();
