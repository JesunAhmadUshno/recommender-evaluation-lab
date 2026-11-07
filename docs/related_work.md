# Related work: offline recommender evaluation

Purpose: place the study's four questions (sampled metrics, temporal leakage,
exposure bias, off-policy correction) against the primary sources that
already answer parts of them, and state what that does to any novelty claim.
Search date: 2026-11-07. Sources were found by title and topic search in a
scholarly index and read at abstract level only. This is a short positioning
note, not a systematic review, so PREREG.md section 9 still bars novelty
claims.

## Sampled metrics (RQ1, H2a, H2b)

1. Krichene, W., and Rendle, S. (2020). On Sampled Metrics for Item
   Recommendation. KDD 2020.
   - Shows that sampled metrics are inconsistent with their exact versions:
     they need not preserve "A is better than B", not even in expectation,
     and with very few samples all metrics collapse towards AUC. Proposes
     corrections fitted to minimise bias or mean squared error.
   - Effect on this study: the MovieLens-1M reversal recorded in
     results/headline_table.md is a replication of a known phenomenon, not a
     discovery. The repo's correction is the simpler linear rank mapping
     r_hat = 1 + (r_tilde - 1)(n - 1)/m, not the bias- or MSE-minimising
     corrections of this paper, so any comparison with that paper must say so.
2. Cañamares, R., and Castells, P. (2020). On Target Item Sampling in
   Offline Recommender System Evaluation. RecSys 2020.
   - Finds that comparisons on reduced target sets often contradict those on
     large target sets, and compares against unbiased evaluation.
   - Effect: a second precedent for order flips under sampling.
3. Li, D., and others (2023). On Item-Sampling Evaluation for Recommender
   System. ACM Transactions on Recommender Systems.
   - Reports an approximately linear relation between sampled and global
     top-K recall and proposes estimators of the global rank distribution.
   - Effect: the linear rank mapping used here has close relatives; the
     study should not present it as new.
4. Liu, Y., and others (2023). On the Consistency, Discriminative Power and
   Robustness of Sampled Metrics in Offline Top-N Recommender System
   Evaluation. RecSys 2023.
   - A benchmark over 52 algorithms showing that the right sampling settings
     depend on the dataset and the goal.

## Temporal leakage (RQ2, H3a, H3b)

5. Ji, Y., Sun, A., Zhang, J., and Li, C. (2020/2023). A Critical Study on
   Data Leakage in Recommender System Offline Evaluation. ACM Transactions
   on Information Systems.
   - Splits that ignore the global timeline let models learn from future
     interactions, and relative model order becomes unpredictable as the
     amount of leaked data changes. Proposes a timeline scheme.
   - Effect: the frozen global-time split follows this line of work; H3a
     tests a known effect on a new dataset pairing.

## Exposure bias and off-policy correction (RQ3, RQ4, H4a, H4b, S1)

6. Schnabel, T., Swaminathan, A., Singh, A., Chandak, N., and Joachims, T.
   (2016). Recommendations as Treatments: Debiasing Learning and Evaluation.
   ICML 2016.
   - Adapts propensity weighting from causal inference to get unbiased
     performance estimators from biased recommendation data.
   - Effect: the IPS and SNIPS estimators in src/correction.py are standard;
     the study's contribution is measuring them against a fully observed
     truth, not proposing them.

## Dataset

7. Gao, C., and others (2022). KuaiRec: A Fully-observed Dataset and
   Insights for Evaluating Recommender Systems. CIKM 2022.
   doi:10.1145/3511808.3557220.
   - The source of the 1,411 x 3,327 fully observed matrix. The paper
     itself shows that method rankings vary with density and exposure bias,
     in a conversational recommendation setting.
   - Effect: "a fully observed truth changes conclusions" is already
     reported on this dataset. This study's narrower claim is a
     pre-registered measurement of four named shortcuts against it.

## Adjusted novelty claim (binding wording)

Sampled-metric inconsistency, leakage from non-temporal splits, and
propensity correction are all established. This study claims novelty only
for a pre-registered, frozen-rule measurement of those four shortcuts
against KuaiRec's fully observed matrix, with Holm-corrected intervals and an
open decision log. Until Arm F and the exposure arm produce committed
output, it claims nothing beyond the descriptive MovieLens-1M replication.
