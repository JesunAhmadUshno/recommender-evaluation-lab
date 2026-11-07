# Decision log

Every judgement call the build had to make, recorded openly. Nothing in
this file is hidden from a reader of the results.

## D1. Two extractions of the design pack disagree; the build follows the filed pack
The Claude Research Verdict Pack for this track exists in two extractions:
a harvested markdown version (hypotheses H1 to H7) and a rendered-page PDF
of the same chat (a more detailed design with Arm T / Arm F structure and
hypotheses numbered H1a to H5b). The coordinator's verification note on the
filed pack is binding on this build, so the frozen hypothesis set is the
filed pack's H1 to H7. Where the rendered pack carries design detail the
harvest lost (the two-arm structure, the rank-mapping correction formula,
the propensity generator, the tuning budget, the audit list), the build
adopts it and says so in PREREG.md. The two schemes agree in substance at
the points that matter: the rendered H4b is the filed H4b verbatim; the
rendered H1a/H1b split the filed H2b into its flip and error parts; the
rendered H2 is the filed H3a; the rendered H3 (naive evaluation over-rates
the popularity ranker at gamma = 1) is carried as supplementary hypothesis
S1; the rendered H5a/H5b comparisons are covered by the filed H1a/H1b and
the Holm-adjusted pairwise table.

## D2. H4a's frozen rule is a recorded substitution
The filed pack truncates H4a's verdict rule at "SUPPORTED if". The build
worker extracted the rendered-page PDF and found the same truncation
there: the rule text is absent from both sources. Per the coordinator
note, the rule frozen in PREREG.md is the one implied by the pack's
upgrade 5 acceptance criterion (with true propensities, the estimator
recovers the true ranking), operationalised in the same paired-bootstrap
form as H4b. This is a substitution, recorded here, not a silent
invention.

## D3. KuaiRec licence: the archive's own licence text governs
Three licence statements exist. The licence file inside KuaiRec.zip is
CC BY-SA 4.0 (Attribution-ShareAlike 4.0 International). The Zenodo record
18164998 metadata says CC BY 4.0. The GitHub README badge says CC BY-SA
4.0. The harvested pack's evidence row E2 quotes a CC BY-NC-SA 4.0 text
that matches none of the primary sources checked on 2026-11-06. The build
follows the strictest consistent reading: the dataset is used under
CC BY-SA 4.0 with attribution, raw files are never committed, and derived
data files shipped in results/ are covered by DATA_LICENSE.md under
CC BY-SA 4.0. Code is Apache-2.0. This is a reading of the licences, not
legal advice. MovieLens-1M is used under the GroupLens research terms: no
redistribution, only derived statistics published.

## D4. SASRec is excluded from the measured ladder
The rendered pack (section 4.6) excludes SASRec and LightGCN: the big
matrix averages about 1,746 events per user, and self-attention training
on 4 CPU cores cannot carry the frozen tuning budget honestly. The
coordinator note's drop order also puts SASRec first. src/rankers.py
contains a SASRec class that raises NotImplementedError pointing here, so
the exclusion is visible in code and tested, and no SASRec number appears
anywhere in the results.

## D5. Arm F trains on big-matrix events restricted to small-matrix items
The rendered design trains Arm F rankers on big-matrix events before the
small matrix begins, with a frozen fallback. The build restricts that
training pool to events whose item is a small-matrix item, so the item
space of every Arm F ranker matches the evaluation space exactly. By
construction (evidence row E2 of the rendered pack) small-matrix pairs
were removed from the big matrix, so no small-matrix label is ever a
training input. The audit measures the strict-rule feasibility (fraction
of the pool before the earliest small timestamp); PREREG.md freezes which
rule the audit selects.

## D6. Sampled protocol: m = 100 negatives per user
The filed pack says both "100 negatives per test positive" and, in its
worked example and correction formula, m = 100 negatives in total. The
build follows the worked example: per user, the candidate set is all test
positives plus 100 negatives sampled uniformly. The correction formula is
only defined under this reading.

## D7. SNIPS operationalisation
The pack names SNIPS without a formula for a DCG estimand. The build uses
the standard self-normalised ratio form at the population level: the sum
of per-user IPS DCG estimates divided by the sum of per-user importance
weights, rescaled by the sum of the top-10 discounts so the estimate sits
on the DCG scale. The formula is written out in PREREG.md.

## D8. Masking of seen items
Arm T scores mask training positives (standard offline protocol; test
positives are first-time by construction). Arm F does not mask: the
rendered design has every ranker score all 3,327 small-matrix items and
the truth metric uses all observed labels. The asymmetry is deliberate and
frozen in PREREG.md.

## D9. MovieLens-1M is the second dataset, in a replication role
The coordinator adoption decision names MovieLens-1M as the second
dataset that satisfies the pack's GO condition 1. The rendered pack
rejected MovieLens as the primary dataset because it has no ground truth
and its licence bars redistribution; neither objection applies to the
role it has here. KuaiRec's small matrix remains the only ground-truth
arm. MovieLens-1M replicates the temporal-versus-random and
sampled-versus-exact comparisons on a sparse, widely used corpus, and
only derived statistics are published.

## D10. Memory blocking in the metric functions (implementation only)
The first Arm T (KuaiRec big) run died silently immediately after the
split line was logged, with no traceback and no partial tables, while
the shared VM was also carrying another build's heavy stage. The
pattern is consistent with the process being killed under memory
pressure: the metric functions materialised full-size float64 copies of
the 6,638 x 10,728 score and relevance matrices (about 570 MB each) on
top of the loader arrays and the training matrix. src/metrics.py now
evaluates exact metrics in row blocks of 512 and no longer converts the
full score matrix inside the sampled-metric loop (only single rows are
read there). Every per-user quantity is row-independent and the
float32 to float64 conversion is exact, so no computed value changes;
the 23 unit tests pass unchanged. No hypothesis, verdict rule, seed, or
protocol element is affected, so PREREG.md needs no amendment.

## D11. Stage Arm T restructured ranker by ranker (implementation only)
Even after D10, the Arm T (KuaiRec big) process was killed silently
three times at a peak RSS of about 2.5 GB while the shared VM carried
another build's heavy stage; a control allocation test confirmed that
a single process on this VM is killed at about 2.6 to 2.7 GB RSS under
current load, and a standalone reproduction of the first tuning step
completed at a 2,559 MB peak, just under the wire. The binding
constraint is therefore the process peak, not the design. Changes, all
value-preserving by construction: tuning evaluates validation NDCG in
blocks of 512 users; the test relevance matrix is dropped during
tuning and restored after; each ranker is fitted, scored, and measured
(sampled, popularity, cold-start) before the next fit, so only one
full score matrix is alive at a time; stages load only the datasets
they need; the ranker fits reuse an already-binary float32 training
matrix instead of copying it. A fourth run then died inside the first
EASE tuning fit, so two more cuts followed: the EASE Gram matrix is
accumulated in column blocks (the product temporary is one slab, not a
second full matrix; the entries are the same sums grouped
differently), and the raw event arrays plus the validation matrix are
parked outside the arm during tuning and evaluation and restored
before the leakage check. Two more runs still died inside the first
EASE fit (a standalone reproduction of that fit was SIGKILLed at a
1,608 MB pre-fit peak while the neighbouring build's database stage
cycled), so evaluation was split into fit and measure phases: no
relevance or score matrix is alive while a fit runs, score matrices
are assembled and masked in blocks of 512 users, and the validation
matrix is parked during tuning fits. The EASE weight matrix is also
built in place (divide, then negate) instead of as a separate
temporary; a direct comparison against the original formulation on
synthetic matrices at 700 and 7,000 items gave a maximum absolute
difference of 0.0. Verification of the split: on MovieLens-1M with the
committed chosen configs, fit-plus-measure reproduced the committed
exact NDCG@10 for all five rankers to below 1e-12 (Random 0.012974,
Popularity 0.153566, ItemKNN 0.150368, EASE 0.144017, iALS 0.130261).
No hypothesis, verdict rule, seed, grid, or protocol element changed.

## D12. Every stage is resumable (the VM reboots about every two hours)
During this build the VM rebooted at about 02:08 and again at about
04:01 UTC, killing every running process each time, and the shared
neighbour build's database stage added memory pressure between
reboots. Long stages therefore persist progress as they go: tuning
rows are written the moment each config finishes and are reused on
the next run (chosen configs are still the argmax over the full grid
table); each Arm T and Arm F ranker writes a bundle (its table rows
plus per-user arrays, or its score matrix for Arm F) keyed by the
chosen config it was computed under, and a rerun reloads bundles
instead of refitting; the random-split stage keeps only complete
five-ranker seeds and persists each finished seed; the Arm F pool
sensitivity and exposure parts skip when their output tables already
exist. Bundles live in results/bundles/ and are gitignored as
regenerable working state. Nothing about the design changes: the
same fits, seeds, and computations produce the tables, only their
persistence order differs.

## D13. Fresh single-pass execution on BlackBoxV3 (founder order)
The Arm T execution history on the shared Muse VM fragmented across
nine runs: repeated silent kills under memory pressure (D10, D11),
two worker failures, and VM restarts about every two hours (D12).
The tables produced that way are stitched from resumes. On 2026-11-07
the founder ordered a fresh start: one clean pass. The partial
results are preserved outside the repo (gap-closure backup,
pre-fresh-restart snapshot of 2026-11-07) and are superseded as the
results of record. The fresh pass runs on BlackBoxV3 (Intel i5-8400,
6 cores, 7.1 GiB RAM, Ubuntu 26.04), a dedicated machine with no
competing load; it is the machine of record for every timing this
pass produces, and the timing tables and AUDIT.md must name it. No
hypothesis, verdict rule, seed, split, or protocol element changes.

## D14. Committed tables predate the D13 fresh pass and are provisional
Every table now in results/ (the MovieLens-1M Arm T tables, the KuaiRec
Arm T tuning grid, timings.csv, chosen_configs.json) was produced on the
shared Muse VM before the D13 fresh pass; logs/stage_arm_t.log shows
"(resumed)" tuning rows. Under D13 they are provisional, not results of
record. They stay committed because CI's headline check and the dashboard
read them, and because the D11 re-verification ties the ML-1M numbers to
the committed code. Two known gaps follow from that environment and are
left for the fresh pass rather than patched by hand: timings.csv does not
name its machine, and it has no ML-1M iALS score_test row.
results/headline_table.md is generated from these tables by
scripts/reproduce_headline.py, so it carries the same status. No
hypothesis, verdict rule, seed, split, or protocol element changes.

## D15. D14 is superseded by the D13 fresh pass
The D13 fresh pass (commits b9f4c16 and 2328e3f, BlackBoxV3,
2026-11-07) regenerated every table D14 called provisional, added the
Arm F, exposure, random-split, leakage and verdict outputs, and names
its machine in RESULTS.md. The tables now in results/ are the results
of record; D14 applies only to the earlier Muse VM tables, which no
longer exist in results/. RESULTS.md's validity notice on the Arm F
pool (D5) is unaffected. No hypothesis, verdict rule, seed, split, or
protocol element changes.
