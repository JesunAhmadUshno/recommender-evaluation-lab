// Parsers for the committed results/ files and the study's markdown. Pure functions of
// text, so the page (Vite ?raw imports) and the build check (fs reads) share them.

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c !== '')) rows.push(row);
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, j) => {
    const v = r[j] ?? '';
    return [h, v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v];
  })));
}

// Seed means and per-pair flip counts, mirroring experiments/run_all.py _pair_flip_counts.
export function sampledSummary(armMetrics, sampled, arm) {
  const exact = Object.fromEntries(armMetrics.filter((r) => r.arm === arm).map((r) => [r.ranker, r.ndcg]));
  const names = Object.keys(exact);
  const rows = sampled.filter((r) => r.arm === arm);
  const seeds = [...new Set(rows.map((r) => r.seed))].sort((a, b) => a - b);
  const per = (col) => seeds.map((s) => Object.fromEntries(rows.filter((r) => r.seed === s).map((r) => [r.ranker, r[col]])));
  const perSampled = per('sampled_ndcg'), perCorrected = per('corrected_ndcg');
  const mean = (perSeed, name) => perSeed.reduce((acc, v) => acc + v[name], 0) / perSeed.length;
  const rankers = names.map((name) => ({
    name, exact: exact[name],
    sampled: mean(perSampled, name), corrected: mean(perCorrected, name),
    sampledSeeds: perSampled.map((v) => v[name]), correctedSeeds: perCorrected.map((v) => v[name]),
  }));
  const pairs = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = names[i], b = names[j], ex = exact[a] - exact[b];
    const flips = (perSeed) => perSeed.filter((v) => (v[a] - v[b]) * ex < 0).length;
    pairs.push({ a, b, sampledFlips: flips(perSampled), correctedFlips: flips(perCorrected), seeds: seeds.length });
  }
  return { rankers, pairs, seeds };
}

export function parseHeadline(md) {
  return md.trim().split('\n').slice(2).map((l) => {
    const c = l.split('|').slice(1, -1).map((s) => s.trim());
    return { arm: c[0], ranker: c[1], n: +c[2], exact: +c[3], sampled: +c[4], corrected: +c[5] };
  });
}

// Body text of a "## N. Title" section.
export function section(md, title) {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.startsWith('## ') && l.includes(title));
  if (start < 0) return '';
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}

// PREREG section 6 bullets: "- H1. Title. SUPPORTED if ..." -> { id, title, rule }.
export function parseHypotheses(prereg) {
  const body = section(prereg, 'Hypotheses and frozen verdict rules');
  const items = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^- (H\d[ab]?|S\d)(?: \(([^)]*)\))?\. (.*)$/);
    if (m) items.push({ id: m[1], note: m[2], text: m[3] });
    else if (items.length && line.startsWith('  ')) items[items.length - 1].text += ' ' + line.trim();
  }
  return items.map(({ id, note, text }) => {
    if (note) return { id, title: note[0].toUpperCase() + note.slice(1), rule: text };
    const cut = text.search(/\. (SUPPORTED|SUBSTITUTED|Slice)/);
    return cut < 0 ? { id, title: text, rule: '' } : { id, title: text.slice(0, cut), rule: text.slice(cut + 2) };
  });
}

// DECISIONS.md "## D1. Title" entries.
export function parseDecisions(md) {
  return md.split('\n## ').slice(1).map((chunk) => {
    const [head, ...rest] = chunk.split('\n');
    const m = head.match(/^(D\d+)\. (.*)$/);
    return m && { id: m[1], title: m[2], body: rest.join(' ').replace(/\s+/g, ' ').trim() };
  }).filter(Boolean);
}

// Protocol constants quoted from PREREG text, so the page never retypes them.
export function preregFacts(prereg) {
  const grab = (re) => {
    const m = prereg.match(re);
    if (!m) throw new Error(`PREREG pattern not found: ${re}`);
    return Number(m[1].replace(/,/g, ''));
  };
  return {
    m: grab(/m = (\d+)\s+negatives/),
    strictRulePct: grab(/at least (\d+)\s+percent of that pool/),
    nBoot: grab(/paired bootstrap,\s+([\d,]+)\s+resamples/),
    floor: grab(/p_i = max\((\d\.\d+),/),
    density: grab(/big-matrix density (\d\.\d+)/),
    gammas: (prereg.match(/gamma in\s+\{([^}]*)\}/)?.[1].match(/\d+(\.\d+)?/g) || []).map(Number),
  };
}
