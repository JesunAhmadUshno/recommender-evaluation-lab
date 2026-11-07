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
