# Contributing & reporting false positives

Package Sus Detector produces **risk signals, not accusations**. If a signal is wrong, that is the most useful bug report you can send.

## Reporting a false positive or false negative

Open a GitHub issue with:

1. The package and version (`npm:name@version` or `pypi:name==version`).
2. The verdict and `riskScore` you got, and the `reasons[].code` values that fired.
3. Why you think the verdict is wrong (for example: "this is a legitimate small package by the original author").
4. Optionally, the item JSON from the run (the Actor only reads public registry data; please still remove anything private).

Please do not post private package names or proprietary manifests in public issues.

## Feature requests

New ecosystems (crates.io, Go, Maven), new signals, and threshold changes are welcome as issues. Please say what you would use it for.

## Code changes

- Node.js >= 20. `npm install`, then `npm test` (uses the built-in `node --test` runner).
- Keep the Actor static-analysis only: it must not download or execute package code.
- Respect upstream rate limits (see `src/http.js`) and keep the descriptive User-Agent.
- Add a test for any new scoring rule in `test/`.
- Small focused pull requests are easiest to review.

## Security issues in the Actor itself

Please open a private GitHub security advisory on this repository rather than a public issue.
