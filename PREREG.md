# Pre-registration

Study: Offline evaluation as the object of study. Sampled-metric bias,
temporal leakage, popularity bias, and off-policy correction, measured
against a fully observed ground truth.

Author of record: Jesun Ahmad Ushno.
Status: FROZEN. This file is committed before any evaluation metric is
computed on any test split or on the small matrix. The commit hash of this
file is the proof. Any later change to this file requires a dated
amendment section at the bottom and a note in DECISIONS.md.

The design follows Claude Research Verdict Pack 09 (Track B3) as adopted
by the programme coordinator. Where the pack's two extractions disagree,
DECISIONS.md entries D1 to D9 record which reading this registration
freezes.

## 1. Research questions

Main question: on a dataset where the true answer is known, how far do
standard offline evaluation shortcuts move the measured score and the
ranking of models, and how much of that error do the standard corrections
remove?

1. Sampled metrics. Does ranking against 100 sampled negatives keep the
   model order given by the full ranking? Does the rank-mapping
   correction help?
2. Temporal leakage. Does a random split, against a global-time split,
   change scores and model order?
3. Exposure and popularity bias. Does a naive evaluation on biased,
   partly observed logs over-rate popular-item rankers?
4. Counterfactual correction. Do IPS, SNIPS, and doubly robust (DR)
   estimates land closer to the ground truth than the naive metric, with
   known propensities and with estimated ones?

## 2. Datasets (audit measured before registration; descriptive only)

KuaiRec v2.0, Zenodo record 18164998, KuaiRec.zip SHA-256
c23f211cf109c7a060a25a4afe9e8c681b1ccbbc816cca921d87ad37dd11c70c
(MD5 matches the Zenodo record). Licence reading: DECISIONS.md D3.

- Big matrix: 12,530,806 rows, 7,176 users, 10,728 items. Matches the
  pack's evidence row E1 (audit A1 passes). Timestamps 1592872451.373 to
  1599694332.427, none missing.
- Small matrix: 4,676,570 rows, 1,411 users, 3,327 items. Matches E1.
  181,992 rows (3.9 percent) have empty time fields; their watch_ratio
  labels are present and are used, their timestamps are excluded from
  every time rule.
- Audit A2/A3: small-matrix users and items are subsets of the big
  matrix by raw id. Zero of the 4,676,570 small pairs appear in the big
  matrix (the pack's E2, confirmed by measurement). Big-matrix events on
  small items: 10,272,525.
- Audit A4 label rates: big matrix positives (watch_ratio > 2.0) 7.47
  percent of rows; at > 1.0, 33.82 percent. Small matrix: 4.64 percent
  at > 2.0; 32.39 percent at > 1.0. Users with zero positives: big 1,
  small 0.

MovieLens-1M (second dataset, replication role, DECISIONS.md D9):
ml-1m.zip SHA-256 a6898adb50b9ca05aa231689da44c217cb524e7ebd39d264c56e2832f2c54e20.
1,000,209 ratings, 6,040 users, 3,706 items with ratings. GroupLens
research terms; no redistribution; derived statistics only.

Relevance labels (frozen): KuaiRec positive if watch_ratio > 2.0 (the
project README's suggested binary like). Sensitivity run at > 1.0.
MovieLens-1M positive if rating >= 4. Users with zero positives in an
evaluation set are excluded from that set's means and counted.

## 3. Arms, splits, rankers

Arm T (logged benchmark), run on KuaiRec big and replicated on
MovieLens-1M. One global timeline per dataset. Cut points at the 80th
and 90th percentiles of event timestamps, measured by the audit and
pinned here: KuaiRec big T1 = 1598650255.457, T2 = 1598870571.464;
MovieLens-1M T1 = 975768738.0, T2 = 978133376.4. Train t < T1,
validation T1 <= t < T2, test t >= T2. Test positives are first-time
positives: positive in the test window and the (user, item) pair absent
from all training-window events. Repeat views are excluded from the
primary test set by this rule. Scores mask training positives
(DECISIONS.md D8). Leakage assertions: max(train timestamp) <
min(test timestamp) and zero test pairs in train, checked in code.

Arm F (fully observed truth), KuaiRec small matrix. Rankers train on
big-matrix events restricted to small-matrix items (DECISIONS.md D5).
Frozen rule: if at least 20 percent of that pool precedes the earliest
small-matrix timestamp (T_s = 1593800606.06), train on that prefix only
(strict rule); otherwise train on the whole pool and label the arm
time-overlapping, with a sensitivity arm trained on pool events before
the small-matrix median timestamp (1596223943.27). The audit measured
0.0035 percent before T_s, so the FALLBACK rule applies to this build.
Every ranker scores all 3,327 items for all 1,411 small users; no
masking (D8). The truth metric uses all small-matrix labels.

Random arm (leakage comparison): seeded 80/10/10 split of all events of
KuaiRec big and of MovieLens-1M, seeds 0 to 4, same rankers and the same
hyperparameters as the temporal arm of the same dataset, test positives
first-time against the random training window.

Ranker ladder: L0 Random (analytic floor), L1 Popularity (exposure count
in the training window), L2 ItemKNN (cosine, co-occurrence shrinkage),
A EASE (closed form, one L2 parameter), B iALS (implicit ALS). SASRec and
LightGCN are excluded (DECISIONS.md D4).

Tuning (frozen): validation window only, at most 20 trials per ranker.
ItemKNN: k in {50, 100}, shrink in {0, 50}. EASE: lambda in {10, 50, 100,
250, 500}. iALS: factors in {32, 64, 128} x reg in {0.1, 1.0} at
alpha = 10, plus alpha in {1, 40} at factors = 64, reg = 0.1; tuning
iterations 10. Selection metric: validation NDCG@10. Final refits use
the selected configuration; iALS final iterations 15. Arm F uses the
hyperparameters selected on the KuaiRec Arm T validation window.
Seeds: iALS model seeds 0 to 4 (final metrics averaged over seeds),
Random ranker seeds 0 to 4, negative-sampling seeds 0 to 9, exposure
seeds 0 to 9, random-split seeds 0 to 4.

## 4. Metrics and the sampled-metric correction

Exact metrics (primary): full ranking over the candidate set. NDCG@10,
Recall@10, MRR@10, HR@10, and per-user unnormalised DCG@10.

Sampled metrics: per user, the candidate set is all test positives plus
m = 100 negatives sampled uniformly without replacement from the user's
non-relevant, non-training items (Arm T) or non-relevant items (Arm F);
10 sampling seeds (DECISIONS.md D6). Sampled NDCG@10 is computed inside
the candidate set.

Correction (primary): the rank-mapping correction from the pack. With n
the full item count and m = 100, an item at sampled rank r_tilde gets
corrected rank r_hat = 1 + (r_tilde - 1) * (n - 1) / m, and the corrected
NDCG@10 is computed on the corrected ranks against the exact IDCG over
all test positives.

Beyond accuracy, per ranker and arm: catalogue coverage@10, Gini of item
exposure in top-10 lists, average recommended popularity (training
exposure), long-tail share (bottom 80 percent of items by training
exposure), and the top-1-percent / top-10-percent recommendation shares.

## 5. Off-policy study (semi-synthetic exposure, Arm F)

1. Item propensity from the Arm F training pool: n_i is item i's pool
   exposure count; p_i = max(0.01, c * (n_i / n_max) ^ gamma), gamma in
   {0 (MCAR control), 0.5, 1.0}; c set so the mean propensity equals the
   big-matrix density 0.163, computed before the floor.
2. Exposure draws O_ui ~ Bernoulli(p_i) over the full small matrix, 10
   exposure seeds per gamma. This exposure is simulated; the arm is
   semi-synthetic and every claim from it carries that label.
3. Estimand: each ranker's mean per-user DCG@10 of its Arm F top-10
   lists, truth computed from all labels.
4. Estimators, from observed cells only:
   - Naive: unobserved cells treated as negative.
   - IPS: each observed positive weighted by 1 / p_i.
   - SNIPS: (sum over users of IPS DCG) / (sum over users of W_u) *
     (sum of the ten discounts), where W_u is user u's sum of
     discount * O / p over the top-10 (DECISIONS.md D7).
   - DR: a logistic imputation model (features: log item pool exposure,
     item pool positive rate, user pool positive rate; fitted on pool
     events only) plus the IPS-weighted residual on observed cells.
5. Two propensity conditions: true p_i, and p_i estimated from the
   draw's observed exposure counts (count / 1,411, clipped to
   [0.01, 1]).
6. Reports per gamma and condition: per-ranker bias and RMSE against
   truth across seeds, and Kendall tau_b between the estimated and true
   ranker orders per seed.

## 6. Hypotheses and frozen verdict rules

All bootstrap intervals: per-user paired bootstrap, 2,000 resamples,
95 percent percentile intervals, unless a rule says the pairing is over
seeds. Holm correction is applied across the six pairwise ranker
comparisons within each arm's pairwise table; any "better" claim in the
results narrative requires the Holm-adjusted interval to exclude 0.

- H1. Popularity is a strong baseline. SUPPORTED if mean exact NDCG@10
  of Popularity exceeds that of Random on both KuaiRec arms (Arm T test
  set and Arm F truth), Random averaged over its 5 seeds.
- H1a. ItemKNN beats Popularity. SUPPORTED if the one-sided 95 percent
  bootstrap lower bound of the paired per-user NDCG@10 difference
  (ItemKNN - Popularity) on Arm T (KuaiRec) exceeds 0.
- H1b. EASE beats ItemKNN on the temporal split. SUPPORTED if the
  one-sided 95 percent bootstrap lower bound of (EASE - ItemKNN) on
  Arm T (KuaiRec) exceeds 0.
- H2a. Sampled metrics overstate exact metrics, rank order unchanged.
  SUPPORTED if, on Arm F, seed-averaged sampled NDCG@10 exceeds exact
  NDCG@10 for all five rankers and the ranker order by sampled equals
  the order by exact. Reported for the other arms as replication.
- H2b. The correction reduces measurement error. SUPPORTED if, on
  Arm F, (i) the mean absolute error to exact NDCG@10 across rankers
  and seeds is lower for corrected than for sampled, and (ii) at least
  one ranker pair is flipped by sampled NDCG in at least 8 of 10 seeds
  while the same pair is flipped by corrected NDCG in at most 2 of 10
  seeds. Otherwise NOT SUPPORTED.
- H3a. The random split overstates the temporal split. SUPPORTED if, on
  KuaiRec big, the seed-mean exact NDCG@10 under the random split
  exceeds the temporal-split NDCG@10 for at least 3 of the 4 non-random
  rankers. The MovieLens-1M count is reported as replication.
- H3b. The leakage audit catches a planted leak. SUPPORTED if the audit
  passes the clean Arm T split (zero pair overlap, time order holds)
  and flags a deliberately planted leak (a test pair copied into train
  with a post-test timestamp). Otherwise FAILS.
- H4a. With true propensities, IPS and SNIPS beat naive. SUBSTITUTED
  RULE (DECISIONS.md D2: the pack's rule text is truncated in both of
  its extractions; this rule is the pack's upgrade 5 acceptance
  criterion in H4b's frozen form). SUPPORTED if, at gamma = 1.0 with
  true propensities, the mean Kendall tau_b against truth across the 10
  exposure seeds is higher for IPS than for naive and higher for SNIPS
  than for naive, with the paired (over seeds) bootstrap 95 percent
  interval of each tau difference excluding 0.
- H4b. With estimated propensities, SNIPS still recovers ranker order
  better than naive. SUPPORTED if mean Kendall tau_b(SNIPS, truth) >
  tau_b(naive, truth) across the 10 exposure seeds at gamma = 1.0 with
  estimated propensities, paired bootstrap 95 percent interval
  excluding 0. Otherwise NOT SUPPORTED.
- H5. The naive evaluator disagrees with the truth inside popularity
  slices. SUPPORTED if, on Arm F, the ranker ordering by seed-averaged
  sampled NDCG differs from the ordering by exact NDCG in at least one
  item-popularity slice (head: top 1 percent of items by pool exposure;
  torso: next 9 percent; tail: the rest). Otherwise NOT SUPPORTED.
- H6. Recommendations are head-heavy. SUPPORTED if, pooling all five
  rankers' Arm F top-10 lists, the share of recommendations going to
  top-decile items (by pool exposure) is significantly larger than
  10 percent (one-sided binomial z test, alpha 0.05). The top-1-percent
  share is reported alongside.
- H7. The ItemKNN margin shrinks in the cold-start slice. Slice: test
  positives whose item has fewer than 5 training-window exposures
  (item-cold); user-cold (fewer than 5 training events) reported
  alongside. SUPPORTED if the ItemKNN - Popularity NDCG@10 gap on the
  slice is smaller than the gap on the full test set, on KuaiRec Arm T
  if the slice holds at least 30 evaluated users, else on MovieLens-1M.
  Otherwise NOT SUPPORTED, reported as a failure of the expectation.
- S1 (supplementary, from the rendered pack's H3). At gamma = 1.0 with
  true propensities, the naive estimator's bias (estimate - truth) for
  Popularity exceeds its bias for EASE, paired over exposure seeds,
  bootstrap 95 percent interval excluding 0.

## 7. Fault and pitfall checks

A1 to A4 data audits (section 2) are recorded in results/data_audit.json.
Leakage audit on the real split plus the planted-leak check (H3b).
Estimator unit test: on a synthetic matrix with known truth, mean IPS
over 1,000 draws lies within 3 standard errors of truth (in tests/).
Sampling unit test: simulated sampled ranks match the theoretical
expectation E[r_tilde] = 1 + m (r - 1) / (n - 1) within 3 standard
errors (in tests/). Popularity-bias report and cold-start slice as in
sections 4 and 6. The study never uses user_features_raw.csv.

## 8. Stop rules

S1 Licence. If the Zenodo record licence were neither CC BY-SA 4.0 nor
compatible, stop and re-pick the dataset. (Measured: CC BY 4.0 on the
record, CC BY-SA 4.0 inside the archive; compatible. See D3.)
S2 Audit. If counts differed from E1 by more than 0.1 percent, stop and
investigate before any modelling. (Measured: exact match.)
S3 Leakage audit failure: stop and fix the split before any result is
reported.
S4 Sampled-metric flip: report the flip and the correction; never report
the sampled metric alone.
S5 CPU budget: if a stage cannot finish honestly on this VM, the drop
order is SASRec (already excluded), then iALS, then EASE, and the drop
is logged here by amendment and in DECISIONS.md before results are
reported.

## 9. Overclaim guard

Never claim from this work: generalisation beyond KuaiRec, short video,
or 2020 data; that H4 shows IPS, SNIPS, or DR work on real logged
systems (the exposure is semi-synthetic); that watch_ratio above 2.0
measures what users like or want; that EASE or iALS is better than a
baseline without the Holm-adjusted interval excluding 0; state of the
art, production grade, or industry recommender experience; measured
societal impact (the impact statement is intended only); any novelty
claim before a literature search is done; any number without its
baseline row, n, seeds, 95 percent interval, dataset version, and
command; that the design pack's section 4.5 timings are measured (they
are template estimates; this build measures and replaces them).

## Amendments

None at registration.
