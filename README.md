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

Executed. PREREG.md is frozen in commit
cab910eb9a66651771ba77656ad7950f6b005f00. The results of record are
the fresh single pass ordered in DECISIONS.md D13, run 2026-11-07
on BlackBoxV3 (Intel i5-8400, 6 cores, 7.1 GiB RAM), Python
3.12.16, all 23 unit tests passing, dataset archives verified
against the frozen SHA-256 values. Stage logs are in
logs/fresh-pass-2026-11-07/. Full record: RESULTS.md. Self-audit
and grade (5,400 of 10,000): AUDIT.md.

## Results

Headline table: results/headline_table.md (generated from the
committed tables; CI verifies it cannot drift).

What the valid arms show:

- Random splits flatter recommenders badly. On KuaiRec, exact
  NDCG@10 under a random split exceeds the global-time split for
  all four non-random rankers, by about 60x for ItemKNN (0.0563 vs
  0.00094). The leakage audit passes the clean temporal split and
  flags a planted leak (H3a, H3b: SUPPORTED).
- Popularity is not a strong baseline here (H1: NOT SUPPORTED). On
  the first-time-positive test sets it loses to a Random ranker on
  both KuaiRec arms (Arm T 0.00007 vs 0.00143). ItemKNN and EASE do
  beat it on Arm T, by small margins with bootstrap support (H1a,
  H1b: SUPPORTED), and the ItemKNN margin nearly vanishes on
  cold-start items (H7: SUPPORTED).
- Sampled metrics (100 negatives) overstate exact NDCG@10 by one
  to two orders of magnitude on both Arm T datasets, and the
  rank-mapping correction closes most of that error. On
  MovieLens-1M the sampled ranking also reorders the rankers
  against the exact ranking.

One warning, in brief: verification of this pass proved that the
Arm F training pool in the frozen design (DECISIONS.md D5) gives
every target user an empty history, because KuaiRec's small matrix
is pair-disjoint from its big matrix (zero big events by small
users on small items). The Arm F rows for ItemKNN, EASE, and iALS
are therefore artifacts and are void as evidence; six verdicts
that rest partly on them are published as computed in RESULTS.md
with an explicit not-usable label. Read the validity notice at the
top of RESULTS.md before citing any Arm F number.

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
