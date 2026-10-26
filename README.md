# Package Sus Detector — npm & PyPI package risk check

> **Open source (MIT).** This repository is the source of the [Package Sus Detector Apify Actor](https://apify.com/stormy251/package-sus-detector). The hosted version on Apify is paid (pay-per-event, $0.01 per package checked); you are free to read, fork and self-host the code under the MIT licence. Maintained by [@stormy251](https://github.com/stormy251).

**Check a package before you install it.** Give Package Sus Detector a list of npm or PyPI packages (or paste a `package.json` / `requirements.txt`) and get one structured verdict per package: `ok`, `caution`, `suspicious` or `not_found`, a 0–100 risk score, and machine-readable reasons.

Built for **AI coding agents**, CI pipelines and developers who want a fast pre-install check that catches:

- **Slopsquatting** — package names an AI assistant hallucinated that don't exist (yet), which an attacker could later register.
- **Typosquatting** — names one or two characters away from a popular package (`lodash` vs. a look-alike).
- **Known vulnerabilities** — count, maximum severity, CVSS and fixed versions from [OSV](https://osv.dev).
- **Listed malicious packages** — matches against the OSV malicious-packages feed.
- **Abandoned, deprecated or brand-new packages** — age, last release, maintainer count, weekly downloads, deprecation notices, end-of-life release lines.
- **Licence surprises** — licence classification and a compatibility note against your project's licence type.

Works with the Apify MCP server, so agents such as Claude Code, Cursor, Codex or any MCP client can call it as a tool before running `npm install` or `pip install`. Also checks whole lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `poetry.lock`, `uv.lock`, `Pipfile.lock`), can diff a pull request's lockfile against `main` so you pay only for what changed, and has a CI gate that blocks risky additions. See [Use in CI and GitHub Actions](#use-in-ci-and-github-actions) and [Use with Claude Code, Cursor and other coding agents](#use-with-claude-code-cursor-and-other-coding-agents).

> **Important — risk signals, not accusations.** Results are automated signals computed from public registry and advisory data. A `suspicious` verdict means "look closer before installing", not that a package or its author is malicious. Small, new or unusual-but-legitimate packages can trigger signals, and a clean result is not a guarantee of safety. Always review dependencies before use. Not security advice.

**Try one name free in your browser (no signup):** https://stormy251.github.io/package-sus-demo/ ([source](https://github.com/stormy251/package-sus-demo)). It runs the same checks one package at a time; the paid Actor adds lockfiles, PR diffs, PyPI download signals and the CI gate.

## How to use

1. Open the Actor and paste packages into **Packages to check**, one per line, e.g. `npm:express`, `npm:lodash@4.17.15`, `pypi:requests`, `pypi:django==2.2.0`.
2. Or paste a whole `package.json`, `requirements.txt` or lockfile.
3. Run. Results appear in the dataset (one item per package) plus a `SUMMARY` record in the key-value store.

### Input example

```json
{
  "packages": ["npm:react", "npm:lodash@4.17.15", "pypi:requests", "pypi:django==2.2.0", "npm:some-hallucinated-helper-pro"],
  "projectLicenseType": "permissive"
}
```

| Field | What it does |
| --- | --- |
| `packages` | `name`, `name@version` (npm) or `name==version` (PyPI); prefix with `npm:` / `pypi:` to mix ecosystems |
| `packageJson`, `requirementsTxt` | Paste a manifest instead of listing packages. `includeDevDependencies` controls dev deps |
| `lockfile` | Paste a `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `poetry.lock`, `uv.lock` or `Pipfile.lock`. The format is detected automatically; every entry is checked at its exact locked version, transitive dependencies included |
| `baseLockfile` | The same kind of lockfile from your main branch. Only packages that are new or changed in `lockfile` are checked and charged |
| `failOn`, `failOnRiskScore` | CI gate. `failOn` is `never` (default), `caution`, `suspicious` or `not_found`; `failOnRiskScore` also fails at a 0-100 score. Result in `summary.gate` |
| `projectLicenseType` | `permissive`, `proprietary`, `weak-copyleft` or `strong-copyleft` — drives the licence compatibility note |
| `maxPackages` | Safety cap per run (default 500) |
| `newPackageDays`, `staleDays` | Thresholds for "new" and "stale" signals |
| `includeDownloads`, `includeVulnerabilities`, `includeDepsDev`, `includeEol`, `includeScorecard` | Turn data sources on/off |
| `includeSummaryItem` | Add a summary record to the dataset (not charged) |
| `concurrency` | Parallel lookups (default 8, max 16) |

### Output example (abridged)

```json
{
  "ecosystem": "pypi",
  "name": "django",
  "resolvedVersion": "2.2",
  "verdict": "caution",
  "riskScore": 47,
  "summary": "43 known vulnerabilities affect 2.2 (max severity: critical; fix available in …). Release line 2.2 reached end-of-life on 2022-04-11 (endoflife.date).",
  "reasons": [
    { "code": "known_vulnerabilities_critical", "severity": "high", "points": 35, "message": "…" },
    { "code": "release_line_end_of_life", "severity": "medium", "points": 12, "message": "…" }
  ],
  "registry": { "latestVersion": "…", "weeklyDownloads": 1234567, "maintainerCount": null },
  "vulnerabilities": { "count": 43, "maxSeverity": "critical", "fixedVersions": ["…"] },
  "typosquat": { "suspected": false },
  "slopsquat": { "signal": "none" }
}
```

Every item also carries `license`, `depsDev`, `endOfLife`, `dataQuality` (`complete` / `partial`), `errors`, `latencyMs` and the list of `sources` used. A `SUMMARY` key-value record gives verdict counts, overall verdict, worst offenders and known-malicious listings — handy for CI gates.

### Verdicts

| Verdict | Meaning |
| --- | --- |
| `ok` | No notable risk signals |
| `caution` | Review first: vulnerabilities, deprecation, staleness, unusual licence or similar signals |
| `suspicious` | Strong signals (high score, listed in a malicious-packages feed, or name-similarity combined with very low usage) |
| `not_found` | Name isn't registered — either a typo or a hallucinated name. Do **not** assume it is safe to claim it |
| `error` | The registry lookup failed (temporary); not charged |

## Check a whole lockfile, or only what changed

Paste a lockfile into `lockfile` and every locked package is checked at its exact version. Supported: `package-lock.json` / `npm-shrinkwrap.json` (v1, v2, v3), `yarn.lock` (classic and Berry), `pnpm-lock.yaml`, `poetry.lock`, `uv.lock` and `Pipfile.lock`. Workspace links and git, file and URL sources are skipped and listed in the summary notes. `includeDevDependencies` applies to `package-lock.json` and `Pipfile.lock`; the other formats do not mark dev entries in a way that can be filtered.

A real lockfile has hundreds of entries, and each one is a billed package. To check only what a pull request changed, also pass the lockfile from your main branch as `baseLockfile`:

```json
{
  "lockfile": "<contents of package-lock.json on your branch>",
  "baseLockfile": "<contents of package-lock.json on main>",
  "failOn": "suspicious"
}
```

Only package versions that are new or changed are checked. If nothing changed, the run succeeds with zero packages checked and is free apart from Apify's start event. Use the run's maximum cost setting (`maxTotalChargeUsd` in the API) as a hard cap; the Actor stops cleanly at the cap.

## Use in CI and GitHub Actions

**Easiest: the GitHub Action.** [`stormy251/package-sus-detector-action`](https://github.com/stormy251/package-sus-detector-action) does the lockfile diff against the PR base, calls this Actor with your Apify token, writes the job summary and fails the job at your `fail-on` level:

```yaml
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: stormy251/package-sus-detector-action@v1
        with:
          apify-token: ${{ secrets.APIFY_TOKEN }}
          fail-on: suspicious
```

The manual `apify-client` version is below if you want full control.

Set `failOn` and the run summary (key-value store record `SUMMARY`, and the last dataset item) gains a `gate` object and a ready-made `markdown` report:

```json
{
  "gate": {
    "failOn": "suspicious",
    "enabled": true,
    "passed": false,
    "exitCode": 1,
    "failingCount": 1,
    "failing": [{ "ecosystem": "npm", "name": "some-hallucinated-helper-pro", "version": null, "verdict": "not_found", "riskScore": 75, "reason": "verdict not_found", "summary": "Not found in the public registry. Treat as a possibly hallucinated or removed package name." }],
    "incomplete": 0,
    "complete": true,
    "notChecked": 0
  }
}
```

| `failOn` | Fails on |
| --- | --- |
| `never` (default) | nothing, report only |
| `caution` | `caution`, `suspicious` or `not_found` |
| `suspicious` | `suspicious` or `not_found` |
| `not_found` | `not_found` only (names that are not registered) |

`failOnRiskScore` (1-100) additionally fails on any package at or above that score. `gate.complete` is `false` when some packages were not checked (the `maxPackages` cap, a spending limit or an abort), so a pass never silently covers unchecked packages. Lookup errors are not charged and are counted in `gate.incomplete`. The Actor run itself always finishes as succeeded; your CI step reads `gate.exitCode` and decides.

**GitHub Actions example** (uses an Apify API token stored as the `APIFY_TOKEN` repository secret and the [`apify-client`](https://www.npmjs.com/package/apify-client) package; it checks only packages added or changed in the pull request):

```yaml
name: Package Sus Detector
on:
  pull_request:
    paths: ['package-lock.json']
jobs:
  check-new-packages:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: Check packages added or changed in this PR
        env:
          APIFY_TOKEN: ${{ secrets.APIFY_TOKEN }}
          BASE_REF: origin/${{ github.base_ref }}
        run: |
          npm install --no-save --no-audit --no-fund apify-client
          git show "$BASE_REF:package-lock.json" > /tmp/base-lock.json || echo '' > /tmp/base-lock.json
          cat > psd-check.mjs <<'EOF'
          import { readFileSync, appendFileSync } from 'node:fs';
          import { ApifyClient } from 'apify-client';
          const client = new ApifyClient({ token: process.env.APIFY_TOKEN });
          const run = await client.actor('stormy251/package-sus-detector').call(
            { lockfile: readFileSync('package-lock.json', 'utf8'), baseLockfile: readFileSync('/tmp/base-lock.json', 'utf8'), failOn: 'suspicious' },
            { maxTotalChargeUsd: 2 },
          );
          const { value: summary } = await client.keyValueStore(run.defaultKeyValueStoreId).getRecord('SUMMARY');
          console.log(summary.markdown);
          if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.markdown + '\n');
          process.exit(summary.gate.exitCode);
          EOF
          node psd-check.mjs
```

For Python projects, pass `poetry.lock`, `uv.lock` or `Pipfile.lock` the same way (or `requirementsTxt` with only the new lines). The same call works from any CI system, from Python with [`apify-client`](https://pypi.org/project/apify-client/) (`ApifyClient(token).actor(...).call(run_input=..., max_total_charge_usd=...)`), or with plain HTTP: `POST https://api.apify.com/v2/actors/stormy251~package-sus-detector/runs` with the input as the body and your token in the `Authorization: Bearer` header. Keep tokens in secrets, never in the workflow file. A pre-install hook such as `npm`'s `preinstall` can also call the Actor for a single package before it is installed.

## Use with Claude Code, Cursor and other coding agents

AI assistants sometimes invent package names that do not exist, and attackers register those names with malware (slopsquatting). Give your agent this Actor as a tool and tell it to use it.

**1. Add the Apify MCP server, limited to this Actor.** The hosted server signs you in with OAuth in a browser, so no token goes in the file:

```bash
claude mcp add --transport http package-sus-detector "https://mcp.apify.com?tools=stormy251/package-sus-detector"
```

Or, in the JSON config of Cursor and most other MCP clients:

```json
{
  "mcpServers": {
    "package-sus-detector": {
      "url": "https://mcp.apify.com?tools=stormy251/package-sus-detector"
    }
  }
}
```

Some clients need `"type": "http"` next to the `url`. The Apify CLI can also write the config for you (`apify mcp install cursor`). Runs are billed to your Apify account at $0.01 per package; you can set a spending limit per run.

**2. Add this to `AGENTS.md` (Codex, Cursor and other agents) or `CLAUDE.md` (Claude Code):**

```markdown
## Before installing any package
Before running `npm install`, `pnpm add`, `yarn add`, `pip install` or `uv add` for a package that is not already in the lockfile,
call the Package Sus Detector tool (Apify Actor stormy251/package-sus-detector) with that package name, e.g. `npm:left-pad` or `pypi:requests==2.31.0`.
- Verdict `ok`: continue.
- Verdict `caution`: tell me the reasons and proceed only if the issue is acceptable (for example a known vulnerability with a fixed version you can upgrade to).
- Verdict `suspicious` or `not_found`: do not install. Tell me the package name and the reasons and ask what to do. Never claim or publish a missing package name.
Do not install a package merely because you remember its name; check that it exists first.
```

An instruction file is what makes the agent actually call the tool; an MCP tool description alone does not force a call.

## Pricing

Pay per event: **$0.01 per package checked** (plus Apify's tiny start event). You're charged once per package result. Lookups that fail on the registry side, invalid names and the optional summary record are not charged. Set a maximum cost per run in Apify and the Actor stops cleanly when the limit is reached. A full lockfile is billed per entry (400 locked packages = $4.00), so for CI use `baseLockfile` to check only what a pull request changed.

## Data sources

Free public sources only: npm registry and download API, PyPI JSON API and pypistats, OSV.dev, deps.dev, endoflife.date. The Actor uses a descriptive User-Agent, respects rate limits and retries with backoff. Typosquat detection compares against bundled lists of the 5,000 most popular npm and PyPI packages (npm list: wooorm/npm-high-impact, MIT; PyPI list: hugovk/top-pypi-packages).

## Limits and notes

- Static signals only: the Actor does not download or execute package code.
- Install-script presence on npm is reported as a signal; contents are not analysed.
- Version ranges in `package.json` are checked at the latest release; lockfile entries are checked at their exact locked version.
- Data freshness depends on the upstream APIs; results are a snapshot at run time.
- Use programmatically through the Apify API, SDKs, integrations (Zapier, Make, GitHub Actions) or the Apify MCP server.

## Support

Found a false positive or want another ecosystem (crates.io, Go, Maven)? Open an issue on the Actor's Issues tab.
