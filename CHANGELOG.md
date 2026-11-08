# Changelog

All notable changes to this project. Format: Keep a Changelog 1.1.
Versions follow Semantic Versioning; no release is tagged yet.

## [Unreleased]

### Changed
- 2026-11-08: Adopted the portfolio standard v2. README opens with the
  question, headline (with its interval), field, job family and
  verdict (Functional). REPORT.md is the report; the 2026-11-07
  research review moved into it, and the self-audit grade left the
  public repo (grades are internal), from AUDIT.md, README.md and the
  dashboard. The lock is tagged proposal-v1 on cab910e, and a test
  fails if PREREG.md changes by one byte. CI gains read-only token
  permissions and a dashboard build; CodeQL and Dependabot added; main
  protected. pyproject version set to 0.1.0, since no release exists.

### Added
- 2026-11-07: Research review of the run of record (now in REPORT.md);
  dashboard reads the D13 run and marks the void Arm F verdicts;
  DECISIONS.md D15.
- 2026-11-07: Run of record, the D13 fresh single pass on BlackBoxV3:
  results/, logs/fresh-pass-2026-11-07/, RESULTS.md, AUDIT.md. Found
  the Arm F empty-history defect in the locked design.
- 2026-11-07: Live dashboard in site/ and its Pages workflow; generated
  headline table checked in CI; related-work note.
- 2026-11-07: Implementation hardening and the fresh-restart decision
  (DECISIONS.md D10 to D14).
- 2026-11-07: Loaders, splits, ranker ladder, metrics, off-policy
  estimators, audits, pipeline, tests, CI.
- 2026-11-07: Pre-registration (cab910e), before any code or metric.
