# Research review

Review date: 2026-11-07. Reviewed state: branch `site/live-dashboard`, built
on `main` at cc1e257. The rubric is the one a PhD committee would apply to an
empirical methods study. Each criterion gets a grade, the evidence for it,
what this change fixed, and, for every gap that remains, the exact compute
or data it needs.

Overall: design A-, execution D, overall about C+. The design is unusually
strong for a portfolio study. The execution has produced one replication
arm and no evidence on any frozen hypothesis.

## Grades

| Criterion | Grade | Evidence |
|---|---|---|
| Research question | A | PREREG section 1: one main question and four sub-questions, each tied to a measurable shortcut and a known ground truth. |
| Hypotheses | A- | 13 frozen rules (H1 to H7 with sub-letters, plus S1) with SUPPORTED / NOT SUPPORTED criteria written before any test metric. H4a's rule is a recorded substitution (D2), not a free choice. |
| Method | A- | Global-time split with pinned cut points, first-time test positives, leakage assertions in code, a fully observed truth arm (Arm F) with a frozen fallback rule, and a semi-synthetic exposure arm labelled as such. |
| Baselines | B+ | Random and Popularity floors, ItemKNN, EASE and iALS with frozen grids and validation-only tuning. SASRec and LightGCN are excluded for compute reasons and logged (D4). |
| Statistics and uncertainty | B | Paired per-user bootstrap (2,000 resamples) and Holm across the six pairwise comparisons. Missing: intervals on the sampled-minus-exact gaps and on flip rates, and on any metric other than NDCG@10 in arm_metrics.csv. |
| Reproducibility | B- | Checksummed data, seeds, resumable stages, a CI check that regenerates the headline table. But the committed tables come from a fragmented run that D13 supersedes, timings.csv names no machine, and CI on main was red until this change. |
| Threats to validity | B+ | PREREG section 9 overclaim guard, D1 to D13 decision log, explicit semi-synthetic labelling. The degenerate item-cold slice was unexplained until this change. |
| Related work | D before, C after | No literature positioning existed; PREREG section 9 barred novelty claims until one was done. docs/related_work.md now positions the study against seven primary sources. It is not a systematic review. |
| Limitations | B | Stated in PREREG section 9 and now on the dashboard; README promised RESULTS.md, AUDIT.md and paper/ that do not exist. |
| Execution against the plan | D | Of the planned arms only MovieLens-1M Arm T has test output. 0 of 13 frozen rules can be evaluated. |

## Fixed in this change

1. CI on main was red because `scripts/reproduce_headline.py --check` found
   `results/tables/arm_metrics.csv` without `results/headline_table.md`.
   The table is a pure function of the committed CSVs; it is now generated
   and committed, and `--check` passes.
2. README Status said "No results exist yet". It now states what is
   recorded, what is tuning-only, and what has not run, and marks
   RESULTS.md, AUDIT.md and paper/ as planned rather than present.
3. Provisional status: DECISIONS.md D14 records that every committed table
   predates the D13 fresh pass, and names the two known gaps in timings.csv.
   The dashboard labels every recorded table the same way.
4. Related work: docs/related_work.md, with an adjusted novelty claim.
   The MovieLens-1M reversal is presented as a replication of Krichene and
   Rendle (2020), not as a finding. PREREG section 9 requires a literature
   search only before a novelty claim; the study now makes none beyond the
   bounded wording in that file, so no further search is needed for the
   claims it makes today.
5. Item-cold slice: the dashboard and the limits section state that all five
   rankers score exactly 0 on the 115-user item-cold slice and why that makes
   the slice unable to rank models, instead of leaving the zeros unexplained.
6. A known-answer check (`site/src/stats.check.mjs`, run by `npm run build`)
   asserts that the browser ports match the repo: E[r_tilde] = 9.99 at
   r = 300, n = 3,327, m = 100 (tests/test_metrics.py), the Holm recompute
   equals the committed p_holm column, make_propensities at gamma = 0 is
   uniform 0.163, IPS is unbiased and naive biased low on a synthetic matrix
   (tests/test_correction.py), and the seed means reproduce
   results/headline_table.md.
7. A descriptive reading of the only recorded arm, with its limits: on
   MovieLens-1M, sampled NDCG@10 orders EASE > iALS > ItemKNN > Popularity in
   all 10 seeds, exact NDCG@10 orders Popularity > ItemKNN > EASE > iALS, and
   5 of 6 non-random pairs flip in all 10 seeds. Under Holm only the three
   gaps to iALS exclude 0. The correction keeps the sampled order. This
   is shown on the dashboard with the flip counts computed from
   sampled_metrics.csv.

## Remaining gaps and what each needs

None of these can be closed without running the pipeline. The work rules
for this change exclude any single command over about five minutes, and
D13 names BlackBoxV3 as the machine of record, so they are left for the
fresh pass.

| Gap | Blocks | What it needs |
|---|---|---|
| KuaiRec big Arm T test metrics, pairwise table, sampled metrics, cold-start slice | H1, H1a, H1b, H7 | The 430 MB KuaiRec.zip (checksum in data/README.md) and `experiments/run_all.sh arm_t` on BlackBoxV3 (i5-8400, 6 cores, 7.1 GiB, per D13). Multi-hour CPU: the resumed run's KuaiRec tuning fits alone took up to about 920 s each (tuning_arm_t_kuairec.csv, fit_seconds). |
| Arm F truth metrics, sampled metrics, popularity report and slices | H1, H2a, H2b, H5, H6 | `run_all.sh arm_f` on BlackBoxV3 after Arm T, using the KuaiRec chosen configs. CPU only. |
| Semi-synthetic exposure arm (exposure_estimates.csv, exposure_tau.csv) | H4a, H4b, S1 | Part of the Arm F stage: 3 gamma values x 10 exposure seeds x 2 propensity conditions over the 1,411 x 3,327 matrix. CPU only. |
| Random-split arm (random_split.csv) | H3a | `run_all.sh random`: 5 seeds x 5 rankers on KuaiRec big and MovieLens-1M. Multi-hour CPU. |
| Leakage check with planted leak (leakage_check.json) | H3b | Written at the end of the KuaiRec Arm T stage. |
| Verdicts (verdicts.json) | every rule | `run_all.sh verdicts` once the tables above exist; seconds. |
| Bootstrap intervals on sampled-minus-exact gaps and on flip rates | the strength of any H2 statement | Per-user sampled and exact arrays, which live in the gitignored results/bundles/ and are not committed. Needs the fresh pass to keep them, plus a small addition to the pipeline. Under PREREG this is an exploratory addition and must be labelled so. |
| Machine name and the missing ML-1M iALS score_test row in timings.csv | D13 compliance | The fresh pass writes timings on BlackBoxV3; hand-editing the current table would invent a measurement. |
| RESULTS.md, AUDIT.md, paper/ | publication | Written from the fresh-pass tables and verdicts. |

## Verdict

The study is well designed and honestly logged, and the one arm that ran
already shows the effect it was built to measure, as replication. The
committee would not pass it as a result until the fresh pass produces Arm F
and the exposure arm and `run_all.sh verdicts` decides the frozen rules.
