# AUDIT

## Execution audit

This audit covers the fresh single pass ordered in DECISIONS.md
D13, executed 2026-11-07 on BlackBoxV3 and verified by the runner
before anything was published.

- Machine of record: BlackBoxV3, Intel i5-8400 (6 cores), 7.1 GiB
  RAM, Ubuntu 26.04. No competing load. All timings in
  results/tables/timings.csv and all wall-clock statements in
  RESULTS.md are this machine's.
- Toolchain: Python 3.12.16 in a dedicated virtual environment
  (uv 0.13.7), numpy 2.5.4, OMP_NUM_THREADS=6. The repo test suite
  passed 23 of 23 before any stage ran.
- Inputs: KuaiRec.zip SHA-256
  c23f211cf109c7a060a25a4afe9e8c681b1ccbbc816cca921d87ad37dd11c70c
  and ml-1m.zip SHA-256
  a6898adb50b9ca05aa231689da44c217cb524e7ebd39d264c56e2832f2c54e20,
  both matching PREREG.md before extraction. Data stayed on
  BlackBoxV3; only derived statistics returned to this repo.
- Stages, each launched once, detached, in pipeline order: audit
  (exit 0), arm_t (exit 0), ml1m (exit 0), arm_f (exit 0), random
  (exit 0), verdicts (exit 0 on the second attempt; see below).
  Results directory started empty. No stage was resumed; the
  bundles under results/bundles/ are single-pass working state.
- Pass wall clock: 02:04:06 to 02:59:13 EST (55 minutes, including
  inter-stage handling). Stage spans are in
  logs/fresh-pass-2026-11-07/run.log. Peak RSS on Arm T (KuaiRec)
  was about 3.38 GB, above the roughly 2.6 GB level at which the
  shared Muse VM killed this pipeline during the fragmented
  execution (DECISIONS.md D11); the dedicated machine is why this
  pass exists.
- One environment failure, fixed at the environment level only:
  the verdicts stage shells out to git for the pre-registration
  pin, and BlackBoxV3 ships without git. A user-space git 2.53.0
  (official Ubuntu archive package, extracted, never installed
  system-wide) plus the repository's own .git transferred from the
  local clone let the stage compute the pin itself:
  cab910eb9a66651771ba77656ad7950f6b005f00, matching the local
  clone exactly. No pipeline code was changed anywhere in this
  pass. Both verdicts attempts are logged
  (logs/fresh-pass-2026-11-07/stage-verdicts.log and
  stage-verdicts2.log).

## Claim audit

Every verdict in RESULTS.md was recounted independently from the
committed tables before publication:

- H1: Popularity vs Random exact NDCG@10 read directly from
  results/tables/arm_metrics.csv (Arm T 0.00007 vs 0.00143; Arm F
  0.0199 vs 0.0468). NOT SUPPORTED follows from the frozen rule.
- H1a and H1b: differences recomputed from the same table
  (0.000943 minus 0.000073 = 0.000870; 0.001443 minus 0.000943 =
  0.000500) and matched against the bootstrap bounds in
  results/verdicts.json.
- H3a: random-split seed means recomputed from
  results/tables/random_split.csv; 4 of 4 KuaiRec rankers exceed
  their temporal values, 3 of 4 on MovieLens-1M.
- H3b: results/leakage_check.json shows overlap 0 and time order
  holding on the clean split, overlap 2 and time order violated on
  the planted leak.
- H7: cold-start gaps read from results/tables/cold_start.csv
  inputs as recorded in verdicts.json (slice gap 0.0000106 vs full
  gap 0.000870, n = 6,535).

No Jev claim_check was run on this pass's headline claims; the
recount above is a direct recomputation from committed CSVs, and
the limitation is recorded here rather than papered over.

## Validity audit: the Arm F defect

The recount surfaced a defect that changes what Arm F means. It is
documented in full at the top of RESULTS.md; the audit summary:

- Measured from the raw loaders on the machine of record:
  big-matrix events by the 1,411 small users on small-matrix items
  = 0 (of 571,061 big events by those users, and 10,272,525 big
  events on small items overall). The user and item id mappings
  were verified correct (small raw ids are a true subset of big
  raw ids), so this is a dataset fact, not an indexing bug:
  KuaiRec's small matrix is pair-disjoint from its big matrix
  (registration audit A2 recorded small_pairs_present_in_big = 0).
- Consequence: the DECISIONS.md D5 pool (big events restricted to
  small items) gives all 1,411 target users an empty training
  history. Verified from the run bundles: the ItemKNN, EASE, and
  iALS Arm F score matrices are identical and all zero. The models
  themselves are not broken (an ItemKNN refit has 166,223 nonzero
  neighbor weights; the EASE weight matrix is dense); they were
  scored on empty rows.
- Void as evidence: all Arm F ItemKNN, EASE, and iALS rows in every
  table (exact, sampled, corrected, slices, exposure inputs).
  Verdicts H2a, H5, H6, H4a, H4b, and S1 are published as computed
  in RESULTS.md with an explicit not-usable label. H2b's frozen
  flip test cannot fire under the tie artifact.
- Still valid: Arm F Random and Popularity; all of Arm T on both
  datasets; the random-split arm; the leakage audit; the
  cold-start slice; the data audit.
- Disposition: the defect sits in the frozen design, so this pass
  did not patch it. The repair (a DECISIONS.md entry redefining the
  Arm F training pool, with a PREREG.md amendment if the rule
  changes, then a rerun of Arm F only) is a coordinator decision.
  The fragmented execution's Arm F tables carried the same defect;
  only a clean pass with bundle-level verification could prove it
  was the design and not the stitching.

## Security audit

- No credentials were created or used. Dataset downloads are
  public files fetched over HTTPS from Zenodo and GroupLens.
- No dataset file is committed; data/raw/ is gitignored and the
  raw archives never left BlackBoxV3. Committed results are
  derived statistics only.
- The user_features_raw.csv exclusion (PREREG.md section 7) was
  respected: the file was not extracted or read.
- Tooling added on BlackBoxV3 is user-space only (uv, a Python
  3.12 build, an extracted git package under ~/b3-fresh/); no
  sudo was used or available.

## Cost audit

Zero spend. No cloud resource, no paid API, no new credential.
Compute was Jesun's own BlackBoxV3 for about one hour.

## Licence audit

Code: Apache-2.0 (LICENSE). Derived data under results/: CC BY-SA
4.0 (DATA_LICENSE.md), inherited from KuaiRec. MovieLens-1M
appears as statistics only, under the GroupLens terms. KuaiRec is
used under CC BY-SA 4.0 with attribution (DECISIONS.md D3);
citation: Gao et al., KuaiRec, CIKM 2022,
doi:10.1145/3511808.3557220.
