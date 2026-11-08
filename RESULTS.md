# Results

Execution of record: the fresh single pass ordered in DECISIONS.md
D13, run on BlackBoxV3 (Intel i5-8400, 6 cores, 7.1 GiB RAM,
Ubuntu 26.04), Python 3.12.16, numpy 2.5.4, OMP_NUM_THREADS=6.
Pass window: 2026-11-07 02:04 to 02:59 EST (55 minutes end to end;
stage runtimes in results/tables/timings.csv and
logs/fresh-pass-2026-11-07/). All 23 unit tests passed before any
stage ran. Dataset archives were verified byte-identical against the
SHA-256 values frozen in PREREG.md before use (KuaiRec.zip
c23f211c..., ml-1m.zip a6898adb...). Every stage exited 0 in one
pass; nothing was resumed or stitched. PREREG.md was not modified;
the pre-registration commit is
cab910eb9a66651771ba77656ad7950f6b005f00, confirmed by the pipeline
itself in results/verdicts.json.

## Validity notice: Arm F learned rankers (read this first)

Verification of this pass found a protocol-level defect in Arm F,
the fully observed arm. It is a property of the frozen design
(DECISIONS.md D5), not of this execution, and the fragmented earlier
execution could not distinguish the two. The fresh pass can, and the
finding is:

- KuaiRec's two matrices are disjoint by construction. The audit
  recorded at registration already states it: zero of the 4,676,570
  small-matrix pairs appear in the big matrix.
- Measured again in this pass: big-matrix events by the 1,411 small
  users total 571,061, and the number of those events that fall on
  small-matrix items is exactly 0.
- D5 trains the Arm F rankers on big-matrix events restricted to
  small-matrix items. That restriction deletes every event the
  target users have. The training pool holds 10,272,525 events and
  652,780 positive cells, all of them from the other 5,765 users.
- Scored for the 1,411 target users, ItemKNN, EASE, and iALS each
  receive an empty history row. All three return the all-zero score
  matrix (verified directly from the run bundles: the three score
  matrices are identical, with zero nonzero entries). Their Arm F
  exact metrics (NDCG@10 0.0634 for all three) are the tie-break
  artifact of sorting zeros (top-10 = item indices 0 to 9), and
  their sampled NDCG@10 of 1.0000 is an artifact of stable sorting
  over a candidate list built positives-first.

Consequences, stated plainly:

- Every Arm F number for ItemKNN, EASE, and iALS is void as evidence
  about those rankers. Do not cite them.
- Verdicts H2a, H5, H6, H4a, H4b, and S1 are computed exactly as the
  frozen rules specify and are reproduced below as computed, but
  their evidence includes the void rows, so they are not usable as
  findings. H2b's pre-registered flip test is uninformative on
  Arm F because three of five rankers are tied artifacts.
- Arm F numbers for Random and Popularity are valid (neither uses a
  per-user history), as are all of Arm T (both datasets), the
  random-split arm, the leakage audit, and the cold-start slice.
- Fixing this requires a protocol decision (a new DECISIONS.md
  entry, and a PREREG.md amendment if the pool rule changes). It was
  not patched in this pass: PREREG.md is frozen, and a silent change
  would destroy the registration's meaning. AUDIT.md records the
  defect in its validity audit.

## Verdicts that stand on valid evidence

| Hypothesis | Verdict | Decisive evidence |
|---|---|---|
| H1 Popularity is a strong baseline | NOT SUPPORTED | Exact NDCG@10, Popularity vs Random: Arm T KuaiRec 0.00007 vs 0.00143; Arm F 0.0199 vs 0.0468. Popularity loses to Random on both KuaiRec arms. The test set holds first-time positives only, so head items the model pushes are largely already seen or never first-time relevant. |
| H1a ItemKNN beats Popularity (Arm T KuaiRec) | SUPPORTED | Paired per-user NDCG@10 difference 0.000870, one-sided 95% bootstrap lower bound 0.000618, Holm p = 0.0, n = 6,638 users. |
| H1b EASE beats ItemKNN (Arm T KuaiRec) | SUPPORTED | Difference 0.000500, lower bound 0.000139, Holm p = 0.021, n = 6,638. A real but small margin. |
| H3a Random split overstates temporal split | SUPPORTED | KuaiRec: random-split seed-mean exact NDCG@10 exceeds the temporal value for 4 of 4 non-random rankers (frozen rule needs 3). ItemKNN 0.0563 vs 0.00094 (about 60x), EASE 0.0615 vs 0.00144, iALS 0.0740 vs 0.00252, Popularity 0.00124 vs 0.00007. MovieLens-1M replication: 3 of 4 (Popularity is the exception, 0.0914 random vs 0.1534 temporal). |
| H3b Leakage audit catches a planted leak | SUPPORTED | Clean split: 87,887 test pairs, overlap 0, time order holds. Planted leak: overlap 2, time order violated, audit flags it. Full record in results/leakage_check.json. |
| H7 ItemKNN margin shrinks in the cold-start slice | SUPPORTED | Arm T KuaiRec, item-cold slice n = 6,535 users: ItemKNN minus Popularity gap 0.0000106 in the slice vs 0.000870 on the full test set. The margin nearly vanishes on cold items. |

## Verdicts as computed, not usable as findings

Computed by the frozen rules from results/verdicts.json; see the
validity notice above before quoting any of these.

| Hypothesis | As computed | Why it cannot be cited |
|---|---|---|
| H2a Sampled metrics overstate exact, order kept (Arm F) | SUPPORTED | Sampled means (1.0000 for the three learned rankers) and exact means (0.0634) are both artifacts for 3 of 5 rankers. Random and Popularity do show the overstatement (0.4872 vs 0.0468; 0.4601 vs 0.0199). |
| H2b Rank-mapping correction reduces error (Arm F) | NOT SUPPORTED | Error condition met (mean abs error 0.738 sampled vs 0.119 corrected) but the flip-pattern condition failed: no ranker pair flips in any of the 10 seeds, because three rankers are tied artifacts. The replication arms show real flip structure (for example MovieLens-1M: Popularity pairs flip in 10 of 10 sampled seeds), but the frozen rule scores Arm F only. |
| H4a IPS and SNIPS beat naive, true propensities (substituted rule, D2) | SUPPORTED | Mean Kendall tau_b difference vs naive 0.68, 95% interval 0.50 to 0.80, 10 seeds. Three of the five ranked lists are the same degenerate list, so the tau values sit on a coarse grid (identical 0.68 for IPS and SNIPS). |
| H4b SNIPS beats naive, estimated propensities | SUPPORTED | Same 0.68 difference and interval as H4a, same contamination. |
| S1 Naive bias larger for Popularity than for EASE | SUPPORTED | Mean bias difference 0.2017, interval 0.1990 to 0.2044. The EASE side of the comparison is the degenerate list. |
| H5 Naive ordering disagrees inside popularity slices | SUPPORTED | Head and torso slice orderings differ between sampled and truth. The sampled orderings are artifact-driven. |
| H6 Recommendations are head-heavy | SUPPORTED | Pooled top-decile share 0.219 vs the 0.10 null (z = 105.8, 70,550 recommendations). Three of five pooled lists are item indices 0 to 9 by construction, so the pooled share mixes a real effect (Popularity, Random) with an indexing artifact. |

Track conditions (pipeline-computed): all six hold, including
preregistration pinned at
cab910eb9a66651771ba77656ad7950f6b005f00; track verdict GO as
computed. The track check is mechanical and does not encode the
Arm F validity distinction above.

## Headline numbers (valid arms)

Full table: results/headline_table.md (generated from the committed
tables; CI checks it cannot drift).

Arm T, KuaiRec big (6,638 test users), exact NDCG@10: iALS 0.00252,
EASE 0.00144, Random 0.00143, ItemKNN 0.00094, Popularity 0.00007.
Sampled NDCG@10 overstates these by one to two orders of magnitude
(ItemKNN 0.2826 sampled vs 0.00094 exact); the rank-mapping
correction closes most of the gap (corrected mean abs error 0.0245
vs sampled 0.1321 across rankers).

Arm T, MovieLens-1M (1,188 test users), exact NDCG@10: Popularity
0.15337, ItemKNN 0.14880, EASE 0.14245, iALS 0.12869, Random
0.01297. Sampled overstatement is likewise large (EASE 0.7337
sampled vs 0.14245 exact) and the correction again closes most of
it (corrected mean abs error 0.0355 vs sampled 0.4891).

Chosen hyperparameters (validation NDCG@10, frozen grids): KuaiRec
ItemKNN k=50 shrink=0, EASE lambda=10, iALS factors=32 reg=0.1
alpha=10; MovieLens-1M ItemKNN k=100 shrink=0, EASE lambda=500,
iALS factors=64 reg=0.1 alpha=1. Full tuning tables in
results/tables/tuning_arm_t_kuairec.csv and
results/tables/tuning_arm_t_ml1m.csv.

## Reproduction

Fetch the datasets per data/README.md (checksums there and in
PREREG.md), then run, in order:
python experiments/run_all.py audit, arm_t, ml1m, arm_f, random,
verdicts. Note the verdicts stage shells out to git for the
pre-registration pin, so run it inside a real clone. Timings depend
on the machine; this pass is the BlackBoxV3 record described above.
