# Report

The study report in the portfolio standard's sense: background,
method, results against the locked PREREG.md, misses, threats and
conclusion. It summarises; the detailed record of the run stays where
the locked design and the run put it: RESULTS.md (verdict tables and
headline numbers, parsed by the dashboard), AUDIT.md (execution,
claim, validity, security, cost and licence audits), DECISIONS.md
(every judgement call) and results/ (the derived evidence).

## Background

Offline recommender evaluation, treated as the research object. On a
fully observed public dataset (KuaiRec), this study measures how far
the standard offline shortcuts move the answer: sampled metrics against
100 negatives, random splits against a global-time split, and naive
evaluation on biased logs against IPS, SNIPS, and doubly robust
correction. Every estimator is scored against a known ground truth.
MovieLens-1M replicates the split and sampling comparisons.

The transferable asset is experimentation craft: a pre-registered
design, a leakage audit, estimator bias measured against truth, and
honest intervals. This is not a claim of production recommender
experience, and the repo's overclaim guard (PREREG.md section 9) binds
every statement in it. Prior work: docs/related_work.md.

## Method

The design is PREREG.md, committed in
cab910eb9a66651771ba77656ad7950f6b005f00 before any code or metric
existed (tag proposal-v1; tests/test_layout.py fails if one byte of
PREREG.md changes). Arms, splits, rankers, tuning grids, seeds, the
sampled-metric correction, the semi-synthetic off-policy study and the
13 verdict rules are in its sections 3 to 6. DECISIONS.md D1 to D9
record the readings frozen with it; D10 to D15 record implementation
and execution decisions taken after it.

Run of record: the fresh single pass ordered in DECISIONS.md D13, run
2026-11-07 on BlackBoxV3 (Intel i5-8400, 6 cores, 7.1 GiB RAM),
Python 3.12.16, all 23 unit tests passing first, dataset archives
verified against the frozen SHA-256 values. Stage logs are in
logs/fresh-pass-2026-11-07/; full record in RESULTS.md and AUDIT.md.
One correction to the record: run.log shows the verdicts stage exited 1
once (the machine had no git) and 0 on the second attempt, after an
environment-only repair. AUDIT.md records this; RESULTS.md's sentence
"every stage exited 0 in one pass" does not. No result changed.

## Results

Headline numbers are regenerated from the committed tables:
results/headline_table.md by `python scripts/reproduce_headline.py
--check` (run in CI), the intervals from
results/tables/arm_metrics.csv (95 percent per-user bootstrap, 2,000
resamples) and the random-split seed ranges from
results/tables/random_split.csv (seeds 0 to 4).

What the valid arms show:

- Random splits flatter recommenders badly. On KuaiRec, exact NDCG@10
  under a random split exceeds the global-time split for all four
  non-random rankers. ItemKNN: 0.0563 random (5 seeds, range 0.0548
  to 0.0575) against 0.00094 temporal (95 percent interval 0.00064 to
  0.00125), about 60x. The leakage audit passes the clean temporal
  split and flags a planted leak (H3a, H3b: SUPPORTED).
- Popularity is not a strong baseline here (H1: NOT SUPPORTED). On the
  first-time-positive test sets it loses to a Random ranker on both
  KuaiRec arms (Arm T 0.00007 vs 0.00143). ItemKNN and EASE do beat it
  on Arm T, by small margins with bootstrap support (H1a, H1b:
  SUPPORTED), and the ItemKNN margin nearly vanishes on cold-start
  items (H7: SUPPORTED).
- Sampled metrics (100 negatives) overstate exact NDCG@10 by one to two
  orders of magnitude on both Arm T datasets, and the rank-mapping
  correction closes most of that error. On MovieLens-1M the sampled
  ranking also reorders the rankers. This is descriptive replication:
  the locked H2a and H2b are decided on Arm F.

### Every hypothesis, scored

| Hypothesis | Verdict as computed | Usable as a finding |
| --- | --- | --- |
| H1 Popularity is a strong baseline | NOT SUPPORTED (a miss for the expectation) | Yes |
| H1a ItemKNN beats Popularity | SUPPORTED | Yes |
| H1b EASE beats ItemKNN | SUPPORTED | Yes |
| H2a Sampled overstates exact, order kept | SUPPORTED | No: Arm F learned-ranker rows void |
| H2b The correction reduces error | NOT SUPPORTED | No: flip test uninformative under the tie artifact |
| H3a Random split overstates temporal | SUPPORTED | Yes |
| H3b Leakage audit catches a planted leak | SUPPORTED | Yes |
| H4a IPS and SNIPS beat naive, true propensities | SUPPORTED | No: Arm F learned-ranker rows void |
| H4b SNIPS beats naive, estimated propensities | SUPPORTED | No: Arm F learned-ranker rows void |
| H5 Naive ordering disagrees inside slices | SUPPORTED | No: Arm F learned-ranker rows void |
| H6 Recommendations are head-heavy | SUPPORTED | No: Arm F learned-ranker rows void |
| H7 ItemKNN margin shrinks on cold items | SUPPORTED | Yes |
| S1 Naive bias larger for Popularity than EASE | SUPPORTED | No: Arm F learned-ranker rows void |

Evidence for every row: RESULTS.md's two verdict tables, which the
dashboard build checks against results/verdicts.json.

## Misses

- The study's central arm failed. The locked Arm F training pool
  (DECISIONS.md D5: big-matrix events restricted to small-matrix items)
  holds zero events by the 1,411 target users, because KuaiRec's two
  matrices are pair-disjoint. ItemKNN, EASE and iALS score from empty
  histories and return all-zero scores; their Arm F rows are tie-break
  artifacts. Seven of 13 verdicts (H2a, H2b, H4a, H4b, H5, H6, S1) are
  therefore not usable, and RQ1, RQ3 and RQ4 are unanswered as stated.
  Full proof: RESULTS.md validity notice and AUDIT.md validity audit.
- H1 failed its expectation: Popularity lost to Random on both KuaiRec
  arms.
- The pipeline's own outputs (verdicts.json, the track GO) do not encode
  the validity split; it lives in RESULTS.md, AUDIT.md and the
  dashboard build check.
- H2b's error condition held on Arm F (mean absolute error 0.738
  sampled vs 0.119 corrected), but under the tie artifact that
  reduction cannot be cleanly attributed to the correction.

## Threats to validity

- One dataset family for the ground truth (KuaiRec, 2020 short video);
  the overclaim guard bars generalisation and it is untested here.
- One pass on one machine; nothing has been rerun independently.
- No bootstrap interval on the sampled-minus-exact gaps or the flip
  rates; arm_metrics.csv carries an interval for NDCG@10 only.
- No systematic literature search; docs/related_work.md is a short
  positioning note, so no novelty claim is made.
- The off-policy arm is semi-synthetic (simulated exposure) by design.

## Field profile (ML and AI research), checked

| Item | Status |
| --- | --- |
| Baselines a reviewer would expect, same budget | Met: Random and Popularity floors, ItemKNN, EASE, iALS on frozen grids; SASRec and LightGCN excluded and logged (D4) |
| Ablations, one part at a time | Not met: label and pool sensitivity arms exist, but no component ablation |
| Uncertainty on every headline number | Partly: NDCG@10 intervals and seed ranges yes; sampled-minus-exact gaps and flip rates no |
| Compute, data and versions recorded | Met: machine, toolchain, archive hashes, timings |

The profile is not met, and seven verdicts rest on void evidence, so the
verdict is Functional, not Evaluated.

## Conclusion

Six of the 13 locked verdicts stand on valid evidence: random splits
inflate KuaiRec NDCG@10 by up to about 60x over a global-time split,
the leakage audit works, Popularity is not a strong baseline on
first-time positives, and ItemKNN and EASE beat it by small margins
that shrink on cold items. The fully observed arm must be redesigned
by a dated PREREG.md amendment and rerun before the sampled-metric and
off-policy questions can be answered against the truth; the amended
verdicts will be post-registration and labelled so.

## Review (2026-11-07)

Moved here from docs/research-review.md in the standard v2 migration
(per-criterion grades removed; grades are internal). Reviewed state:
the run of record on main, the D13 fresh single pass (commits b9f4c16
and 2328e3f). It cross-checked the verdicts against verdicts.json; it
is not yet the independent re-derivation of every headline number that
the standard's Review stage requires.

| Criterion | Evidence |
| --- | --- |
| Research question | PREREG section 1: one main question and four sub-questions, each tied to a measurable shortcut and a known ground truth. |
| Hypotheses | 13 frozen rules (H1 to H7 with sub-letters, plus S1) with SUPPORTED / NOT SUPPORTED criteria written before any test metric. H4a's rule is a recorded substitution (D2). |
| Method | Global-time split with pinned cut points, first-time test positives and a leakage audit are sound, and the random-split and leakage arms worked (H3a, H3b). But D5 trains Arm F on big-matrix events restricted to small-matrix items, and KuaiRec's two matrices are pair-disjoint (data_audit.json: 0 of 4,676,570 small pairs in the big matrix). RESULTS.md measures 0 big-matrix events by the 1,411 target users on small items, so ItemKNN, EASE and iALS score from empty histories. The defect was in the frozen design, not the run, and it was there to be found in the registration-time audit. |
| Baselines | Random and Popularity floors, ItemKNN, EASE and iALS with frozen grids and validation-only tuning (results/chosen_configs.json). SASRec and LightGCN excluded for compute reasons and logged (D4). |
| Statistics and uncertainty | Paired per-user bootstrap (2,000 resamples), Holm across the six pairs per arm, 10 sampling seeds, 10 exposure seeds with intervals on the tau differences. Missing: intervals on sampled-minus-exact gaps and on flip rates, and intervals on any metric other than NDCG@10 in arm_metrics.csv. |
| Reproducibility | One pass in 55 minutes on a named machine (BlackBoxV3, i5-8400, 6 cores, 7.1 GiB), 23 of 23 tests before any stage, archive SHA-256 values checked against PREREG, stage logs committed, headline table regenerated and checked in CI. One wrinkle: logs/fresh-pass-2026-11-07/run.log shows the verdicts stage exiting 1 once before exiting 0 (the git environment repair AUDIT.md records), while RESULTS.md says every stage exited 0 in one pass. No result changed, but the sentence should say so. |
| Threats to validity | RESULTS.md opens with a validity notice that names the defect, proves it from the run bundles, lists exactly which rows and verdicts it voids, and declines to patch the frozen protocol silently. The pipeline's own outputs (verdicts.json, track GO) do not encode that distinction. |
| Related work | docs/related_work.md positions the study against seven primary sources and treats the MovieLens-1M reversal as a replication of Krichene and Rendle (2020). It is not a systematic review, so PREREG section 9 still bars novelty claims, and none are made. |
| Limitations | Stated in PREREG section 9, RESULTS.md, AUDIT.md and on the dashboard. The ground truth covers one dataset family (KuaiRec, 2020 short video). |
| Execution against the plan | Every planned stage ran in one pass: Arm T on KuaiRec and MovieLens-1M, Arm F with both sensitivity arms, the exposure arm, the random split, the leakage audit and the verdicts. What the plan could not deliver is valid Arm F evidence for learned rankers, which is a design failure, covered under Method. |

### Verdicts on the run of record

From RESULTS.md, cross-checked against results/verdicts.json by the
dashboard build (`site/src/stats.check.mjs`, check 8).

- Stand on valid evidence (6): H1 NOT SUPPORTED, H1a SUPPORTED,
  H1b SUPPORTED, H3a SUPPORTED, H3b SUPPORTED, H7 SUPPORTED.
- Computed but not usable (7): H2a, H2b, H4a, H4b, H5, H6, S1. Each rests
  partly on the void Arm F learned-ranker rows; H2b's flip test is
  uninformative because three rankers tie.

The strongest valid finding is H3a: on KuaiRec, random-split exact
NDCG@10 exceeds the temporal value for 4 of 4 non-random rankers, by about
60x for ItemKNN (0.0563 vs 0.00094). The sampled-metric question (RQ on
sampled vs exact) is answered only descriptively, on the two Arm T
replication arms, where sampled NDCG@10 overstates exact by one to two
orders of magnitude and, on MovieLens-1M, reorders the rankers.

### Fixed in this change

1. The dashboard and README were written before the fresh pass and said
   Arm F, the exposure arm, the random split and the verdicts had not
   run. Merged `main`; the README keeps main's Executed status and
   results, and the dashboard now reads verdicts.json and RESULTS.md, so
   each hypothesis card shows its computed verdict and whether it stands
   or is void.
2. DECISIONS.md D15 records that the fresh pass supersedes D14, the note
   that called the earlier tables provisional.
3. The validity split is now machine-checked in one place. The pipeline's
   verdicts.json does not encode it, so the dashboard build asserts that
   RESULTS.md's two verdict tables cover all 13 hypotheses once and quote
   the same verdicts as verdicts.json (check 8). It also asserts the
   defect's signature in the committed tables: on Arm F the three learned
   rankers have identical rows in arm_metrics.csv,
   arm_f_pool_sensitivity.csv and arm_f_label_sensitivity.csv (check 9).
   Both sensitivity arms carry the same defect.
4. The README listed `paper/` as present; it is not in the repo, and it
   is now marked as planned.
5. Earlier fixes still hold: CI's headline check passes against the
   regenerated table, docs/related_work.md exists, and the item-cold
   slice's all-zero scores are explained on the dashboard.

### Fixed in the 2026-11-07 review change

1. The dashboard and README were written before the fresh pass and said
   Arm F, the exposure arm, the random split and the verdicts had not
   run. Merged `main`; the README keeps main's Executed status and
   results, and the dashboard now reads verdicts.json and RESULTS.md, so
   each hypothesis card shows its computed verdict and whether it stands
   or is void.
2. DECISIONS.md D15 records that the fresh pass supersedes D14, the note
   that called the earlier tables provisional.
3. The validity split is now machine-checked in one place. The pipeline's
   verdicts.json does not encode it, so the dashboard build asserts that
   RESULTS.md's two verdict tables cover all 13 hypotheses once and quote
   the same verdicts as verdicts.json (check 8). It also asserts the
   defect's signature in the committed tables: on Arm F the three learned
   rankers have identical rows in arm_metrics.csv,
   arm_f_pool_sensitivity.csv and arm_f_label_sensitivity.csv (check 9).
   Both sensitivity arms carry the same defect.
4. The README listed `paper/` as present; it is not in the repo, and it
   is now marked as planned.
5. Earlier fixes still hold: CI's headline check passes against the
   regenerated table, docs/related_work.md exists, and the item-cold
   slice's all-zero scores are explained on the dashboard.

### Remaining gaps and what each needs

None of these can be closed under this change's rules (no command over
about five minutes, no protocol change without the Owner).

| Gap | Blocks | What it needs |
|---|---|---|
| Arm F pool defect | H2a, H2b, H4a, H4b, H5, H6, S1, and RQ1, RQ3, RQ4 as stated | An Owner decision first: a new DECISIONS.md entry and a PREREG.md amendment naming a pool that contains the target users' own history (for example, the 1,411 users' big-matrix events on all items, mapped into the small-matrix item space only at scoring). Then `python experiments/run_all.py arm_f` and `verdicts` on BlackBoxV3: the Arm F stage took about 2 minutes and verdicts seconds in the D13 pass (run.log), so CPU only, minutes. The amended verdicts must be reported as post-registration. |
| The pipeline does not flag empty training histories | trust in verdicts.json and the track GO | A guard in experiments/run_all.py that counts target users with zero training events and writes the count into verdicts.json, plus one unit test. Seconds of compute; needs a DECISIONS.md entry since it changes a pipeline output. |
| Bootstrap intervals on sampled-minus-exact gaps and on flip rates | the strength of any sampled-metric statement | Per-user sampled and exact arrays, which live only in the gitignored results/bundles/. Rerun `arm_t` (about 12 minutes) and `ml1m` (about 3 minutes) on BlackBoxV3 with the bundles kept, plus a small exploratory addition to the stats; label it exploratory under PREREG. |
| Intervals on Recall, MRR and HR | leaderboard comparisons beyond NDCG@10 | The same bundles and the existing bootstrap in src/stats.py applied per metric; minutes of CPU after the rerun above. |
| Independent replication of the pass | reproducibility beyond one machine | One full pass (`audit`, `arm_t`, `ml1m`, `arm_f`, `random`, `verdicts`) on a second machine; 55 minutes on BlackBoxV3, plus the two dataset archives (KuaiRec.zip, ml-1m.zip, checksums in data/README.md). |
| A second fully observed or randomized ground truth | generality beyond KuaiRec | A dataset with a missing-at-random test set, for example Yahoo! R3 or Coat, its licence checked, and a PREREG amendment adding the arm. Data access plus an Arm F-sized CPU run. |
| Literature search | any novelty claim | A documented search (venues, years, query terms) extending docs/related_work.md; reading time, no compute. Until then the overclaim guard stands. |
| RESULTS.md wording on the verdicts stage | accuracy of the record | One sentence noting the first verdicts attempt exited 1 before the environment repair. A text edit, but RESULTS.md is the author's record of the pass, so it is left to the Owner. |

### Review conclusion

The study now has a real run of record and an unusually honest account of
its own failure. A committee would accept H1, H1a, H1b, H3a, H3b and H7 as
findings, read the sampled-metric results as replication, and send the
fully observed arm back: the frozen D5 pool must be redesigned, amended
in the open, and rerun before RQ1, RQ3 and RQ4 can be answered.
