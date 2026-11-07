# Recommender Evaluation Lab

Author: Jesun Ahmad Ushno.

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
cab910eb9a66651771ba77656ad7950f6b005f00.
No results exist yet at this commit.

## Layout

- `PREREG.md` - the frozen design: hypotheses, verdict rules, splits,
  seeds, stop rules, overclaim guard.
- `DECISIONS.md` - every judgement call the build made, recorded openly.
- `data/README.md` - dataset sources, versions, checksums, licences.
  Raw data is fetched, never committed.
- `src/` - split, rankers, metrics, correction, audit, stats.
- `experiments/` - the audit and the full pipeline (`run_all.sh`).
- `results/` - derived statistics only (DATA_LICENSE.md applies).
- `RESULTS.md` - the published verdict, written from the derived data.
- `AUDIT.md` - the self-audit and grade.
- `paper/` - a short workshop-format write-up.

## Licences

Code: Apache-2.0 (LICENSE). Derived data under results/: CC BY-SA 4.0
(DATA_LICENSE.md), inherited from KuaiRec. MovieLens-1M figures are
statistics only, under the GroupLens terms.
