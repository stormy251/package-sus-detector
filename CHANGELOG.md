# Changelog

## 0.2.0 (actor.json version 0.2)
Scoring tweak for two misses found in our own 23-package sample (both previously scored just under the `caution` line of 25):
- **Abandoned near-copies of popular names:** the reduced typosquat weight for "established" packages (>= 1 year old, >= 10,000 weekly downloads) now also requires that the package is still maintained (a release within the `abandonedDays` window, 1,460 days by default). A package one edit away from a top package that has not released for years is no longer vouched for by its download count. Example: `expres` (1 edit from `express`, last release 2013, ~12k weekly downloads) 24 -> 43, `caution`.
- **New signal `placeholder_package` (+10):** the registry description says the package is a placeholder or name reservation (for example "Placeholder to prevent dependency confusion"), and weekly downloads are under 1,000. Example: `react-codeshift` 21 -> 31, `caution`.
- No change to the 0.1 default behaviour, verdict thresholds, schemas or the $0.01 `package-checked` price. Regression check: 42 well-known packages stay `ok` and the top 300 npm + top 300 PyPI packages give identical verdicts before and after (599 ok, 1 caution: `mimic-fn`, deprecated). See `scripts/legit-check.mjs`.
- README: links to the free browser demo (https://stormy251.github.io/package-sus-demo/) and the GitHub Action (https://github.com/stormy251/package-sus-detector-action).
- Known limit: these two rules were added after seeing the two misses, so they are tuned to those patterns; expect other novel look-alikes to still slip under the line.

## 0.1.0 (actor.json version 0.1)
- New `lockfile` input: package-lock.json / npm-shrinkwrap.json (v1-v3), yarn.lock (classic and Berry), pnpm-lock.yaml (v5-v9), poetry.lock, uv.lock and Pipfile.lock, auto-detected, checked at exact locked versions.
- New `baseLockfile` input: check (and charge for) only the package versions added or changed compared with the base branch. An empty diff is a successful, zero-package run.
- New CI gate: `failOn` (never / caution / suspicious / not_found) and `failOnRiskScore`. The run summary gains `gate` (passed, exitCode, failing packages, incomplete, complete, notChecked) and a PR-comment-ready `markdown` report. The Actor run itself still always ends as succeeded.
- README: sections for lockfiles, CI and GitHub Actions (apify-client example), Claude Code / Cursor MCP setup and an AGENTS.md / CLAUDE.md snippet; more search-friendly title and description.
- Unchanged: default behaviour, verdicts, scoring, and the pay-per-event event name `package-checked` ($0.01 per package).

## 1.0 (Apify build 0.0.2)
- Initial release: npm + PyPI checks, OSV vulnerabilities and malicious-package listings, deps.dev, endoflife.date, typosquat and slopsquat signals, package.json / requirements.txt input, pay-per-event pricing.
- Build 0.0.2: removed the unsupported `$schema` key from dataset schema fields.
