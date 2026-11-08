import { useMemo, useState, useEffect, useId, useDeferredValue } from 'react';
import prereg from '../../PREREG.md?raw';
import decisionsMd from '../../DECISIONS.md?raw';
import audit from '../../results/data_audit.json';
import chosen from '../../results/chosen_configs.json';
import verdicts from '../../results/verdicts.json';
import armFMeta from '../../results/arm_f_meta.json';
import resultsMd from '../../RESULTS.md?raw';
import metricTests from '../../tests/test_metrics.py?raw';
import { parseCsv, sampledSummary, parseHypotheses, parseDecisions, preregFacts, section, parseVerdictTable } from './data.js';
import { simulateSampledRank, holmAdjust, syntheticWorld, simulateOffPolicy, correctedRank } from './stats.js';

// Every committed result file, read at build time. The study-status strip and the hypothesis
// cards are worked out from which of these exist, so they update when new arms are committed.
const FILES = import.meta.glob(['../../results/**/*.csv', '../../results/**/*.json', '!../../results/bundles/**'], { query: '?raw', import: 'default', eager: true });
const fileText = (name) => Object.entries(FILES).find(([k]) => k.endsWith(`/${name}`))?.[1];
const table = (name) => { const t = fileText(name); return t ? parseCsv(t) : []; };
const hasFile = (name) => fileText(name) !== undefined;
const armsIn = (name) => new Set(table(name).map((r) => r.arm));

const REPO = 'https://github.com/JesunAhmadUshno/recommender-evaluation-lab';
const blob = (p) => `${REPO}/blob/main/${p}`;
const f3 = (x) => (x == null || Number.isNaN(x) ? 'n/a' : x.toFixed(3));
const f4 = (x) => (x == null || Number.isNaN(x) ? 'n/a' : x.toFixed(4));
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const day = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);

const FACTS = preregFacts(prereg);
// The simulator opens on the repo's own test vector (tests/test_metrics.py _rank_setup).
const TEST_RANK = Number(metricTests.match(/true_rank=(\d+)/)[1]);
const TEST_N = Number(metricTests.match(/n_items=(\d+)/)[1]);
const METRICS = table('arm_metrics.csv');
const SAMPLED = table('sampled_metrics.csv');
const PAIRWISE = table('pairwise.csv');
const POP = table('popularity_report.csv');
const COLD = table('cold_start.csv');
const TIMINGS = table('timings.csv');
const ARM = 'arm_t_ml1m';
const ARM_LABEL = { arm_t_ml1m: 'MovieLens-1M Arm T (replication)', arm_t_kuairec: 'KuaiRec big Arm T', arm_f: 'Arm F (KuaiRec small)' };
const SUMMARY = sampledSummary(METRICS, SAMPLED, ARM);
const N_USERS = METRICS.find((r) => r.arm === ARM)?.n_users;
const COLORS = { Random: 'var(--c-rand)', Popularity: 'var(--c-pop)', ItemKNN: 'var(--c-knn)', EASE: 'var(--c-ease)', iALS: 'var(--c-ials)' };
const colorOf = (n) => COLORS[n] || 'var(--muted)';

// What each frozen rule needs before it can be evaluated (PREREG section 6), as [table, arm, label].
const NEEDS = {
  H1: [['arm_metrics.csv', 'arm_t_kuairec', 'KuaiRec Arm T test metrics'], ['arm_metrics.csv', 'arm_f', 'Arm F truth metrics']],
  H1a: [['pairwise.csv', 'arm_t_kuairec', 'KuaiRec Arm T pairwise table']],
  H1b: [['pairwise.csv', 'arm_t_kuairec', 'KuaiRec Arm T pairwise table']],
  H2a: [['sampled_metrics.csv', 'arm_f', 'Arm F sampled metrics']],
  H2b: [['sampled_metrics.csv', 'arm_f', 'Arm F sampled metrics']],
  H3a: [['random_split.csv', null, 'random-split arm']],
  H3b: [['leakage_check.json', null, 'leakage audit with the planted leak']],
  H4a: [['exposure_tau.csv', null, 'semi-synthetic exposure arm']],
  H4b: [['exposure_tau.csv', null, 'semi-synthetic exposure arm']],
  H5: [['popularity_slices.csv', null, 'Arm F popularity slices']],
  H6: [['popularity_report.csv', 'arm_f', 'Arm F popularity report']],
  H7: [['cold_start.csv', 'arm_t_kuairec', 'KuaiRec Arm T cold-start slice']],
  S1: [['exposure_estimates.csv', null, 'semi-synthetic exposure arm']],
};
const present = ([file, arm]) => (arm ? armsIn(file).has(arm) : hasFile(file));
// RESULTS.md sorts the computed verdicts into those that stand on valid evidence and those
// whose evidence includes the void Arm F learned-ranker rows (its validity notice).
const VALID = Object.fromEntries(parseVerdictTable(resultsMd, 'Verdicts that stand on valid evidence').map((v) => [v.id, v]));
const VOID = Object.fromEntries(parseVerdictTable(resultsMd, 'Verdicts as computed, not usable as findings').map((v) => [v.id, v]));
const HYPS = parseHypotheses(prereg).map((h) => {
  const missing = (NEEDS[h.id] || []).filter((n) => !present(n)).map((n) => n[2]);
  const verdict = verdicts[h.id]?.verdict;
  const status = !verdict ? (missing.length ? 'pending' : 'evidence in, verdict not run') : VOID[h.id] ? 'void' : VALID[h.id] ? 'valid' : 'unclassified';
  return { ...h, missing: verdict ? [] : [...new Set(missing)], status, verdict, note: (VALID[h.id] || VOID[h.id])?.note };
});
const USABLE = HYPS.filter((h) => h.status === 'valid').length;
const N_VOID = HYPS.filter((h) => h.status === 'void').length;
const MACHINE = resultsMd.match(/run on (\w+) \(/)?.[1];
const ARM_F_USERS = METRICS.find((r) => r.arm === 'arm_f')?.n_users;

const STATUS = [
  ['ML-1M Arm T', armsIn('arm_metrics.csv').has('arm_t_ml1m') ? 'recorded' : 'not yet run'],
  ['KuaiRec Arm T', armsIn('arm_metrics.csv').has('arm_t_kuairec') ? 'recorded' : armsIn('tuning_arm_t_kuairec.csv').has('arm_t_kuairec') ? 'tuning only' : 'not yet run'],
  ['Arm F (truth)', !armsIn('arm_metrics.csv').has('arm_f') ? 'not yet run' : N_VOID ? 'learned-ranker rows void' : 'recorded'],
  ['Exposure arm', hasFile('exposure_estimates.csv') ? 'recorded' : 'not yet run'],
  ['Random split', hasFile('random_split.csv') ? 'recorded' : 'not yet run'],
  ['Leakage audit', hasFile('leakage_check.json') ? 'recorded' : 'not yet run'],
  ['Verdicts', hasFile('verdicts.json') ? 'recorded' : 'not yet run'],
];
const statusPill = (s) => (s === 'recorded' ? 'good' : s === 'not yet run' ? 'bad' : 'warn');

const SECTIONS = [['top', 'Overview', '◎'], ['hyp', 'Hypotheses', 'H'], ['reversal', 'Reversal', '⇅'], ['sim', 'Simulator', '◷'], ['board', 'Leaderboard', '▥'], ['holm', 'Holm table', 'p'], ['pop', 'Popularity', '%'], ['cold', 'Cold start', '❄'], ['tuning', 'Tuning', '⚙'], ['ips', 'Off-policy', '⇄'], ['audit', 'Data', '⛁'], ['limits', 'Limits', '!'], ['decisions', 'Decisions', '✓']];

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.08 });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
}

function MenuBar() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
  return (
    <div className="menubar" role="banner">
      <span className="apple" aria-hidden="true">◆</span>
      <a className="app" href="#top">Recommender Evaluation Lab</a>
      <a className="m" href={blob('PREREG.md')}>Pre-registration</a>
      <a className="m" href={blob('DECISIONS.md')}>Decisions</a>
      <a className="m" href={blob('REPORT.md')}>Report</a>
      <span className="spacer" />
      <span className="status"><i /> D13 run of record · Arm F learned rows void</span>
      <a href={REPO}>GitHub ↗</a>
      <span className="clock">{now.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>
    </div>
  );
}

function Dock() {
  const [active, setActive] = useState('top');
  useEffect(() => {
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setActive(e.target.id)), { rootMargin: '-45% 0px -50% 0px' });
    SECTIONS.forEach(([id]) => { const el = document.getElementById(id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);
  return (
    <nav className="dock" aria-label="Sections">
      {SECTIONS.map(([id, label, icon]) => (
        <a key={id} href={`#${id}`} className={active === id ? 'on' : ''} aria-current={active === id ? 'true' : undefined} aria-label={label}>
          <span className="ico" aria-hidden="true">{icon}</span><span className="lbl">{label}</span>
        </a>
      ))}
    </nav>
  );
}

function Range({ label, value, min, max, step, onChange, show }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label} <span>{show}</span></label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </div>
  );
}

function Seg({ label, value, options, onChange }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([k, l]) => <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  );
}

const Recorded = ({ src }) => <span className="pill info">Recorded · <a href={blob(`results/${src}`)}>{src}</a></span>;

export default function App() {
  useReveal();
  return (
    <div className="wrap">
      <MenuBar />
      <div className="glow" aria-hidden="true" />
      <Hero />
      <Hypotheses />
      <Reversal />
      <Simulator />
      <Leaderboard />
      <Holm />
      <Popularity />
      <ColdStart />
      <Tuning />
      <OffPolicy />
      <Audit />
      <Limits />
      <Decisions />
      <Dock />
      <footer>
        Code: Apache-2.0. Derived KuaiRec data in <code>results/</code>: CC BY-SA 4.0 (Gao et al., CIKM 2022). MovieLens-1M figures are statistics only, under the GroupLens terms; no raw rows of either dataset ship with this page.
        Every number is read from <code>results/</code> or the study's markdown at build time; the two simulators run in your browser.
      </footer>
    </div>
  );
}

function Hero() {
  const r = SUMMARY.rankers;
  const nonRandom = r.filter((x) => x.name !== 'Random');
  const rankIn = (key, name) => [...nonRandom].sort((a, b) => b[key] - a[key]).findIndex((x) => x.name === name) + 1;
  const bestExact = [...nonRandom].sort((a, b) => b.exact - a.exact)[0];
  const bestSampled = [...nonRandom].sort((a, b) => b.sampled - a.sampled)[0];
  const nrPairs = SUMMARY.pairs.filter((p) => p.a !== 'Random' && p.b !== 'Random');
  const order = (key) => [...r].sort((a, b) => b[key] - a[key]).map((x) => x.name).join();
  const sameOrder = order('sampled') === order('corrected');
  const allSeeds = nrPairs.filter((p) => p.sampledFlips === p.seeds).length;
  return (
    <header className="card hero window" id="top" data-title="recommender-evaluation-lab — README.md">
      <div className="head">
        <p className="eyebrow">Pre-registered study · D13 single pass on {MACHINE}</p>
        <span className="pill warn">● {N_VOID} of {HYPS.length} verdicts void: Arm F pool defect</span>
      </div>
      <h1>On MovieLens-1M, scoring against {FACTS.m} sampled negatives <em>reverses</em> the model order.</h1>
      <p className="sub">
        {bestExact.name} is best of the {nonRandom.length} non-random rankers on the full ranking (exact NDCG@10 {f4(bestExact.exact)}) but ranks {rankIn('sampled', bestExact.name)} of {nonRandom.length} on sampled NDCG@10.{' '}
        {sameOrder ? `The rank-mapping correction keeps the sampled order (${bestSampled.name} first) instead of restoring the exact one.` : `The rank-mapping correction changes the sampled order but does not restore the exact one.`}{' '}
        This is the replication arm, read descriptively. Of the {HYPS.length} frozen verdicts, {USABLE} stand on valid evidence; the other {N_VOID} are published as computed but are not usable, because the frozen Arm F training pool gives every target user an empty history (<a href={blob('RESULTS.md')}>RESULTS.md</a> validity notice).
      </p>
      <div className="status-strip" aria-label="Study status by arm">
        {STATUS.map(([k, s]) => <span key={k} className={`pill ${statusPill(s)}`}>{k}: {s}</span>)}
      </div>
      <div className="actions">
        <a className="btn primary" href="#sim">Try the sampled-rank simulator</a>
        <a className="btn ghost" href={blob('PREREG.md')}>Read the pre-registration</a>
        <a className="btn ghost" href={blob('RESULTS.md')}>RESULTS.md: the Arm F validity notice</a>
      </div>
      <div className="tiles">
        <div className="tile"><div className="num">{f3(bestExact.exact)}</div><div className="cap">{bestExact.name}, best exact NDCG@10 ({fmt(N_USERS)} test users)</div></div>
        <div className="tile"><div className="num">{allSeeds}/{nrPairs.length}</div><div className="cap">non-random ranker pairs flipped by sampled NDCG in all {SUMMARY.seeds.length} seeds</div></div>
        <div className="tile"><div className="num">{f3(bestSampled.corrected)}</div><div className="cap">{bestSampled.name} corrected NDCG@10 vs {f3(bestSampled.exact)} exact</div></div>
        <div className="tile"><div className="num">{USABLE}/{HYPS.length}</div><div className="cap">frozen verdicts that stand on valid evidence (RESULTS.md)</div></div>
      </div>
    </header>
  );
}

function Hypotheses() {
  return (
    <section id="hyp" className="card window reveal" data-title="prereg.md — Hypotheses">
      <p className="eyebrow">Frozen verdict rules · PREREG section 6</p>
      <h2>{HYPS.length} rules frozen before any metric was computed. <em>{USABLE}</em> stand on valid evidence.</h2>
      <p className="sub">Each card quotes its rule from <a href={blob('PREREG.md')}>PREREG.md</a>, the verdict the pipeline computed from <a href={blob('results/verdicts.json')}>verdicts.json</a>, and the evidence line from <a href={blob('RESULTS.md')}>RESULTS.md</a>. Cards marked void are shown as computed, but their evidence includes the Arm F learned-ranker rows that RESULTS.md declares void; do not cite them. No verdict is filled in by hand.</p>
      <div className="hyp-grid">
        {HYPS.map((h) => (
          <div className="tile hyp" key={h.id}>
            <div className="head" style={{ marginBottom: 6 }}>
              <h3><span className="mono">{h.id}</span> {h.title}</h3>
              <span className={`pill ${h.status === 'valid' ? (h.verdict === 'SUPPORTED' ? 'good' : 'bad') : 'warn'}`}>{h.status === 'valid' ? h.verdict : h.status === 'void' ? 'Void' : h.status}</span>
            </div>
            <p className="rule">{h.rule}</p>
            {h.note && <p className="hint" style={{ margin: '0 0 4px' }}><b>{h.status === 'void' ? `Computed ${h.verdict}; why it cannot be cited:` : 'Evidence:'}</b> {h.note}</p>}
            {h.missing.length > 0 && <p className="hint" style={{ margin: 0 }}>Needs: {h.missing.join('; ')}.</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

function Reversal() {
  const [view, setView] = useState('sampled');
  const r = SUMMARY.rankers;
  const cols = [['exact', 'Exact'], ['sampled', 'Sampled (seed mean)'], ['corrected', 'Corrected (seed mean)']];
  const W = 720, H = 300, top = 40, bot = 20, xs = [150, 360, 570];
  const rank = (key, name) => [...r].sort((a, b) => b[key] - a[key]).findIndex((x) => x.name === name);
  const y = (i) => top + (i / (r.length - 1)) * (H - top - bot);
  const SW = 440, rowH = 34, SH = r.length * rowH + 34, l = 84, rr = 16, smax = Math.ceil(Math.max(...r.flatMap((x) => [...x.sampledSeeds, ...x.correctedSeeds, x.exact])) * 10) / 10;
  const sx = (v) => l + (v / smax) * (SW - l - rr);
  return (
    <section id="reversal" className="card window reveal" data-title="sampled_vs_exact.csv — The reversal">
      <div className="head">
        <div>
          <p className="eyebrow">Recorded · {ARM_LABEL[ARM]}</p>
          <h2>Full ranking and sampled ranking <em>disagree</em> on almost every pair.</h2>
          <p className="sub">
            Left: each column ranks the {r.length} rankers by its own metric; labels give the value. Sampled and corrected NDCG@10 are means over {SUMMARY.seeds.length} negative-sampling seeds of {FACTS.m} negatives per user.
            This is descriptive replication on MovieLens-1M. The frozen H2a and H2b are decided on Arm F, where the learned rankers' rows are void, so those two verdicts are not usable (RESULTS.md).
          </p>
        </div>
        <Recorded src="tables/sampled_metrics.csv" />
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Slopegraph of ranker order under exact, sampled and corrected NDCG@10">
        {cols.map(([k, t], c) => <text key={k} x={xs[c]} y={16} textAnchor="middle" style={{ fill: 'var(--text)', fontWeight: 600, fontSize: 13 }}>{t}</text>)}
        {r.map((x) => {
          const pts = cols.map(([k], c) => [xs[c], y(rank(k, x.name))]);
          return (
            <g key={x.name}>
              <polyline fill="none" stroke={colorOf(x.name)} strokeWidth="2.5" points={pts.map((p) => p.join(',')).join(' ')} />
              {pts.map(([px, py], c) => <circle key={c} cx={px} cy={py} r="5" fill={colorOf(x.name)} stroke="var(--surface-strong)" strokeWidth="2" />)}
              <text x={xs[0] - 12} y={pts[0][1] + 4} textAnchor="end" style={{ fill: 'var(--text)', fontSize: 12 }}>{x.name} {f3(x.exact)}</text>
              <text x={xs[1] + 8} y={pts[1][1] - 9}>{f3(x.sampled)}</text>
              <text x={xs[2] + 12} y={pts[2][1] + 4}>{f3(x.corrected)} {x.name}</text>
            </g>
          );
        })}
      </svg>
      <div className="grid2" style={{ marginTop: 20 }}>
        <div>
          <h3>Seeds that flip each pair against the exact order</h3>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table>
              <thead><tr><th>Pair (exact order)</th><th>Sampled flips</th><th>Corrected flips</th></tr></thead>
              <tbody>
                {SUMMARY.pairs.map((p) => {
                  const [a, b] = r.find((x) => x.name === p.a).exact >= r.find((x) => x.name === p.b).exact ? [p.a, p.b] : [p.b, p.a];
                  return (
                    <tr key={p.a + p.b}><td>{a} &gt; {b}</td>
                      <td className={p.sampledFlips ? 'no' : ''}>{p.sampledFlips}/{p.seeds}</td>
                      <td className={p.correctedFlips ? 'no' : ''}>{p.correctedFlips}/{p.seeds}</td></tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="head" style={{ marginBottom: 8 }}>
            <h3>Per-seed values against exact</h3>
            <Seg label="Seed metric" value={view} onChange={setView} options={[['sampled', 'Sampled'], ['corrected', 'Corrected']]} />
          </div>
          <svg className="chart" viewBox={`0 0 ${SW} ${SH}`} role="img" aria-label={`Per-seed ${view} NDCG@10 for each ranker with the exact value marked`}>
            {[0, 0.25, 0.5, 0.75, 1].map((t) => t * smax).map((t) => <g key={t}><line className="axis" x1={sx(t)} x2={sx(t)} y1={10} y2={SH - 22} /><text x={sx(t)} y={SH - 6} textAnchor="middle">{t.toFixed(2)}</text></g>)}
            {r.map((x, i) => (
              <g key={x.name} transform={`translate(0 ${i * rowH + 24})`}>
                <text x={l - 10} y={4} textAnchor="end" style={{ fill: 'var(--text)', fontSize: 13 }}>{x.name}</text>
                {(view === 'sampled' ? x.sampledSeeds : x.correctedSeeds).map((v, s) => <circle key={s} cx={sx(v)} cy={0} r="4.5" fill={colorOf(x.name)} opacity="0.55" />)}
                <rect x={sx(x.exact) - 2} y={-10} width="4" height="20" rx="2" fill="var(--text)" />
              </g>
            ))}
          </svg>
          <p className="hint">Dots: one per seed. Dark tick: exact NDCG@10. The sampled values sit far right of exact; corrected values sit near exact but keep the sampled order.</p>
        </div>
      </div>
    </section>
  );
}

function Simulator() {
  const presets = [['ml1m', 'ML-1M', audit.ml1m.n_items], ['ks', 'KuaiRec small', audit.kuairec_small.n_items], ['kb', 'KuaiRec big', audit.kuairec_big.n_items]];
  const [n, setN] = useState(TEST_N);
  const [r, setR] = useState(TEST_RANK);
  const [m, setM] = useState(FACTS.m);
  const [draws, setDraws] = useState(20000);
  const dn = useDeferredValue(n), dr = useDeferredValue(Math.min(r, n)), dm = useDeferredValue(Math.min(m, n - 1)), dd = useDeferredValue(draws);
  const res = useMemo(() => simulateSampledRank({ n: dn, r: Math.min(dr, dn), m: Math.min(dm, dn - 1), draws: dd, seed: 0 }), [dn, dr, dm, dd]);
  const maxBin = Math.max(12, Math.min(res.m + 1, Math.ceil(res.mean + 4 * res.sd) + 1));
  const bins = Array.from({ length: maxBin }, (_, i) => res.counts.get(i + 1) || 0);
  const peak = Math.max(...bins);
  const W = 600, H = 240, pad = { l: 12, r: 12, t: 30, b: 24 };
  const bw = (W - pad.l - pad.r) / maxBin;
  const bx = (rank) => pad.l + (rank - 1) * bw;
  const by = (c) => pad.t + (1 - c / peak) * (H - pad.t - pad.b);
  const preset = presets.find((p) => p[2] === n)?.[0] ?? 'custom';
  return (
    <section id="sim" className="card window reveal" data-title="rank_mapping.sim — Sampled-rank simulator">
      <div className="head">
        <div>
          <p className="eyebrow">Live · computed in your browser</p>
          <h2>Why a rank-{TEST_RANK} item looks like a <em>top-10</em> hit.</h2>
          <p className="sub">
            One user, one relevant item at true rank r in a catalogue of n. Each draw samples m negatives without replacement, as <a href={blob('src/metrics.py')}>sampled_per_user</a> does, and ranks the item among them.
            The page repeats that {fmt(draws)} times, then applies the correction r̂ = 1 + (r̃ − 1)(n − 1)/m from <a href={blob('src/metrics.py')}>corrected_ndcg</a>. The build check asserts the repo's test vector from tests/test_metrics.py (r {TEST_RANK}, n {fmt(TEST_N)}, m {FACTS.m}).
          </p>
        </div>
        <span className="pill info">{fmt(draws)} draws</span>
      </div>
      <div className="actions" style={{ marginTop: 0, marginBottom: 12 }}>
        <span className="hint">Catalogue preset (from data_audit.json):</span>
        <Seg label="Catalogue preset" value={preset} onChange={(k) => setN(presets.find((p) => p[0] === k)[2])} options={presets.map(([k, l, v]) => [k, `${l} · ${fmt(v)}`])} />
      </div>
      <div className="controls">
        <Range label="Catalogue size n" value={n} min={200} max={12000} step={1} onChange={setN} show={fmt(n)} />
        <Range label="True rank r" value={Math.min(r, n)} min={1} max={Math.min(1000, n)} step={1} onChange={setR} show={fmt(Math.min(r, n))} />
        <Range label="Sampled negatives m" value={Math.min(m, n - 1)} min={10} max={1000} step={10} onChange={setM} show={fmt(Math.min(m, n - 1))} />
        <div className="field"><label htmlFor="draws">Simulated draws</label>
          <select id="draws" value={draws} onChange={(e) => setDraws(+e.target.value)}>
            {[2000, 20000, 100000].map((d) => <option key={d} value={d}>{d.toLocaleString('en-US')}</option>)}
          </select>
        </div>
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Histogram of simulated sampled ranks with the theoretical expectation">
        <rect x={pad.l} y={pad.t} width={Math.min(10, maxBin) * bw} height={H - pad.t - pad.b} fill="var(--good)" opacity="0.08" />
        <text x={pad.l + 4} y={pad.t + 14} style={{ fill: 'var(--good)' }}>top-10 hit</text>
        {bins.map((c, i) => <rect key={i} x={bx(i + 1) + 1} y={by(c)} width={Math.max(1, bw - 2)} height={H - pad.b - by(c)} rx="2" fill={i < 10 ? 'var(--good)' : 'var(--primary)'} opacity="0.75" />)}
        <line x1={bx(res.expected) + bw / 2} x2={bx(res.expected) + bw / 2} y1={pad.t} y2={H - pad.b} stroke="var(--text)" strokeDasharray="5 4" strokeWidth="1.5" />
        <text x={bx(res.expected) + bw / 2} y={pad.t - 10} textAnchor="middle" style={{ fill: 'var(--text)' }}>E[r̃] = {res.expected.toFixed(2)}</text>
        <line className="axis" x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} />
        {[1, 10, maxBin].map((t) => <text key={t} x={bx(t) + bw / 2} y={H - 6} textAnchor="middle">{t}</text>)}
      </svg>
      <p className="hint" style={{ marginTop: 4 }}>Horizontal axis: sampled rank r̃ of the relevant item among itself and the m negatives. Bars: share of draws.</p>
      <div className="tiles sim-tiles">
        <div className="tile"><div className="num">{res.expected.toFixed(2)}</div><div className="cap">theory: E[r̃] = 1 + m(r − 1)/(n − 1)</div></div>
        <div className="tile"><div className="num">{res.mean.toFixed(2)}</div><div className="cap">simulated mean r̃ (±{(1.96 * res.se).toFixed(2)})</div></div>
        <div className="tile"><div className="num">{pct(res.pHit)}</div><div className="cap">P(sampled hit@10); exact hit@10 is {res.r <= 10 ? 'yes' : 'no'}</div></div>
        <div className="tile"><div className="num">{f3(res.sampledNdcg)}</div><div className="cap">sampled NDCG@10 vs exact {f3(res.exactNdcg)}</div></div>
        <div className="tile"><div className="num">{f3(res.correctedNdcg)}</div><div className="cap">corrected NDCG@10</div></div>
        <div className="tile"><div className="num">{fmt(res.meanRhat)}</div><div className="cap">mean corrected rank r̂ (true r {fmt(res.r)})</div></div>
      </div>
      <p className="hint" style={{ marginTop: 12 }}>
        The correction is unbiased for the rank itself, but it is coarse: any r̃ ≥ 2 maps to r̂ = {correctedRank(2, res.n, res.m).toFixed(1)} or worse, so corrected NDCG@10 is non-zero only when the item beats every sampled negative.
      </p>
    </section>
  );
}

function Leaderboard() {
  const [metric, setMetric] = useState('ndcg');
  const rows = METRICS.filter((r) => r.arm === ARM).sort((a, b) => b[metric] - a[metric]);
  const hasCi = metric === 'ndcg';
  const max = Math.max(...rows.map((r) => (hasCi ? r.ndcg_ci_hi : r[metric])));
  const W = 720, rowH = 40, H = rows.length * rowH + 30, l = 100, rr = 70;
  const x = (v) => l + (v / max) * (W - l - rr);
  const label = { ndcg: 'NDCG@10', recall: 'Recall@10', mrr: 'MRR@10', hr: 'HR@10' };
  return (
    <section id="board" className="card window reveal" data-title="arm_metrics.csv — Leaderboard">
      <div className="head">
        <div>
          <p className="eyebrow">Recorded · {ARM_LABEL[ARM]} · exact metrics</p>
          <h2>On the full ranking, the three best rankers sit inside each other's <em>intervals</em>.</h2>
          <p className="sub">Exact metrics over the full catalogue, {fmt(N_USERS)} test users with at least one first-time positive. Whiskers are the per-user bootstrap 95% interval ({fmt(FACTS.nBoot)} resamples), recorded for NDCG@10 only.</p>
        </div>
        <Recorded src="tables/arm_metrics.csv" />
      </div>
      <Seg label="Metric" value={metric} onChange={setMetric} options={Object.entries(label)} />
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label[metric]} by ranker`} style={{ marginTop: 12 }}>
        {rows.map((r, i) => (
          <g key={r.ranker} transform={`translate(0 ${i * rowH + 16})`}>
            <text x={l - 10} y={5} textAnchor="end" style={{ fill: 'var(--text)', fontSize: 13 }}>{r.ranker}</text>
            <rect x={l} y={-11} width={Math.max(1, x(r[metric]) - l)} height={22} rx="6" fill={colorOf(r.ranker)} opacity="0.8" />
            {hasCi && <g stroke="var(--text)" strokeWidth="1.5"><line x1={x(r.ndcg_ci_lo)} x2={x(r.ndcg_ci_hi)} y1={0} y2={0} /><line x1={x(r.ndcg_ci_lo)} x2={x(r.ndcg_ci_lo)} y1={-6} y2={6} /><line x1={x(r.ndcg_ci_hi)} x2={x(r.ndcg_ci_hi)} y1={-6} y2={6} /></g>}
            <text x={x(hasCi ? r.ndcg_ci_hi : r[metric]) + 8} y={5} style={{ fill: 'var(--text)' }}>{f4(r[metric])}</text>
          </g>
        ))}
      </svg>
      {!hasCi && <p className="hint">No interval is recorded for {label[metric]}, so none is drawn.</p>}
    </section>
  );
}

function Holm() {
  const [alpha, setAlpha] = useState('0.05');
  const rows = PAIRWISE.filter((r) => r.arm === ARM);
  const recomputed = holmAdjust(rows.map((r) => r.p_two_sided));
  const lo = Math.min(...rows.map((r) => r.ci_lo), 0), hi = Math.max(...rows.map((r) => r.ci_hi));
  const W = 720, rowH = 32, H = rows.length * rowH + 30, l = 170, rr = 16;
  const x = (v) => l + ((v - lo) / (hi - lo)) * (W - l - rr);
  const pTxt = (p) => (p === 0 ? `0 (no resample crossed 0)` : p.toFixed(3));
  return (
    <section id="holm" className="card window reveal" data-title="pairwise.csv — Holm table">
      <div className="head">
        <div>
          <p className="eyebrow">Recorded p values · Holm recomputed live</p>
          <h2>Only the gaps to iALS <em>survive</em> the multiple-comparison correction.</h2>
          <p className="sub">Paired per-user bootstrap differences in exact NDCG@10 ({fmt(rows[0]?.n_users)} users). Your browser reruns <a href={blob('src/stats.py')}>holm_adjust</a> on the recorded two-sided p values and checks the result against the committed p_holm column.</p>
        </div>
        <Recorded src="tables/pairwise.csv" />
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Paired NDCG@10 differences with 95% bootstrap intervals">
        <line x1={x(0)} x2={x(0)} y1={4} y2={H - 22} stroke="var(--text)" strokeOpacity="0.5" />
        {rows.map((r, i) => (
          <g key={i} transform={`translate(0 ${i * rowH + 16})`}>
            <text x={l - 10} y={4} textAnchor="end" style={{ fill: 'var(--text)', fontSize: 12.5 }}>{r.ranker_a} − {r.ranker_b}</text>
            <line x1={x(r.ci_lo)} x2={x(r.ci_hi)} y1={0} y2={0} stroke={r.ci_lo > 0 ? 'var(--good)' : 'var(--muted)'} strokeWidth="3" strokeLinecap="round" />
            <circle cx={x(r.mean_diff_a_minus_b)} cy={0} r="5" fill={r.ci_lo > 0 ? 'var(--good)' : 'var(--muted)'} />
          </g>
        ))}
        {[lo, 0, hi].map((t) => <text key={t} x={x(t)} y={H - 6} textAnchor="middle">{t.toFixed(3)}</text>)}
      </svg>
      <div className="actions" style={{ marginTop: 8, marginBottom: 8 }}>
        <span className="hint">Family-wise α:</span>
        <Seg label="Family-wise alpha" value={alpha} onChange={setAlpha} options={[['0.01', '0.01'], ['0.05', '0.05'], ['0.10', '0.10']]} />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Pair</th><th>Mean diff</th><th>95% CI</th><th>p (two-sided)</th><th>p Holm, recorded</th><th>p Holm, browser</th><th>At α {alpha}</th></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const match = Math.abs(recomputed[i] - r.p_holm) < 1e-12;
              return (
                <tr key={i}><td>{r.ranker_a} − {r.ranker_b}</td><td>{f4(r.mean_diff_a_minus_b)}</td><td>{f4(r.ci_lo)} to {f4(r.ci_hi)}</td>
                  <td>{pTxt(r.p_two_sided)}</td><td>{r.p_holm.toFixed(3)}</td><td className={match ? 'ok' : 'no'}>{recomputed[i].toFixed(3)} {match ? '✓' : '✗'}</td>
                  <td>{recomputed[i] < +alpha ? <span className="pill good">Differs</span> : <span className="pill warn">Not shown</span>}</td></tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Popularity() {
  const opts = [['top1pct_share', 'Top-1% share'], ['top10pct_share', 'Top-10% share'], ['gini', 'Gini'], ['coverage', 'Coverage@10'], ['long_tail_share', 'Long-tail share']];
  const [k, setK] = useState('top1pct_share');
  const rows = POP.filter((r) => r.arm === ARM);
  return (
    <section id="pop" className="card window reveal" data-title="popularity_report.csv — Head-heaviness">
      <div className="head">
        <div>
          <p className="eyebrow">Recorded · {ARM_LABEL[ARM]} · top-10 lists</p>
          <h2>The best exact scorer is also the most <em>head-heavy</em>.</h2>
          <p className="sub">Shares of all recommendations going to the most-exposed items (by training exposure), Gini of item exposure, catalogue coverage, and long-tail share (bottom 80% of items). {fmt(rows[0]?.n_recommendations)} recommendations per ranker; POOLED combines all five.</p>
        </div>
        <Recorded src="tables/popularity_report.csv" />
      </div>
      <Seg label="Concentration measure" value={k} onChange={setK} options={opts} />
      <div className="bars" style={{ marginTop: 16 }}>
        {rows.map((r) => (
          <div className="bar-row" key={r.ranker}>
            <div className="lab"><span>{r.ranker}</span><b>{pct(r[k])}</b></div>
            <div className="track"><div className="fill" style={{ width: `${Math.min(100, r[k] * 100)}%`, background: r.ranker === 'POOLED' ? 'var(--muted)' : colorOf(r.ranker) }} /></div>
          </div>
        ))}
      </div>
      <p className="hint" style={{ marginTop: 12 }}>Scale 0 to 100%. H6 (head-heaviness) is frozen on Arm F, whose pooled share includes the void learned-ranker lists, so this is context, not its verdict.</p>
    </section>
  );
}

function ColdStart() {
  const [metric, setMetric] = useState('ndcg');
  const full = METRICS.filter((r) => r.arm === ARM);
  const slices = [['full', 'Full test set', full], ...['user_cold', 'item_cold'].map((s) => [s, s === 'user_cold' ? 'User-cold' : 'Item-cold', COLD.filter((r) => r.arm === ARM && r.slice === s)])];
  const n = Object.fromEntries(slices.map(([k, , rows]) => [k, rows[0]?.n_users]));
  const names = full.map((r) => r.ranker);
  const max = Math.max(...slices.flatMap(([, , rows]) => rows.map((r) => r[metric])));
  const W = 720, H = 260, pad = { l: 44, r: 8, t: 12, b: 40 }, gw = (W - pad.l - pad.r) / names.length, bw = gw / 4;
  const y = (v) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const shade = { full: 1, user_cold: 0.6, item_cold: 0.3 };
  return (
    <section id="cold" className="card window reveal" data-title="cold_start.csv — Cold slices">
      <div className="head">
        <div>
          <p className="eyebrow">Recorded · {ARM_LABEL[ARM]}</p>
          <h2>Cold users lean on popularity. Cold items get <em>nothing</em> from anyone.</h2>
          <p className="sub">
            User-cold: fewer than 5 training events ({n.user_cold} users). Item-cold: test positives whose item had fewer than 5 training exposures ({n.item_cold} users). Full set: {fmt(n.full)} users.
            Every ranker scores exactly 0 on the item-cold slice. That is a known limit, not a bug to hide: all five rankers learn from training interactions, and items with almost none are not ranked into anyone's top 10.
          </p>
        </div>
        <Recorded src="tables/cold_start.csv" />
      </div>
      <Seg label="Cold-start metric" value={metric} onChange={setMetric} options={[['ndcg', 'NDCG@10'], ['recall', 'Recall@10'], ['mrr', 'MRR@10']]} />
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${metric} on the full test set and the cold-start slices`} style={{ marginTop: 12 }}>
        <line className="axis" x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} />
        <text x={pad.l - 6} y={y(max) + 4} textAnchor="end">{max.toFixed(2)}</text><text x={pad.l - 6} y={y(0) + 4} textAnchor="end">0</text>
        {names.map((name, g) => (
          <g key={name}>
            {slices.map(([k, , rows], j) => {
              const v = rows.find((r) => r.ranker === name)?.[metric] ?? 0;
              const bx = pad.l + g * gw + bw * 0.5 + j * bw;
              return <g key={k}><rect x={bx} y={y(v)} width={bw - 3} height={Math.max(0, y(0) - y(v))} rx="3" fill={colorOf(name)} opacity={shade[k]} />{v === 0 && <text x={bx + (bw - 3) / 2} y={y(0) - 4} textAnchor="middle">0</text>}</g>;
            })}
            <text x={pad.l + g * gw + gw / 2} y={H - 18} textAnchor="middle" style={{ fill: 'var(--text)', fontSize: 12.5 }}>{name}</text>
          </g>
        ))}
      </svg>
      <div className="legend">{slices.map(([k, l]) => <span key={k}><i style={{ background: 'var(--text)', opacity: shade[k] }} />{l}</span>)}</div>
    </section>
  );
}

function Tuning() {
  const [ds, setDs] = useState('ml1m');
  const rows = table(`tuning_arm_t_${ds}.csv`);
  const cfgMap = chosen[`arm_t_${ds}`];
  const same = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => Number(b[k]) === Number(v));
  const max = Math.max(...rows.map((r) => r.val_ndcg));
  const groups = [...new Set(rows.map((r) => r.ranker))];
  return (
    <section id="tuning" className="card window reveal" data-title={`tuning_arm_t_${ds}.csv — Validation grids`}>
      <div className="head">
        <div>
          <p className="eyebrow">Recorded · validation window only</p>
          <h2>The frozen grids, every trial shown, the <em>chosen</em> config marked.</h2>
          <p className="sub">
            Selection metric: validation NDCG@10. {cfgMap ? 'The chosen config comes from chosen_configs.json.' : 'chosen_configs.json holds no entry for this arm yet, so the best trial is marked as the grid argmax, not as a chosen config.'}
          </p>
        </div>
        <Seg label="Dataset" value={ds} onChange={setDs} options={[['ml1m', 'MovieLens-1M'], ['kuairec', 'KuaiRec big']]} />
      </div>
      <div className="tuning-grid">
        {groups.map((g) => {
          const gr = rows.filter((r) => r.ranker === g);
          const best = Math.max(...gr.map((r) => r.val_ndcg));
          return (
            <div key={g} className="tile">
              <h3>{g}</h3>
              <div className="bars" style={{ marginTop: 10, gap: 8 }}>
                {gr.map((r) => {
                  const cfg = JSON.parse(r.config);
                  const isChosen = cfgMap?.[g] ? same(cfgMap[g], cfg) : r.val_ndcg === best;
                  return (
                    <div className="bar-row" key={r.config}>
                      <div className="lab"><span className="mono">{Object.entries(cfg).map(([k, v]) => `${k}=${v}`).join(' ')}</span><b>{f4(r.val_ndcg)}{isChosen ? (cfgMap ? ' ★ chosen' : ' ★ argmax') : ''}</b></div>
                      <div className="track"><div className="fill" style={{ width: `${(r.val_ndcg / max) * 100}%`, background: isChosen ? colorOf(g) : 'var(--muted)', opacity: isChosen ? 1 : 0.45 }} /></div>
                      <div className="hint">fit {r.fit_seconds.toFixed(1)} s</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function OffPolicy() {
  const world = useMemo(() => syntheticWorld({ seed: 0 }), []);
  const [gamma, setGamma] = useState(String(FACTS.gammas[FACTS.gammas.length - 1]));
  const [prop, setProp] = useState('true');
  const [draws, setDraws] = useState(100);
  const [seed, setSeed] = useState(1);
  const dg = useDeferredValue(gamma), dp = useDeferredValue(prop), dd = useDeferredValue(draws), ds = useDeferredValue(seed);
  const res = useMemo(() => simulateOffPolicy({ world, gamma: +dg, estimated: dp === 'est', draws: dd, seed: ds }), [world, dg, dp, dd, ds]);
  const est = [['naive', 'Naive', 'var(--bad)'], ['ips', 'IPS', 'var(--warn)'], ['snips', 'SNIPS', 'var(--good)']];
  const max = Math.max(...res.truth, ...est.flatMap(([e]) => res.summary[e].perRanker.map((r) => r.mean))) * 1.08;
  const W = 720, rowH = 40, H = res.names.length * rowH + 34, l = 150, rr = 16;
  const x = (v) => l + (v / max) * (W - l - rr);
  return (
    <section id="ips" className="card window reveal" data-title="ips.sim — Off-policy playground">
      <div className="head">
        <div>
          <p className="eyebrow">Live · synthetic world · not KuaiRec, not an Arm F result</p>
          <h2>On biased logs, naive scoring <em>reorders</em> the rankers. Reweighting recovers most of the truth.</h2>
          <p className="sub">
            A small synthetic world ({world.users} users × {world.items} items, fully known relevance) with {res.names.length} rankers of different popularity tilt.
            Exposure is drawn as Bernoulli(p_i) with p_i = max({FACTS.floor}, c·(n_i/n_max)^γ), mean {FACTS.density} before the floor, ported from <a href={blob('src/correction.py')}>make_propensities</a>.
            Naive, IPS and SNIPS see only the exposed cells; the truth sees all of them. The KuaiRec exposure arm that tests H4a, H4b and S1 has run, but those verdicts rest partly on the void Arm F lists (RESULTS.md).
          </p>
        </div>
        <span className="pill warn">Synthetic</span>
      </div>
      <div className="controls">
        <div className="field"><span className="flabel">Popularity bias γ (PREREG values)</span><Seg label="Popularity bias gamma" value={gamma} onChange={setGamma} options={FACTS.gammas.map((g) => [String(g), g === 0 ? '0 · uniform' : String(g)])} /></div>
        <div className="field"><span className="flabel">Propensities (estimated = count / users)</span><Seg label="Propensities" value={prop} onChange={setProp} options={[['true', 'True'], ['est', 'Estimated']]} /></div>
        <Range label="Exposure draws" value={draws} min={20} max={300} step={10} onChange={setDraws} show={draws} />
        <div className="field"><label htmlFor="ips-seed">Seed</label><input id="ips-seed" type="number" value={seed} onChange={(e) => setSeed(+e.target.value || 1)} /></div>
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Mean estimated DCG@10 per ranker for naive, IPS and SNIPS against the true value">
        {[0, 0.5, 1].map((t) => t * max).map((t) => <g key={t}><line className="axis" x1={x(t)} x2={x(t)} y1={8} y2={H - 22} /><text x={x(t)} y={H - 6} textAnchor="middle">{t.toFixed(2)}</text></g>)}
        {res.names.map((name, i) => (
          <g key={name} transform={`translate(0 ${i * rowH + 24})`}>
            <text x={l - 10} y={4} textAnchor="end" style={{ fill: 'var(--text)', fontSize: 12.5 }}>{name}</text>
            <rect x={x(res.truth[i]) - 2} y={-12} width="4" height="24" rx="2" fill="var(--text)" />
            {est.map(([e, , c], j) => <circle key={e} cx={x(res.summary[e].perRanker[i].mean)} cy={(j - 1) * 6} r="5" fill={c} opacity="0.9" />)}
          </g>
        ))}
      </svg>
      <div className="legend"><span><i style={{ background: 'var(--text)' }} />True mean DCG@10</span>{est.map(([e, l, c]) => <span key={e}><i style={{ background: c }} />{l} (mean over {res.draws} draws)</span>)}</div>
      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table>
          <thead><tr><th>Estimator</th><th>Mean |bias|</th><th>Mean RMSE</th><th>Kendall τ_b vs true order</th></tr></thead>
          <tbody>
            {est.map(([e, l]) => {
              const pr = res.summary[e].perRanker;
              return <tr key={e}><td>{l}</td><td>{f4(pr.reduce((s, r) => s + Math.abs(r.bias), 0) / pr.length)}</td><td>{f4(pr.reduce((s, r) => s + r.rmse, 0) / pr.length)}</td><td>{res.summary[e].tau.toFixed(3)}</td></tr>;
            })}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 8 }}>τ_b is averaged over draws, ported from <a href={blob('src/stats.py')}>kendall_tau_b</a>. The build check asserts that IPS with true propensities lands within 3 standard errors of the truth and that naive sits below it, as tests/test_correction.py does.</p>
    </section>
  );
}

function Audit() {
  const sets = [['kuairec_big', 'KuaiRec big'], ['kuairec_small', 'KuaiRec small'], ['ml1m', 'MovieLens-1M']];
  const af = audit.arm_f;
  const poolPct = af.big_events_on_small_items_frac_before_small_min * 100;
  const W = 720, rowH = 64, H = sets.length * rowH + 10, l = 120, rr = 20;
  const markOf = (k) => (k === 'kuairec_small' ? [[af.small_ts_min, 'T_s'], [af.small_ts_median, 'median']] : [[audit[k].ts_q80, 'T1'], [audit[k].ts_q90, 'T2']]);
  return (
    <section id="audit" className="card window reveal" data-title="data_audit.json — Data & splits">
      <div className="head">
        <div>
          <p className="eyebrow">Recorded · audit A1 to A4</p>
          <h2>Checksums, counts and the <em>cut points</em> frozen before modelling.</h2>
          <p className="sub">Only derived statistics are shown. Raw KuaiRec and MovieLens rows are never committed or shipped.</p>
        </div>
        <Recorded src="data_audit.json" />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Dataset</th><th>Rows</th><th>Users</th><th>Items</th><th>Positive rate</th><th>Users with no positive</th></tr></thead>
          <tbody>{sets.map(([k, t]) => <tr key={k}><td>{t}</td><td>{fmt(audit[k].rows)}</td><td>{fmt(audit[k].n_users)}</td><td>{fmt(audit[k].n_items)}</td><td>{pct(audit[k].positive_rate, 2)}</td><td>{audit[k].users_with_zero_positives}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="hint">SHA-256: {Object.entries(audit.files).map(([f, v]) => <span key={f}><span className="mono">{f}</span> {v.sha256.slice(0, 16)}… ({(v.bytes / 1e6).toFixed(1)} MB). </span>)}</p>
      <h3 style={{ marginTop: 16 }}>Timelines and cut points (each row on its own time axis)</h3>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Dataset time spans with the 80th and 90th percentile cut points">
        {sets.map(([k, t], i) => {
          const d = audit[k], x = (ts) => l + ((ts - d.ts_min) / (d.ts_max - d.ts_min)) * (W - l - rr);
          const marks = markOf(k);
          return (
            <g key={k} transform={`translate(0 ${i * rowH + 28})`}>
              <text x={l - 10} y={4} textAnchor="end" style={{ fill: 'var(--text)', fontSize: 12.5 }}>{t}</text>
              <rect x={l} y={-6} width={W - l - rr} height={12} rx="6" fill="var(--primary)" opacity="0.18" />
              {k !== 'kuairec_small' && <rect x={x(d.ts_q90)} y={-6} width={x(d.ts_max) - x(d.ts_q90)} height={12} rx="6" fill="var(--primary)" opacity="0.6" />}
              {marks.map(([ts, lab], j) => <g key={lab}><line x1={x(ts)} x2={x(ts)} y1={-12} y2={12} stroke="var(--text)" strokeWidth="2" /><text x={x(ts) + (j ? 4 : -4)} y={-16} textAnchor={j ? 'start' : 'end'} style={{ fill: 'var(--text)' }}>{lab}</text></g>)}
              <text x={l} y={26}>{day(d.ts_min)}</text><text x={W - rr} y={26} textAnchor="end">{day(d.ts_max)}</text>
            </g>
          );
        })}
      </svg>
      <p className="hint">Train t &lt; T1 (80th percentile), validation T1 ≤ t &lt; T2 (90th percentile), test t ≥ T2 (dark segment). KuaiRec small has no split: it is the fully observed Arm F truth, and T_s is its earliest timestamp.
        {' '}{sets.map(([k, t]) => `${t}: ${markOf(k).map(([ts, lab]) => `${lab} ${day(ts)}`).join(', ')}.`).join(' ')}</p>
      <div className="grid2" style={{ marginTop: 16, alignItems: 'start' }}>
        <div className="tile">
          <h3>Arm F training rule</h3>
          <p className="hint" style={{ margin: '6px 0 0' }}>
            The strict rule needs at least {FACTS.strictRulePct}% of the training pool (big-matrix events on small-matrix items) before T_s. Measured: {poolPct.toFixed(4)}% ({fmt(af.big_events_on_small_items)} pool events),
            so the frozen fallback applies: train on the whole pool, label the arm time-overlapping, and add a sensitivity arm trained before the small-matrix median ({pct(af.big_events_on_small_items_frac_before_small_median, 1)} of the pool).
            Small-matrix pairs found in the big matrix: {af.small_pairs_present_in_big} of {fmt(af.small_pairs_total)}.
            The fresh pass trained on {fmt(armFMeta.pool_events)} pool events ({fmt(armFMeta.pool_positive_cells)} positive cells); RESULTS.md shows none of them belong to the {fmt(ARM_F_USERS)} target users, so the learned rankers score from empty histories.
          </p>
        </div>
        <div className="tile" style={{ minWidth: 0 }}>
          <h3>timings.csv</h3>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Arm</th><th>Ranker</th><th>Stage</th><th>Seconds</th><th>Peak MB</th></tr></thead>
              <tbody>{TIMINGS.map((t, i) => <tr key={i}><td className="mono">{t.arm}</td><td>{t.ranker}</td><td className="mono">{t.stage}</td><td>{t.seconds < 0.01 ? t.seconds.toExponential(1) : t.seconds.toFixed(2)}</td><td>{fmt(t.peak_mb)}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="hint" style={{ margin: '6px 0 0' }}>Machine of record: {MACHINE}, named in RESULTS.md with its CPU, RAM and library versions. iALS rows time five seed fits together.</p>
        </div>
      </div>
    </section>
  );
}

function Limits() {
  const guard = section(prereg, 'Overclaim guard').replace(/\s+/g, ' ');
  const itemCold = COLD.filter((r) => r.arm === ARM && r.slice === 'item_cold');
  const items = [
    ['Arm F learned rankers are void', `KuaiRec's small and big matrices share ${audit.arm_f.small_pairs_present_in_big} of ${fmt(audit.arm_f.small_pairs_total)} pairs, so the frozen D5 pool (big-matrix events on small-matrix items) leaves all ${fmt(ARM_F_USERS)} target users with an empty history. ItemKNN, EASE and iALS then return all-zero scores; their Arm F rows are tie-break artifacts and ${N_VOID} verdicts that use them are not usable. Fixing it needs a new protocol decision, not a patch (RESULTS.md).`],
    ['Replication, not verdict', `The reversal is MovieLens-1M (${fmt(N_USERS)} users, ${SUMMARY.seeds.length} sampling seeds). H2a and H2b are frozen on Arm F, so the reversal shown here neither confirms nor refutes them.`],
    ['One pass, one machine', `Every table comes from the single D13 pass on ${MACHINE}. Nothing has been rerun independently, and the audit (AUDIT.md) is the author's own.`],
    ['Missing uncertainty', 'No bootstrap interval is recorded for the sampled-versus-exact gaps or for the flip rates; arm_metrics.csv carries an interval for NDCG@10 only.'],
    ['Degenerate slice', `The ML-1M item-cold slice holds ${itemCold[0]?.n_users} users and every ranker scores ${itemCold.every((r) => r.ndcg === 0) ? 'exactly 0' : 'near 0'}. It cannot rank models.`],
    ['Synthetic simulators', 'The off-policy playground uses a synthetic matrix and the rank simulator a single synthetic user. Neither is KuaiRec data or an Arm F result.'],
    ['No literature claim', 'A short related-work note now exists (docs/related_work.md) but it is not a systematic review, so PREREG section 9 still bars novelty claims.'],
  ];
  return (
    <section id="limits" className="card window reveal" data-title="threats.md — Limits and overclaim guard">
      <p className="eyebrow">Threats to validity</p>
      <h2>What this page <em>cannot</em> tell you.</h2>
      <div className="grid2" style={{ marginTop: 16 }}>
        {items.map(([t, d]) => <div className="tile" key={t}><h3>{t}</h3><p className="hint" style={{ margin: '6px 0 0', fontSize: 13 }}>{d}</p></div>)}
      </div>
      <h3 style={{ marginTop: 20 }}>Overclaim guard (PREREG section 9, verbatim)</h3>
      <blockquote className="guard">{guard}</blockquote>
    </section>
  );
}

function Decisions() {
  const ds = parseDecisions(decisionsMd);
  return (
    <section id="decisions" className="card window reveal" data-title="decisions.md — Judgement calls">
      <p className="eyebrow">Decision log</p>
      <h2>{ds.length} judgement calls, <em>recorded</em> in the open.</h2>
      <p className="sub">Read from <a href={blob('DECISIONS.md')}>DECISIONS.md</a> at build time. Open any entry for the full text.</p>
      <div className="decisions">
        {ds.map((d) => (
          <details key={d.id}>
            <summary><span className="mono">{d.id}</span> {d.title}</summary>
            <p className="hint">{d.body}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
