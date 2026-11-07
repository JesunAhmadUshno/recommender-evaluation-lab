# Research review

Review date: 2026-11-07. Reviewed state: the run of record on `main`, the
D13 fresh single pass (commits b9f4c16 and 2328e3f: results/, RESULTS.md,
AUDIT.md, logs/fresh-pass-2026-11-07/), merged into `site/live-dashboard`.
This replaces an earlier review of `main` at cc1e257, written before the
fresh pass existed. The rubric is the one a PhD committee would apply to
an empirical methods study. Each criterion gets a grade and the evidence
for it; every gap that remains names the exact compute or data it needs.

Overall: about C+. Execution is now good (one clean pass, every stage,
hash-verified inputs, a test gate). The design carries one protocol-level
defect that the fresh pass exposed: the frozen Arm F training pool
(DECISIONS.md D5) is empty for every target user, so the fully observed
arm, the study's ground-truth centrepiece, gives no valid evidence about
the learned rankers. Six of the 13 frozen verdicts stand on valid
evidence; seven are void or uninformative. This agrees with the author's
own AUDIT.md grade of 5,400 of 10,000.

## Grades

| Criterion | Grade | Evidence |
|---|---|---|
| Research question | A | PREREG section 1: one main question and four sub-questions, each tied to a measurable shortcut and a known ground truth. |
| Hypotheses | A- | 13 frozen rules (H1 to H7 with sub-letters, plus S1) with SUPPORTED / NOT SUPPORTED criteria written before any test metric. H4a's rule is a recorded substitution (D2). |
| Method | C+ | Global-time split with pinned cut points, first-time test positives and a leakage audit are sound, and the random-split and leakage arms worked (H3a, H3b). But D5 trains Arm F on big-matrix events restricted to small-matrix items, and KuaiRec's two matrices are pair-disjoint (data_audit.json: 0 of 4,676,570 small pairs in the big matrix). RESULTS.md measures 0 big-matrix events by the 1,411 target users on small items, so ItemKNN, EASE and iALS score from empty histories. The defect was in the frozen design, not the run, and it was there to be found in the registration-time audit. |
| Baselines | B+ | Random and Popularity floors, ItemKNN, EASE and iALS with frozen grids and validation-only tuning (results/chosen_configs.json). SASRec and LightGCN excluded for compute reasons and logged (D4). |
| Statistics and uncertainty | B | Paired per-user bootstrap (2,000 resamples), Holm across the six pairs per arm, 10 sampling seeds, 10 exposure seeds with intervals on the tau differences. Missing: intervals on sampled-minus-exact gaps and on flip rates, and intervals on any metric other than NDCG@10 in arm_metrics.csv. |
| Reproducibility | A- | One pass in 55 minutes on a named machine (BlackBoxV3, i5-8400, 6 cores, 7.1 GiB), 23 of 23 tests before any stage, archive SHA-256 values checked against PREREG, stage logs committed, headline table regenerated and checked in CI. One wrinkle: logs/fresh-pass-2026-11-07/run.log shows the verdicts stage exiting 1 once before exiting 0 (the git environment repair AUDIT.md deducts for), while RESULTS.md says every stage exited 0 in one pass. No result changed, but the sentence should say so. |
| Threats to validity | A- | RESULTS.md opens with a validity notice that names the defect, proves it from the run bundles, lists exactly which rows and verdicts it voids, and declines to patch the frozen protocol silently. The pipeline's own outputs (verdicts.json, track GO) do not encode that distinction. |
| Related work | C | docs/related_work.md positions the study against seven primary sources and treats the MovieLens-1M reversal as a replication of Krichene and Rendle (2020). It is not a systematic review, so PREREG section 9 still bars novelty claims, and none are made. |
| Limitations | A- | Stated in PREREG section 9, RESULTS.md, AUDIT.md and on the dashboard. The ground truth covers one dataset family (KuaiRec, 2020 short video). |
| Execution against the plan | B | Every planned stage ran in one pass: Arm T on KuaiRec and MovieLens-1M, Arm F with both sensitivity arms, the exposure arm, the random split, the leakage audit and the verdicts. What the plan could not deliver is valid Arm F evidence for learned rankers, which is a design failure, graded under Method. |

## Verdicts on the run of record

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

## Fixed in this change

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

## Remaining gaps and what each needs

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

## Verdict

The study now has a real run of record and an unusually honest account of
its own failure. A committee would accept H1, H1a, H1b, H3a, H3b and H7 as
findings, read the sampled-metric results as replication, and send the
fully observed arm back: the frozen D5 pool must be redesigned, amended
in the open, and rerun before RQ1, RQ3 and RQ4 can be answered.
