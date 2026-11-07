// Browser ports of the repo's own Python, kept line-for-line where possible.
// src/metrics.py (sampled ranks, rank-mapping correction), src/stats.py
// (holm_adjust, kendall_tau_b), src/correction.py (make_propensities,
// estimate_propensities, estimator_dcgs). stats.check.mjs asserts them
// against the repo's tests and committed result files on every build.

export function rng(seed) { // mulberry32: small, seeded, reproducible
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const K = 10;
export const DISCOUNTS = Array.from({ length: K }, (_, i) => 1 / Math.log2(i + 2));
const gainAt = (rank) => (rank <= K ? 1 / Math.log2(rank + 1) : 0);

// ---------- sampled metrics (src/metrics.py) ----------
// PREREG section 7: E[r_tilde] = 1 + m (r - 1) / (n - 1).
export const expectedSampledRank = (n, r, m) => 1 + (m * (r - 1)) / (n - 1);
// r_hat = 1 + (r_tilde - 1) (n - 1) / m, as in corrected_ndcg.
export const correctedRank = (rTilde, n, m) => 1 + ((rTilde - 1) * (n - 1)) / m;

// One user with a single positive at true rank r among n items. Each draw samples
// m negatives uniformly without replacement (sampled_per_user), so the sampled
// rank is 1 + how many of the r - 1 better negatives were drawn.
export function simulateSampledRank({ n, r, m, draws = 20000, seed = 0 }) {
  m = Math.min(m, n - 1);
  const rand = rng(seed);
  const counts = new Map();
  let sumRank = 0, sumRank2 = 0, hits = 0, sNdcg = 0, cNdcg = 0, sumRhat = 0;
  for (let d = 0; d < draws; d++) {
    let better = r - 1, total = n - 1, drawn = 0;
    for (let k = 0; k < m; k++) {
      if (rand() < better / total) { drawn++; better--; }
      total--;
    }
    const rt = 1 + drawn;
    counts.set(rt, (counts.get(rt) || 0) + 1);
    sumRank += rt; sumRank2 += rt * rt;
    if (rt <= K) hits++;
    sNdcg += gainAt(rt);
    const rh = correctedRank(rt, n, m);
    sumRhat += rh;
    cNdcg += rh <= K ? 1 / Math.log2(rh + 1) : 0;
  }
  const mean = sumRank / draws;
  const sd = Math.sqrt(Math.max(0, sumRank2 / draws - mean * mean));
  return {
    n, r, m, draws, counts, mean, sd,
    se: sd / Math.sqrt(draws),
    expected: expectedSampledRank(n, r, m),
    pHit: hits / draws,
    sampledNdcg: sNdcg / draws,
    correctedNdcg: cNdcg / draws,
    exactNdcg: gainAt(r),
    meanRhat: sumRhat / draws,
  };
}

// ---------- statistics (src/stats.py) ----------
export function holmAdjust(pvals) {
  const m = pvals.length;
  const order = pvals.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[1]);
  const adj = new Array(m);
  let running = 0;
  order.forEach((idx, rank) => {
    running = Math.max(running, (m - rank) * pvals[idx]);
    adj[idx] = Math.min(1, running);
  });
  return adj;
}

export function kendallTauB(x, y) {
  const n = x.length;
  if (n !== y.length || n < 2) throw new Error('kendallTauB needs two vectors of length >= 2');
  let c = 0, d = 0, tx = 0, ty = 0;
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) {
    const dx = Math.sign(x[i] - x[j]), dy = Math.sign(y[i] - y[j]);
    if (dx === 0 && dy === 0) continue;
    if (dx === 0) tx++; else if (dy === 0) ty++; else if (dx === dy) c++; else d++;
  }
  const pairs = (n * (n - 1)) / 2;
  const den = Math.sqrt((pairs - tx) * (pairs - ty));
  return den === 0 ? 0 : (c - d) / den;
}

// ---------- off-policy estimators (src/correction.py) ----------
export function makePropensities(exposures, gamma, targetMean = 0.163, floor = 0.01) {
  const nmax = Math.max(Math.max(...exposures), 1);
  const base = exposures.map((v) => (v / nmax) ** gamma);
  const c = targetMean / Math.max(base.reduce((s, v) => s + v, 0) / base.length, 1e-12);
  return { p: base.map((b) => Math.min(Math.max(floor, c * b), 1)), c };
}

export const estimatePropensities = (counts, nUsers, floor = 0.01) =>
  counts.map((v) => Math.min(Math.max(v / Math.max(nUsers, 1), floor), 1));

// Per-ranker mean DCG@10: truth from every cell; naive, IPS and SNIPS from observed cells only.
export function estimatorDcgs(top, rel, exposed, propensity, nItems) {
  const U = top.length;
  let truth = 0, naive = 0, ips = 0, wsum = 0;
  for (let u = 0; u < U; u++) for (let k = 0; k < K; k++) {
    const i = top[u][k], cell = u * nItems + i, d = DISCOUNTS[k];
    const r = rel[cell], o = exposed[cell], w = o / Math.max(propensity[i], 1e-9);
    truth += r * d; naive += o * r * d; ips += w * r * d; wsum += w * d;
  }
  const dTotal = DISCOUNTS.reduce((s, v) => s + v, 0);
  return { truth: truth / U, naive: naive / U, ips: ips / U, snips: wsum > 0 ? (ips / wsum) * dTotal : 0 };
}

function topK(scores, nItems, U) {
  const out = [];
  const idx = Array.from({ length: nItems }, (_, i) => i);
  for (let u = 0; u < U; u++) {
    const row = scores.subarray(u * nItems, (u + 1) * nItems);
    out.push([...idx].sort((a, b) => row[b] - row[a] || a - b).slice(0, K));
  }
  return out;
}

// A synthetic, fully known world in the spirit of tests/test_correction.py. Not KuaiRec data.
export const SYNTH_RANKERS = [
  ['Relevance-led', 1.0, 0.1, 0.9],
  ['Balanced', 0.6, 0.6, 0.9],
  ['Popularity-tilted', 0.3, 1.2, 0.6],
  ['Pure popularity', 0.0, 1.0, 0.001],
  ['Random', 0.0, 0.0, 1.0],
];
export function syntheticWorld({ users = 150, items = 240, seed = 0 } = {}) {
  const rand = rng(seed);
  const exposure = Array.from({ length: items }, (_, i) => Math.round(2000 / (i + 1) ** 0.9) + 1);
  const lmax = Math.log1p(Math.max(...exposure));
  const popn = exposure.map((v) => Math.log1p(v) / lmax);
  const quality = popn.map((p) => 0.5 * rand() + 0.5 * p);
  const rel = new Uint8Array(users * items);
  for (let u = 0; u < users; u++) for (let i = 0; i < items; i++) rel[u * items + i] = rand() < 0.04 + 0.22 * quality[i] ? 1 : 0;
  const rankers = SYNTH_RANKERS.map(([name, a, b, c]) => {
    const s = new Float64Array(users * items);
    for (let u = 0; u < users; u++) for (let i = 0; i < items; i++) s[u * items + i] = a * rel[u * items + i] + b * popn[i] + c * rand();
    return { name, top: topK(s, items, users) };
  });
  return { users, items, exposure, rel, rankers };
}

export function simulateOffPolicy({ world, gamma, estimated = false, draws = 100, seed = 0 }) {
  const { users: U, items: I, rel, rankers, exposure } = world;
  const { p } = makePropensities(exposure, gamma);
  const rand = rng(seed);
  const exposed = new Uint8Array(U * I);
  const est = { naive: [], ips: [], snips: [] };
  const tau = { naive: [], ips: [], snips: [] };
  let truth = null;
  for (let d = 0; d < draws; d++) {
    const counts = new Array(I).fill(0);
    for (let u = 0; u < U; u++) for (let i = 0; i < I; i++) {
      const o = rand() < p[i] ? 1 : 0;
      exposed[u * I + i] = o; counts[i] += o;
    }
    const prop = estimated ? estimatePropensities(counts, U) : p;
    const outs = rankers.map((r) => estimatorDcgs(r.top, rel, exposed, prop, I));
    truth = outs.map((o) => o.truth);
    for (const e of Object.keys(est)) {
      const v = outs.map((o) => o[e]);
      est[e].push(v);
      tau[e].push(kendallTauB(v, truth));
    }
  }
  const summary = {};
  for (const e of Object.keys(est)) {
    summary[e] = {
      perRanker: rankers.map((_, j) => {
        const vals = est[e].map((row) => row[j]);
        const mean = vals.reduce((s, v) => s + v, 0) / draws;
        const rmse = Math.sqrt(vals.reduce((s, v) => s + (v - truth[j]) ** 2, 0) / draws);
        const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, draws - 1));
        return { mean, bias: mean - truth[j], rmse, se: sd / Math.sqrt(draws) };
      }),
      tau: tau[e].reduce((s, v) => s + v, 0) / draws,
    };
  }
  return { truth, summary, p, names: rankers.map((r) => r.name), draws, gamma, estimated };
}
