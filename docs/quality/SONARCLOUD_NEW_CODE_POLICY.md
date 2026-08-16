# SonarCloud main-branch New Code policy

State: repository-side correction proposed on 2026-08-15; the SonarCloud project setting must be changed by an authenticated project administrator before Issue #90 can be closed.

## Problem confirmed

The `main` analysis at commit `53de885e8d1c5ec66357ca7b37d6ef51fe3e69b8` used `previous_version` with a start date of 2025-12-06 because `sonar.projectVersion=2.0.0` had remained static. SonarCloud therefore treated approximately eight months of accumulated history as New Code. The resulting branch gate failures (`new_coverage=58.9%` and `new_duplicated_lines_density=50.4%`) were not measurements of PR #114 or PR #119 alone.

The former security-rating failure was a real older finding and was fixed by PR #119. The current branch analysis reports an A security rating; this policy does not waive security findings.

## Policy

For this continuously deployed project, configure the SonarCloud project-level New Code Definition as:

- Type: **Number of days**
- Value: **30 days**

Do not restore a static `sonar.projectVersion` unless the repository adopts and enforces an explicit release-version lifecycle.

Quality Gate thresholds remain unchanged. In particular:

- New-code coverage remains at least 80%.
- New-code duplicated-line density remains at most 3%.
- Security, reliability, and maintainability ratings are not relaxed.

## Duplication scope

`sql/migrations/**` and `sql/baseline/**` are immutable historical artifacts. Baseline files intentionally preserve complete schema and reference-data snapshots, so cross-snapshot repetition is expected and must not be refactored away.

They remain in `sonar.sources` and continue to be analyzed for bugs, vulnerabilities, security hotspots, and maintainability. Only copy/paste detection is excluded for these paths. No production source is excluded from coverage or general analysis by this correction.

## Verification after merge

1. An authenticated SonarCloud project administrator sets New Code to **Number of days: 30**.
2. Run a fresh analysis of `main`.
3. Confirm the analysis period is a rolling 30-day window rather than `previous_version` starting 2025-12-06.
4. Confirm the diagnostics artifact contains file-level coverage and duplication hotspots for a `push` event, not only for pull requests.
5. Treat any remaining gate failure inside the valid 30-day window as real quality debt; do not lower thresholds or add blanket exclusions.
