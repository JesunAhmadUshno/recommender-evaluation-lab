// Known-answer check, run by "npm run build" before bundling. Every browser
// computation is asserted against the repo's own tests or committed results.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  expectedSampledRank, correctedRank, simulateSampledRank, holmAdjust, kendallTauB,
  makePropensities, estimatePropensities, syntheticWorld, simulateOffPolicy,
} from './stats.js';
import { parseCsv, sampledSummary, parseHeadline, parseHypotheses, parseDecisions, preregFacts, parseVerdictTable } from './data.js';

const repo = new URL('../../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, repo), 'utf8');
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// 1. Sampled-rank expectation: tests/test_metrics.py worked example (r=300, n=3327, m=100 -> 9.99).
assert.equal(expectedSampledRank(3327, 300, 100).toFixed(2), '9.99');
const sim = simulateSampledRank({ n: 3327, r: 300, m: 100, draws: 20000, seed: 0 });
close(sim.mean, sim.expected, 3 * sim.se + 0.05, 'simulated sampled rank');
// The correction is unbiased for the rank (E[r_hat] = r) and zeroes NDCG once r_tilde >= 2.
close(sim.meanRhat, 300, 3 * sim.se * (3326 / 100) + 1, 'mean corrected rank');
assert.ok(correctedRank(2, 3327, 100) > 10, 'r_tilde=2 maps beyond the top 10');
assert.ok(sim.sampledNdcg > 0.1 && sim.exactNdcg === 0, 'sampled NDCG positive while exact is 0');

// 2. Holm recompute equals the committed p_holm column of pairwise.csv.
const pairwise = parseCsv(read('results/tables/pairwise.csv'));
const arms = [...new Set(pairwise.map((r) => r.arm))];
for (const arm of arms) {
  const rows = pairwise.filter((r) => r.arm === arm);
  holmAdjust(rows.map((r) => r.p_two_sided)).forEach((p, i) => close(p, rows[i].p_holm, 1e-12, `${arm} Holm row ${i}`));
}

// 3. Kendall tau-b: values from src/stats.py kendall_tau_b.
assert.equal(kendallTauB([1, 2, 3], [1, 2, 3]), 1);
close(kendallTauB([1, 2, 2, 3], [1, 2, 3, 4]), 0.9128709291752769, 1e-12, 'tau-b with a tie');
close(kendallTauB([3, 1, 2, 5, 4], [1, 2, 3, 4, 5]), 0.4, 1e-12, 'tau-b');

// 4. Propensities: tests/test_correction.py.
const p0 = makePropensities([10, 100, 1000], 0).p;
p0.forEach((v) => close(v, 0.163, 1e-12, 'gamma=0 is uniform 0.163'));
const p1 = makePropensities([10, 100, 1000], 1).p;
assert.ok(Math.min(...p1) >= 0.01 && Math.max(...p1) <= 1 && p1[2] > p1[0], 'gamma=1 floor, cap and order');
assert.deepEqual(estimatePropensities([0, 50, 200], 100), [0.01, 0.5, 1]);

// 5. IPS is unbiased with true propensities and naive is biased low (test_ips_is_unbiased_on_synthetic_truth).
const world = syntheticWorld({ seed: 0 });
const op = simulateOffPolicy({ world, gamma: 0.5, draws: 300, seed: 1 });
op.summary.ips.perRanker.forEach((r, j) => close(r.mean, op.truth[j], 3 * r.se + 1e-9, `IPS ${op.names[j]}`));
op.summary.naive.perRanker.forEach((r, j) => assert.ok(op.truth[j] === 0 || r.mean < op.truth[j], `naive below truth for ${op.names[j]}`));

// 6. Seed means from sampled_metrics.csv reproduce results/headline_table.md.
const metrics = parseCsv(read('results/tables/arm_metrics.csv'));
const sampled = parseCsv(read('results/tables/sampled_metrics.csv'));
for (const h of parseHeadline(read('results/headline_table.md'))) {
  const s = sampledSummary(metrics, sampled, h.arm).rankers.find((r) => r.name === h.ranker);
  assert.equal(s.exact.toFixed(4), h.exact.toFixed(4), `exact ${h.ranker}`);
  assert.equal(s.sampled.toFixed(4), h.sampled.toFixed(4), `sampled ${h.ranker}`);
  assert.equal(s.corrected.toFixed(4), h.corrected.toFixed(4), `corrected ${h.ranker}`);
}

// 7. Markdown parsers find every frozen hypothesis, decision and protocol constant.
const prereg = read('PREREG.md');
assert.deepEqual(parseHypotheses(prereg).map((h) => h.id), ['H1', 'H1a', 'H1b', 'H2a', 'H2b', 'H3a', 'H3b', 'H4a', 'H4b', 'H5', 'H6', 'H7', 'S1']);
assert.ok(parseHypotheses(prereg).every((h) => h.rule.length > 20), 'every hypothesis has its rule text');
assert.deepEqual(preregFacts(prereg), { m: 100, strictRulePct: 20, nBoot: 2000, floor: 0.01, density: 0.163, gammas: [0, 0.5, 1] });
const ds = parseDecisions(read('DECISIONS.md'));
assert.deepEqual(ds.slice(0, 13).map((d) => d.id), Array.from({ length: 13 }, (_, i) => `D${i + 1}`));

// 8. RESULTS.md verdict tables split the 13 hypotheses into valid and void, and every verdict
//    they quote equals the one the pipeline wrote to results/verdicts.json.
const resultsMd = read('RESULTS.md');
const verdicts = JSON.parse(read('results/verdicts.json'));
const valid = parseVerdictTable(resultsMd, 'Verdicts that stand on valid evidence');
const voided = parseVerdictTable(resultsMd, 'Verdicts as computed, not usable as findings');
assert.deepEqual(valid.map((v) => v.id), ['H1', 'H1a', 'H1b', 'H3a', 'H3b', 'H7']);
assert.deepEqual(voided.map((v) => v.id), ['H2a', 'H2b', 'H4a', 'H4b', 'S1', 'H5', 'H6']);
for (const v of [...valid, ...voided]) assert.equal(v.verdict, verdicts[v.id].verdict, `verdict ${v.id}`);
assert.equal(new Set([...valid, ...voided].map((v) => v.id)).size, 13, 'every hypothesis classified once');
assert.match(resultsMd, /run on BlackBoxV3 \(/, 'machine of record named');

console.log('stats.check: all known-answer checks pass');
