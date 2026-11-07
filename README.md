# Recommender Evaluation Lab

Author: Jesun Ahmad Ushno.

**Live dashboard:** [jesunahmadushno.github.io/recommender-evaluation-lab](https://jesunahmadushno.github.io/recommender-evaluation-lab/), with the study status, every frozen hypothesis, the recorded MovieLens-1M replication arm, and two simulators that run in your browser (sampled-rank correction, synthetic off-policy estimators). Source in `site/`; every number is read from `results/` and the study markdown at build time.

Offline recommender evaluation, treated as the research object. On a
fully observed public dataset (KuaiRec), this study measures how far the
standard offline shortcuts move the answer: sampled metrics against 100
negatives, random splits against a global-time split, and naive
evaluation on biased logs against IPS, SNIPS, and doubly robust
correction. Every estimator is scored against a known ground truth.
MovieLens-1M replicates the split and sampling comparisons.

The transferable asset is experimentation craft: a pre-registered
design, a leakage audit, estimator bias measured against truth, and
honest intervals. This is not a claim of production recommender
experience, and the repo's overclaim guard (PREREG.md section 9) binds
every statement in it.

## Status

Pre-registered. PREREG.md is frozen in commit
cab910eb9a66651771ba77656ad7950f6b005f00. The run is partial.

- Recorded: MovieLens-1M Arm T (replication arm): exact metrics,
  pairwise Holm table, sampled and corrected metrics over 10 seeds,
  popularity report, cold-start slices, tuning grid
  (`results/headline_table.md` is generated from these).
- Tuning only: KuaiRec big Arm T. The grid comes from the resumed run that
  D13 supersedes.
- Not yet run: Arm F (fully observed truth), the semi-synthetic exposure
  arm, the random-split arm, the planted-leak check, and the verdicts. None
  of the frozen hypotheses H1 to H7 or S1 can be evaluated yet.
- Every committed table predates the D13 fresh pass and is provisional
  (DECISIONS.md D14).

## Layout

- `PREREG.md` - the frozen design: hypotheses, verdict rules, splits,
  seeds, stop rules, overclaim guard.
- `DECISIONS.md` - every judgement call the build made, recorded openly.
- `data/README.md` - dataset sources, versions, checksums, licences.
  Raw data is fetched, never committed.
- `src/` - split, rankers, metrics, correction, audit, stats.
- `experiments/` - the audit and the full pipeline (`run_all.sh`).
- `results/` - derived statistics only (DATA_LICENSE.md applies).
- `site/` - the live dashboard (React + Vite); `npm run build` first runs
  a known-answer check of its in-browser ports against the repo's tests
  and committed results.
- `docs/research-review.md` - a graded research-rigor review with the
  remaining gaps and the compute each one needs.
- `docs/related_work.md` - primary sources and the adjusted novelty claim.
- Planned, not present yet: `RESULTS.md` (the published verdict),
  `AUDIT.md` (the self-audit and grade) and `paper/` (a short
  workshop-format write-up). They follow the fresh pass.

## Licences

Code: Apache-2.0 (LICENSE). Derived data under results/: CC BY-SA 4.0
(DATA_LICENSE.md), inherited from KuaiRec. MovieLens-1M figures are
statistics only, under the GroupLens terms.
