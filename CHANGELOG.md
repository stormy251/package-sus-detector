# Changelog

## 0.1.0 (actor.json version 0.1)
- New `lockfile` input: package-lock.json / npm-shrinkwrap.json (v1-v3), yarn.lock (classic and Berry), pnpm-lock.yaml (v5-v9), poetry.lock, uv.lock and Pipfile.lock, auto-detected, checked at exact locked versions.
- New `baseLockfile` input: check (and charge for) only the package versions added or changed compared with the base branch. An empty diff is a successful, zero-package run.
- New CI gate: `failOn` (never / caution / suspicious / not_found) and `failOnRiskScore`. The run summary gains `gate` (passed, exitCode, failing packages, incomplete, complete, notChecked) and a PR-comment-ready `markdown` report. The Actor run itself still always ends as succeeded.
- README: sections for lockfiles, CI and GitHub Actions (apify-client example), Claude Code / Cursor MCP setup and an AGENTS.md / CLAUDE.md snippet; more search-friendly title and description.
- Unchanged: default behaviour, verdicts, scoring, and the pay-per-event event name `package-checked` ($0.01 per package).

## 1.0 (Apify build 0.0.2)
- Initial release: npm + PyPI checks, OSV vulnerabilities and malicious-package listings, deps.dev, endoflife.date, typosquat and slopsquat signals, package.json / requirements.txt input, pay-per-event pricing.
- Build 0.0.2: removed the unsupported `$schema` key from dataset schema fields.
