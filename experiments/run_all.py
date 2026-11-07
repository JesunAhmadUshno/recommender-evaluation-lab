"""Full pipeline driver. Stages:

  audit   descriptive data audit -> results/data_audit.json
  arm_t   KuaiRec big matrix, global-time split (Arm T)
  arm_f   KuaiRec small matrix, fully observed truth (Arm F) + exposure arm
  ml1m    MovieLens-1M, same temporal protocol (replication)
  random  random-split arm (leakage comparison) for KuaiRec big + ML-1M
  verdicts  frozen-rule verdicts from the committed tables -> verdicts.json

Every number in RESULTS.md traces to a CSV written here. Thread use is
capped (OMP_NUM_THREADS=2) because the VM is shared.
"""
from __future__ import annotations

import argparse
import csv
import json
import resource
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src import audit as audit_mod  # noqa: E402
from src import correction, metrics, split as split_mod  # noqa: E402
from src.dataio import binary_matrix, load_kuairec, load_ml1m, pair_keys  # noqa: E402
from src.rankers import EASE, IALS, ItemKNN, Popularity, RandomRanker, mask_seen  # noqa: E402
from src.stats import holm_adjust, kendall_tau_b, paired_bootstrap  # noqa: E402

RAW = ROOT / "data" / "raw"
RESULTS = ROOT / "results"
TABLES = RESULTS / "tables"
CACHE = RAW / "cache"

RANKER_ORDER = ["Random", "Popularity", "ItemKNN", "EASE", "iALS"]
SAMPLING_SEEDS = list(range(10))
EXPOSURE_SEEDS = list(range(10))
IALS_SEEDS = list(range(5))
SPLIT_SEEDS = list(range(5))
BOOT = 2000

# Frozen grids (PREREG section 3). Validation window only.
GRIDS = {
    "ItemKNN": [{"k": k, "shrink": s} for k in (50, 100) for s in (0.0, 50.0)],
    "EASE": [{"lam": v} for v in (10.0, 50.0, 100.0, 250.0, 500.0)],
    "iALS": ([{"factors": f, "reg": r, "alpha": 10.0, "iterations": 10}
              for f in (32, 64, 128) for r in (0.1, 1.0)]
             + [{"factors": 64, "reg": 0.1, "alpha": a, "iterations": 10} for a in (1.0, 40.0)]),
}
FINAL_IALS_ITERATIONS = 15


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def peak_mb() -> float:
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0


def write_csv(name: str, rows: list[dict]) -> None:
    TABLES.mkdir(parents=True, exist_ok=True)
    if not rows:
        return
    path = TABLES / name
    fields: list[str] = []
    for r in rows:
        for k in r:
            if k not in fields:
                fields.append(k)
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    log(f"wrote {path} ({len(rows)} rows)")


def load_cached(name: str, loader, path: str) -> dict:
    CACHE.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE / f"{name}.npz"
    if cache_file.exists():
        z = np.load(cache_file)
        d = {k: z[k] for k in z.files}
        d["n_users"] = int(d["n_users"])
        d["n_items"] = int(d["n_items"])
        return d
    d = loader(path)
    np.savez(cache_file, **{k: v for k, v in d.items()})
    return d


def load_all() -> tuple[dict, dict, dict]:
    big = load_cached("kuairec_big", load_kuairec, str(RAW / "big_matrix.csv"))
    small = load_cached("kuairec_small", load_kuairec, str(RAW / "small_matrix.csv"))
    ml = load_cached("ml1m", load_ml1m, str(RAW / "ml-1m" / "ratings.dat"))
    return big, small, ml


def make_ranker(name: str, config: dict, seed: int = 0):
    if name == "Random":
        return RandomRanker(seed=seed)
    if name == "Popularity":
        return Popularity()
    if name == "ItemKNN":
        return ItemKNN(**config)
    if name == "EASE":
        return EASE(**config)
    if name == "iALS":
        return IALS(seed=seed, **config)
    raise KeyError(name)


def score_ranker(model, name: str, users: np.ndarray, X_hist: np.ndarray) -> np.ndarray:
    if name == "EASE":
        return model.scores(users, X=X_hist)
    return model.scores(users)


def mean_ci(values: np.ndarray) -> tuple[float, float, float]:
    v = values[~np.isnan(values)]
    if v.size == 0:
        return float("nan"), float("nan"), float("nan")
    se = v.std(ddof=1) / np.sqrt(v.size) if v.size > 1 else 0.0
    return float(v.mean()), float(v.mean() - 1.96 * se), float(v.mean() + 1.96 * se)


class TemporalArm:
    """Shared Arm T protocol for KuaiRec big and MovieLens-1M."""

    def __init__(self, arm: str, d: dict, pos: np.ndarray):
        self.arm = arm
        self.d = d
        self.pos = pos
        ts = d["timestamp"]
        self.t1, self.t2 = split_mod.temporal_cutoffs(ts, 0.80, 0.90)
        self.tr_m, self.va_m, self.te_m = split_mod.temporal_masks(ts, self.t1, self.t2)
        self.X_train = binary_matrix(d["user"][self.tr_m & pos], d["item"][self.tr_m & pos],
                                     np.ones(int((self.tr_m & pos).sum())),
                                     d["n_users"], d["n_items"])
        self.exposure_train = np.bincount(d["item"][self.tr_m], minlength=d["n_items"]).astype(np.float64)
        self.user_train_counts = np.bincount(d["user"][self.tr_m], minlength=d["n_users"]).astype(np.float64)
        # Validation and test positives, first-time against all train events.
        self.val_rel, self.val_users = self._rel(self.va_m)
        self.test_rel, self.test_users = self._rel(self.te_m)

    def _rel(self, window_mask: np.ndarray):
        d = self.d
        cand = window_mask & self.pos
        first = split_mod.first_time_mask(d["user"][self.tr_m], d["item"][self.tr_m],
                                          d["user"][cand], d["item"][cand], d["n_items"])
        u = d["user"][cand][first]
        i = d["item"][cand][first]
        rel = binary_matrix(u, i, np.ones(u.size), d["n_users"], d["n_items"])
        users = np.unique(u)
        return rel, users

    def tune(self) -> tuple[dict, list[dict]]:
        rows: list[dict] = []
        chosen: dict[str, dict] = {"Random": {}, "Popularity": {}}
        val_rel = self.val_rel[self.val_users]
        X_val = self.X_train[self.val_users]
        for name, grid in GRIDS.items():
            best, best_val = None, -np.inf
            for cfg in grid:
                t0 = time.perf_counter()
                model = make_ranker(name, cfg)
                model.fit(self.X_train, self.exposure_train)
                scores = score_ranker(model, name, self.val_users, self.X_train)
                scores = mask_seen(scores, X_val)
                ndcg = np.nanmean(metrics.exact_per_user(scores, val_rel)["ndcg"])
                rows.append({"arm": self.arm, "ranker": name, "config": json.dumps(cfg),
                             "val_ndcg": float(ndcg), "fit_seconds": time.perf_counter() - t0})
                log(f"{self.arm} tune {name} {cfg} -> val NDCG {ndcg:.4f}")
                if ndcg > best_val:
                    best, best_val = cfg, float(ndcg)
            chosen[name] = best
        return chosen, rows

    def evaluate(self, chosen: dict):
        """Fit final models, score test users once, return (scores, per-user
        exact metrics, timing rows). iALS and Random metrics are averaged
        over their model seeds; their stored score matrix is the seed-mean
        (iALS) or seed 0 (Random) matrix used by the sampled protocol."""
        test_rel = self.test_rel[self.test_users]
        X_test = self.X_train[self.test_users]
        scores: dict[str, np.ndarray] = {}
        per_user: dict[str, dict] = {}
        timing_rows: list[dict] = []
        for name in RANKER_ORDER:
            if name == "Random":
                acc = []
                keep = None
                for s in range(5):
                    model = RandomRanker(seed=s).fit(self.X_train)
                    sc = mask_seen(model.scores(self.test_users), X_test)
                    if keep is None:
                        keep = sc
                    acc.append(metrics.exact_per_user(sc, test_rel))
                per_user[name] = {k: np.nanmean(np.vstack([a[k] for a in acc]), axis=0)
                                  for k in acc[0]}
                scores[name] = keep
                continue
            if name == "iALS":
                cfg = dict(chosen[name])
                cfg["iterations"] = FINAL_IALS_ITERATIONS
                acc = []
                sc_acc = None
                t_fit = 0.0
                for s in IALS_SEEDS:
                    t0 = time.perf_counter()
                    model = make_ranker(name, cfg, seed=s)
                    model.fit(self.X_train, self.exposure_train)
                    t_fit += time.perf_counter() - t0
                    sc = score_ranker(model, name, self.test_users, self.X_train)
                    sc_acc = sc if sc_acc is None else sc_acc + sc
                    acc.append(metrics.exact_per_user(mask_seen(sc, X_test), test_rel))
                per_user[name] = {k: np.nanmean(np.vstack([a[k] for a in acc]), axis=0)
                                  for k in acc[0]}
                scores[name] = mask_seen(sc_acc / len(IALS_SEEDS), X_test)
                timing_rows.append({"arm": self.arm, "ranker": name, "stage": "fit_x5seeds",
                                    "seconds": t_fit, "peak_mb": peak_mb()})
                continue
            cfg = chosen.get(name, {})
            t0 = time.perf_counter()
            model = make_ranker(name, cfg)
            model.fit(self.X_train, self.exposure_train)
            t_fit = time.perf_counter() - t0
            t0 = time.perf_counter()
            sc = mask_seen(score_ranker(model, name, self.test_users, self.X_train), X_test)
            t_score = time.perf_counter() - t0
            scores[name] = sc
            per_user[name] = metrics.exact_per_user(sc, test_rel)
            timing_rows.append({"arm": self.arm, "ranker": name, "stage": "fit",
                                "seconds": t_fit, "peak_mb": peak_mb()})
            timing_rows.append({"arm": self.arm, "ranker": name, "stage": "score_test",
                                "seconds": t_score, "peak_mb": peak_mb()})
        return scores, per_user, timing_rows


def arm_metric_rows(arm: str, per_user: dict[str, dict]) -> list[dict]:
    rows = []
    for name in RANKER_ORDER:
        pu = per_user[name]
        row = {"arm": arm, "ranker": name}
        for key in ("ndcg", "dcg", "recall", "mrr", "hr"):
            mean, lo, hi = mean_ci(pu[key])
            row[key] = mean
            if key == "ndcg":
                row["ndcg_ci_lo"], row["ndcg_ci_hi"] = lo, hi
        row["n_users"] = int((~np.isnan(pu["ndcg"])).sum())
        rows.append(row)
    return rows


def pairwise_rows(arm: str, per_user: dict[str, dict]) -> list[dict]:
    names = ["Popularity", "ItemKNN", "EASE", "iALS"]
    rows = []
    for a_i in range(len(names)):
        for b_i in range(a_i + 1, len(names)):
            a, b = names[a_i], names[b_i]
            x, y = per_user[a]["ndcg"], per_user[b]["ndcg"]
            ok = ~np.isnan(x) & ~np.isnan(y)
            res = paired_bootstrap(x[ok] - y[ok], n_boot=BOOT, seed=0)
            rows.append({"arm": arm, "ranker_a": a, "ranker_b": b,
                         "mean_diff_a_minus_b": res["mean"], "ci_lo": res["ci_lo"],
                         "ci_hi": res["ci_hi"], "one_sided_lo": res["one_sided_lo"],
                         "one_sided_hi": res["one_sided_hi"],
                         "p_two_sided": res["p_two_sided"], "n_users": int(ok.sum())})
    adj = holm_adjust([r["p_two_sided"] for r in rows])
    for r, p in zip(rows, adj):
        r["p_holm"] = p
    return rows


def sampled_rows(arm: str, scores: dict[str, np.ndarray], rel: np.ndarray,
                 n_items: int, exclude: np.ndarray | None = None) -> list[dict]:
    rows = []
    n_pos = (rel > 0).sum(axis=1)
    for name in RANKER_ORDER:
        for seed in SAMPLING_SEEDS:
            out = metrics.sampled_per_user(scores[name], rel, m=100, seed=seed,
                                           exclude=exclude)
            corr = metrics.corrected_ndcg(out["pos_ranks"], n_items=n_items, m=100,
                                          n_pos_per_user=n_pos)
            rows.append({"arm": arm, "ranker": name, "seed": seed,
                         "sampled_ndcg": float(np.nanmean(out["ndcg"])),
                         "corrected_ndcg": float(np.nanmean(corr))})
        log(f"{arm} sampled done: {name}")
    return rows


def popularity_rows(arm: str, scores: dict[str, np.ndarray],
                    exposure: np.ndarray) -> list[dict]:
    rows = []
    pooled = []
    for name in RANKER_ORDER:
        top = correction.topk_lists(scores[name], k=10)
        pooled.append(top)
        rep = audit_mod.popularity_report(top, exposure)
        rows.append({"arm": arm, "ranker": name, **rep})
    all_top = np.vstack(pooled)
    rep = audit_mod.popularity_report(all_top, exposure)
    rows.append({"arm": arm, "ranker": "POOLED", **rep})
    return rows


def cold_start_rows(arm: TemporalArm, scores: dict[str, np.ndarray]) -> list[dict]:
    rows = []
    test_rel = arm.test_rel[arm.test_users]
    item_counts = arm.exposure_train
    cold_items = item_counts < 5
    rel_slice = test_rel * cold_items[None, :]
    user_counts = arm.user_train_counts[arm.test_users]
    cold_users = user_counts < 5
    for slice_name, rel_s, user_sel in (
        ("item_cold", rel_slice, None),
        ("user_cold", test_rel, cold_users),
    ):
        for name in RANKER_ORDER:
            sc = scores[name]
            rel_use = rel_s
            if user_sel is not None:
                if user_sel.sum() == 0:
                    rows.append({"arm": arm.arm, "slice": slice_name, "ranker": name,
                                 "n_users": 0, "ndcg": None, "recall": None, "mrr": None})
                    continue
                sc = sc[user_sel]
                rel_use = rel_s[user_sel]
            pu = metrics.exact_per_user(sc, rel_use)
            rows.append({"arm": arm.arm, "slice": slice_name, "ranker": name,
                         "n_users": int((~np.isnan(pu["ndcg"])).sum()),
                         "ndcg": float(np.nanmean(pu["ndcg"])) if (~np.isnan(pu["ndcg"])).any() else None,
                         "recall": float(np.nanmean(pu["recall"])) if (~np.isnan(pu["recall"])).any() else None,
                         "mrr": float(np.nanmean(pu["mrr"])) if (~np.isnan(pu["mrr"])).any() else None})
    return rows


def stage_arm_t(arm_name: str, d: dict, pos: np.ndarray, chosen_out: dict) -> None:
    arm = TemporalArm(arm_name, d, pos)
    log(f"{arm_name}: cutoffs t1={arm.t1:.1f} t2={arm.t2:.1f}; "
        f"train {int(arm.tr_m.sum())} val {int(arm.va_m.sum())} test {int(arm.te_m.sum())}; "
        f"test users {arm.test_users.size}")
    chosen, tuning = arm.tune()
    chosen_out[arm_name] = chosen
    write_csv(f"tuning_{arm_name}.csv", tuning)
    scores, per_user, timing = arm.evaluate(chosen)
    write_csv("arm_metrics.csv", _merge_existing("arm_metrics.csv", arm_metric_rows(arm_name, per_user), "arm", arm_name))
    write_csv("pairwise.csv", _merge_existing("pairwise.csv", pairwise_rows(arm_name, per_user), "arm", arm_name))
    write_csv("timings.csv", _merge_existing("timings.csv", timing, "arm", arm_name))
    exclude = arm.X_train[arm.test_users] > 0
    srows = sampled_rows(arm_name, scores, arm.test_rel[arm.test_users], d["n_items"], exclude=exclude)
    write_csv("sampled_metrics.csv", _merge_existing("sampled_metrics.csv", srows, "arm", arm_name))
    prows = popularity_rows(arm_name, scores, arm.exposure_train)
    write_csv("popularity_report.csv", _merge_existing("popularity_report.csv", prows, "arm", arm_name))
    crows = cold_start_rows(arm, scores)
    write_csv("cold_start.csv", _merge_existing("cold_start.csv", crows, "arm", arm_name))
    if arm_name == "arm_t_kuairec":
        _leakage_check(arm)


def _merge_existing(name: str, new_rows: list[dict], key: str, value: str) -> list[dict]:
    path = TABLES / name
    old: list[dict] = []
    if path.exists():
        with open(path, newline="") as fh:
            old = [r for r in csv.DictReader(fh) if r.get(key) != value]
    return old + new_rows


def _leakage_check(arm: TemporalArm) -> None:
    d = arm.d
    tr = arm.tr_m
    te_pos = arm.te_m & arm.pos
    first = split_mod.first_time_mask(d["user"][tr], d["item"][tr],
                                      d["user"][te_pos], d["item"][te_pos], d["n_items"])
    tu, ti, tt = d["user"][te_pos][first], d["item"][te_pos][first], d["timestamp"][te_pos][first]
    clean = audit_mod.leakage_audit(d["user"][tr], d["item"][tr], tu, ti,
                                    d["timestamp"][tr], tt, d["n_items"])
    # Planted leak: copy one test pair into train with a post-test timestamp.
    pu = np.append(d["user"][tr], tu[0])
    pi = np.append(d["item"][tr], ti[0])
    pt = np.append(d["timestamp"][tr], tt[0] + 1000.0)
    planted = audit_mod.leakage_audit(pu, pi, tu, ti, pt, tt, d["n_items"])
    out = {"clean": clean, "planted": planted,
           "audit_flags_planted": bool(not planted["pair_overlap_ok"] or not planted["time_order_ok"])}
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "leakage_check.json").write_text(json.dumps(out, indent=2))
    log(f"leakage check: clean ok={clean['pair_overlap_ok'] and clean['time_order_ok']}, "
        f"planted flagged={out['audit_flags_planted']}")


def _small_maps(big: dict, small: dict):
    big_item_index = {int(v): i for i, v in enumerate(big["item_ids"])}
    big_user_index = {int(v): i for i, v in enumerate(big["user_ids"])}
    small_item_big = np.array([big_item_index[int(v)] for v in small["item_ids"]])
    small_user_big = np.array([big_user_index[int(v)] for v in small["user_ids"]])
    big2small_item = -np.ones(big["n_items"], dtype=np.int64)
    big2small_item[small_item_big] = np.arange(small["n_items"])
    return small_item_big, small_user_big, big2small_item


def _arm_f_pool(big: dict, small: dict, audit: dict):
    small_item_big, small_user_big, big2small_item = _small_maps(big, small)
    on_small = np.isin(big["item"], small_item_big)
    t_s = audit["arm_f"]["small_ts_min"]
    t_med = audit["arm_f"]["small_ts_median"]
    frac = audit["arm_f"]["big_events_on_small_items_frac_before_small_min"]
    if frac >= 0.20:
        pool_mask = on_small & (big["timestamp"] < t_s)
        rule = "strict (train on big events before the small matrix begins)"
    else:
        pool_mask = on_small
        rule = "fallback (time-overlapping: strict rule kept under 20 percent of the pool)"
    sens_mask = on_small & (big["timestamp"] < t_med)
    return pool_mask, sens_mask, rule, small_user_big, big2small_item


def _pool_matrices(big: dict, pool_mask: np.ndarray, big2small_item: np.ndarray):
    u = big["user"][pool_mask]
    i_small = big2small_item[big["item"][pool_mask]]
    ratio = big["watch_ratio"][pool_mask]
    pos = ratio > 2.0
    n_items = int(big2small_item.max()) + 1
    X = binary_matrix(u[pos], i_small[pos], np.ones(int(pos.sum())), big["n_users"], n_items)
    exposure = np.bincount(i_small, minlength=n_items).astype(np.float64)
    return X, exposure, (u, i_small, ratio)


def _fit_score_small(name: str, cfg: dict, X_pool: np.ndarray, exposure: np.ndarray,
                     small_user_big: np.ndarray, seed: int = 0,
                     iters: int | None = None) -> np.ndarray:
    n_small_users = small_user_big.size
    if name == "Random":
        model = RandomRanker(seed=seed).fit(X_pool)
        return model.scores(np.arange(n_small_users))
    if name == "iALS" and iters is not None:
        cfg = dict(cfg)
        cfg["iterations"] = iters
    model = make_ranker(name, cfg, seed=seed)
    model.fit(X_pool, exposure)
    if name == "EASE":
        return model.scores(small_user_big, X=X_pool)
    return model.scores(small_user_big)


def stage_arm_f(big: dict, small: dict, audit: dict, chosen: dict) -> None:
    cfg_map = chosen["arm_t_kuairec"]
    pool_mask, sens_mask, rule, small_user_big, big2small_item = _arm_f_pool(big, small, audit)
    X_pool, exposure_pool, pool_events = _pool_matrices(big, pool_mask, big2small_item)
    log(f"arm_f: rule = {rule}; pool events {int(pool_mask.sum())}; "
        f"pool positives {int((X_pool > 0).sum())}")
    (RESULTS / "arm_f_meta.json").write_text(json.dumps(
        {"training_rule": rule, "pool_events": int(pool_mask.sum()),
         "pool_positive_cells": int((X_pool > 0).sum())}, indent=2))
    rel = binary_matrix(small["user"], small["item"],
                        (small["watch_ratio"] > 2.0).astype(np.float64),
                        small["n_users"], small["n_items"])
    rel1 = binary_matrix(small["user"], small["item"],
                         (small["watch_ratio"] > 1.0).astype(np.float64),
                         small["n_users"], small["n_items"])
    scores: dict[str, np.ndarray] = {}
    per_user: dict[str, dict] = {}
    timing: list[dict] = []
    for name in RANKER_ORDER:
        cfg = cfg_map.get(name, {})
        if name == "iALS":
            acc, sc_acc = [], None
            t0 = time.perf_counter()
            for s in IALS_SEEDS:
                sc = _fit_score_small(name, cfg, X_pool, exposure_pool, small_user_big,
                                      seed=s, iters=FINAL_IALS_ITERATIONS)
                sc_acc = sc if sc_acc is None else sc_acc + sc
                acc.append(metrics.exact_per_user(sc, rel))
            per_user[name] = {k: np.nanmean(np.vstack([a[k] for a in acc]), axis=0) for k in acc[0]}
            scores[name] = sc_acc / len(IALS_SEEDS)
            timing.append({"arm": "arm_f", "ranker": name, "stage": "fit_x5seeds",
                           "seconds": time.perf_counter() - t0, "peak_mb": peak_mb()})
        elif name == "Random":
            acc = []
            keep = None
            for s in range(5):
                sc = _fit_score_small(name, cfg, X_pool, exposure_pool, small_user_big, seed=s)
                if keep is None:
                    keep = sc
                acc.append(metrics.exact_per_user(sc, rel))
            per_user[name] = {k: np.nanmean(np.vstack([a[k] for a in acc]), axis=0) for k in acc[0]}
            scores[name] = keep
        else:
            t0 = time.perf_counter()
            sc = _fit_score_small(name, cfg, X_pool, exposure_pool, small_user_big)
            timing.append({"arm": "arm_f", "ranker": name, "stage": "fit_and_score",
                           "seconds": time.perf_counter() - t0, "peak_mb": peak_mb()})
            scores[name] = sc
            per_user[name] = metrics.exact_per_user(sc, rel)
        log(f"arm_f {name}: truth NDCG@10 = {np.nanmean(per_user[name]['ndcg']):.4f}")
    write_csv("arm_metrics.csv", _merge_existing("arm_metrics.csv", arm_metric_rows("arm_f", per_user), "arm", "arm_f"))
    write_csv("pairwise.csv", _merge_existing("pairwise.csv", pairwise_rows("arm_f", per_user), "arm", "arm_f"))
    write_csv("timings.csv", _merge_existing("timings.csv", timing, "arm", "arm_f"))
    srows = sampled_rows("arm_f", scores, rel, small["n_items"], exclude=None)
    write_csv("sampled_metrics.csv", _merge_existing("sampled_metrics.csv", srows, "arm", "arm_f"))
    prows = popularity_rows("arm_f", scores, exposure_pool)
    write_csv("popularity_report.csv", _merge_existing("popularity_report.csv", prows, "arm", "arm_f"))
    # Sensitivity: truth labels at watch_ratio > 1.0, same scores.
    sens_rows = []
    for name in RANKER_ORDER:
        pu = metrics.exact_per_user(scores[name], rel1)
        sens_rows.append({"arm": "arm_f", "ranker": name, "label_threshold": "watch_ratio>1.0",
                          "ndcg": float(np.nanmean(pu["ndcg"])),
                          "n_users": int((~np.isnan(pu["ndcg"])).sum())})
    write_csv("arm_f_label_sensitivity.csv", sens_rows)
    # Sensitivity pool: train before the small-matrix median timestamp.
    X_sens, exposure_sens, _ = _pool_matrices(big, sens_mask, big2small_item)
    pool_rows = []
    for name in RANKER_ORDER:
        cfg = cfg_map.get(name, {})
        iters = FINAL_IALS_ITERATIONS if name == "iALS" else None
        sc = _fit_score_small(name, cfg, X_sens, exposure_sens, small_user_big,
                              seed=0, iters=iters)
        pu = metrics.exact_per_user(sc, rel)
        pool_rows.append({"ranker": name, "ndcg": float(np.nanmean(pu["ndcg"])),
                          "pool_events": int(sens_mask.sum())})
        log(f"arm_f sensitivity pool {name}: NDCG {np.nanmean(pu['ndcg']):.4f}")
    write_csv("arm_f_pool_sensitivity.csv", pool_rows)
    write_csv("popularity_slices.csv", _popularity_slices(scores, rel, exposure_pool))
    _exposure_arm(scores, rel, exposure_pool, pool_events, big, small)


def _popularity_slices(scores: dict[str, np.ndarray], rel: np.ndarray,
                       exposure_pool: np.ndarray) -> list[dict]:
    """H5: ranker orderings inside item-popularity slices, truth vs the
    naive sampled evaluator (seed-averaged)."""
    order = np.argsort(-exposure_pool, kind="stable")
    n_items = exposure_pool.size
    slices = {
        "head_top1pct": order[: max(1, int(round(0.01 * n_items)))],
        "torso_next9pct": order[int(round(0.01 * n_items)): int(round(0.10 * n_items))],
        "tail_rest": order[int(round(0.10 * n_items)):],
    }
    rows = []
    for slice_name, items in slices.items():
        mask = np.zeros(n_items, dtype=bool)
        mask[items] = True
        rel_s = rel * mask[None, :]
        for name in RANKER_ORDER:
            truth = np.nanmean(metrics.exact_per_user(scores[name], rel_s)["ndcg"])
            sampled = []
            for seed in SAMPLING_SEEDS:
                out = metrics.sampled_per_user(scores[name], rel_s, m=100, seed=seed)
                sampled.append(float(np.nanmean(out["ndcg"])))
            rows.append({"slice": slice_name, "ranker": name,
                         "truth_ndcg": float(truth),
                         "sampled_ndcg_mean": float(np.mean(sampled)),
                         "n_users": int((rel_s.sum(axis=1) > 0).sum())})
        log(f"slice {slice_name} done")
    return rows


def _exposure_arm(scores: dict[str, np.ndarray], rel: np.ndarray,
                  exposure_pool: np.ndarray, pool_events, big: dict, small: dict) -> None:
    from src.correction import LogisticImputer, estimator_dcgs, estimate_propensities, make_propensities, topk_lists
    pu, pi, pratio = pool_events
    labels = (pratio > 2.0).astype(np.float64)
    n_big_users = big["n_users"]
    user_pos_rate = np.zeros(n_big_users)
    user_counts = np.bincount(pu, minlength=n_big_users)
    user_pos = np.bincount(pu, weights=labels, minlength=n_big_users)
    user_pos_rate = np.divide(user_pos, np.maximum(user_counts, 1))
    item_pos = np.bincount(pi, weights=labels, minlength=small["n_items"])
    item_pos_rate = np.divide(item_pos, np.maximum(exposure_pool, 1))
    imputer = LogisticImputer().fit(pu, pi, labels, user_pos_rate, exposure_pool, item_pos_rate)
    _, small_user_big, _ = _small_maps(big, small)
    imputer.user_pos_rate = user_pos_rate[small_user_big]
    imputed = imputer.predict_matrix(small["n_users"], small["n_items"])
    top_lists = {name: topk_lists(scores[name], k=10) for name in RANKER_ORDER}
    est_rows: list[dict] = []
    tau_rows: list[dict] = []
    for gamma in (0.0, 0.5, 1.0):
        p, c = make_propensities(exposure_pool, gamma=gamma, target_mean=0.163)
        for seed in EXPOSURE_SEEDS:
            rng = np.random.default_rng(20_000 + int(gamma * 10) * 100 + seed)
            exposed = rng.random(rel.shape) < p[None, :]
            counts = exposed.sum(axis=0)
            p_hat = estimate_propensities(counts, rel.shape[0])
            for condition, p_use in (("true", p), ("estimated", p_hat)):
                means: dict[str, dict[str, float]] = {}
                for name in RANKER_ORDER:
                    out = estimator_dcgs(top_lists[name], rel, exposed, p_use, imputed=imputed)
                    means[name] = {
                        "truth": float(out["truth"].mean()),
                        "naive": float(out["naive"].mean()),
                        "ips": float(out["ips"].mean()),
                        "dr": float(out["dr"].mean()),
                        "snips": float(out["snips_mean_dcg"]),
                    }
                    est_rows.append({"gamma": gamma, "condition": condition, "seed": seed,
                                     "ranker": name, **means[name]})
                truth_order = np.array([means[n]["truth"] for n in RANKER_ORDER])
                tau_row = {"gamma": gamma, "condition": condition, "seed": seed}
                for est in ("naive", "ips", "snips", "dr"):
                    est_vals = np.array([means[n][est] for n in RANKER_ORDER])
                    tau_row[f"tau_{est}"] = kendall_tau_b(est_vals, truth_order)
                tau_rows.append(tau_row)
        log(f"exposure arm gamma={gamma} done (c={c:.4f})")
    write_csv("exposure_estimates.csv", est_rows)
    write_csv("exposure_tau.csv", tau_rows)


def stage_random(big: dict, ml: dict, chosen: dict) -> None:
    rows: list[dict] = []
    for ds_name, d, pos_label, cfg_key in (
        ("kuairec_big", big, big["watch_ratio"] > 2.0, "arm_t_kuairec"),
        ("ml1m", ml, ml["rating"] >= 4.0, "arm_t_ml1m"),
    ):
        cfg_map = chosen[cfg_key]
        n = d["user"].size
        for seed in SPLIT_SEEDS:
            tr_m, _va_m, te_m = split_mod.random_masks(n, seed)
            X_train = binary_matrix(d["user"][tr_m & pos_label], d["item"][tr_m & pos_label],
                                    np.ones(int((tr_m & pos_label).sum())), d["n_users"], d["n_items"])
            exposure = np.bincount(d["item"][tr_m], minlength=d["n_items"]).astype(np.float64)
            cand = te_m & pos_label
            first = split_mod.first_time_mask(d["user"][tr_m], d["item"][tr_m],
                                              d["user"][cand], d["item"][cand], d["n_items"])
            rel = binary_matrix(d["user"][cand][first], d["item"][cand][first],
                                np.ones(int(first.sum())), d["n_users"], d["n_items"])
            users = np.unique(d["user"][cand][first])
            rel_u = rel[users]
            X_u = X_train[users]
            for name in RANKER_ORDER:
                cfg = cfg_map.get(name, {})
                if name == "iALS":
                    cfg = dict(cfg)
                    cfg["iterations"] = FINAL_IALS_ITERATIONS
                model = make_ranker(name, cfg, seed=seed if name == "iALS" else 0)
                model.fit(X_train, exposure)
                sc = score_ranker(model, name, users, X_train)
                sc = mask_seen(sc, X_u)
                ndcg = float(np.nanmean(metrics.exact_per_user(sc, rel_u)["ndcg"]))
                rows.append({"dataset": ds_name, "ranker": name, "seed": seed,
                             "ndcg_random": ndcg, "n_users": int(users.size)})
            log(f"random arm {ds_name} seed {seed} done")
    write_csv("random_split.csv", rows)


def _read_table(name: str) -> list[dict]:
    path = TABLES / name
    if not path.exists():
        return []
    with open(path, newline="") as fh:
        return list(csv.DictReader(fh))


def _f(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return float("nan")


def _order_of(values: dict[str, float]) -> list[str]:
    return sorted(values, key=lambda k: -values[k])


def _flip_count(vals_a: dict[str, float], vals_b: dict[str, float]) -> int:
    names = list(vals_a)
    flips = 0
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            da = vals_a[names[i]] - vals_a[names[j]]
            db = vals_b[names[i]] - vals_b[names[j]]
            if da * db < 0:
                flips += 1
    return flips


def _pair_flip_counts(exact: dict[str, float], per_seed: list[dict[str, float]]) -> dict:
    names = list(exact)
    counts: dict[str, list[int]] = {}
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = names[i], names[j]
            key = f"{a}|{b}"
            counts[key] = [0, len(per_seed)]
            for vals in per_seed:
                if (vals[a] - vals[b]) * (exact[a] - exact[b]) < 0:
                    counts[key][0] += 1
    return counts


def stage_verdicts() -> dict:
    arm_metrics = {(r["arm"], r["ranker"]): r for r in _read_table("arm_metrics.csv")}
    sampled = _read_table("sampled_metrics.csv")
    pairwise = {(r["arm"], r["ranker_a"], r["ranker_b"]): r for r in _read_table("pairwise.csv")}
    random_rows = _read_table("random_split.csv")
    tau_rows = _read_table("exposure_tau.csv")
    est_rows = _read_table("exposure_estimates.csv")
    pop_rows = _read_table("popularity_report.csv")
    cold_rows = _read_table("cold_start.csv")
    slice_rows = _read_table("popularity_slices.csv")
    leakage = {}
    if (RESULTS / "leakage_check.json").exists():
        leakage = json.loads((RESULTS / "leakage_check.json").read_text())

    def exact(arm: str, ranker: str) -> float:
        return _f(arm_metrics[(arm, ranker)]["ndcg"])

    verdicts: dict = {}

    # H1
    h1_arms = {}
    for arm in ("arm_t_kuairec", "arm_f"):
        h1_arms[arm] = {"popularity": exact(arm, "Popularity"), "random": exact(arm, "Random")}
    verdicts["H1"] = {
        "verdict": "SUPPORTED" if all(v["popularity"] > v["random"] for v in h1_arms.values()) else "NOT SUPPORTED",
        "evidence": h1_arms}

    # H1a / H1b from the Arm T pairwise table (one-sided bounds, reversed pairs).
    row = pairwise[("arm_t_kuairec", "Popularity", "ItemKNN")]
    h1a_lo = -_f(row["one_sided_hi"])
    verdicts["H1a"] = {"verdict": "SUPPORTED" if h1a_lo > 0 else "NOT SUPPORTED",
                       "evidence": {"itemknn_minus_popularity_mean": -_f(row["mean_diff_a_minus_b"]),
                                    "one_sided_95_lower_bound": h1a_lo,
                                    "p_holm": _f(row["p_holm"]), "n_users": int(_f(row["n_users"]))}}
    row = pairwise[("arm_t_kuairec", "ItemKNN", "EASE")]
    h1b_lo = -_f(row["one_sided_hi"])
    verdicts["H1b"] = {"verdict": "SUPPORTED" if h1b_lo > 0 else "NOT SUPPORTED",
                       "evidence": {"ease_minus_itemknn_mean": -_f(row["mean_diff_a_minus_b"]),
                                    "one_sided_95_lower_bound": h1b_lo,
                                    "p_holm": _f(row["p_holm"]), "n_users": int(_f(row["n_users"]))}}

    # H2a / H2b on Arm F (replications reported for the other arms).
    def h2_block(arm: str) -> dict:
        exact_map = {n: exact(arm, n) for n in RANKER_ORDER}
        per_seed_s = {n: [] for n in RANKER_ORDER}
        per_seed_c = {n: [] for n in RANKER_ORDER}
        seed_rows: dict[int, dict[str, float]] = {}
        seed_rows_c: dict[int, dict[str, float]] = {}
        for r in sampled:
            if r["arm"] != arm:
                continue
            per_seed_s[r["ranker"]].append(_f(r["sampled_ndcg"]))
            per_seed_c[r["ranker"]].append(_f(r["corrected_ndcg"]))
            seed_rows.setdefault(int(r["seed"]), {})[r["ranker"]] = _f(r["sampled_ndcg"])
            seed_rows_c.setdefault(int(r["seed"]), {})[r["ranker"]] = _f(r["corrected_ndcg"])
        s_mean = {n: float(np.mean(v)) for n, v in per_seed_s.items()}
        c_mean = {n: float(np.mean(v)) for n, v in per_seed_c.items()}
        err_s = float(np.mean([abs(s_mean[n] - exact_map[n]) for n in RANKER_ORDER]))
        err_c = float(np.mean([abs(c_mean[n] - exact_map[n]) for n in RANKER_ORDER]))
        flips_s = _pair_flip_counts(exact_map, [seed_rows[s] for s in sorted(seed_rows)])
        flips_c = _pair_flip_counts(exact_map, [seed_rows_c[s] for s in sorted(seed_rows_c)])
        return {"exact": exact_map, "sampled_mean": s_mean, "corrected_mean": c_mean,
                "mean_abs_err_sampled": err_s, "mean_abs_err_corrected": err_c,
                "order_sampled": _order_of(s_mean), "order_exact": _order_of(exact_map),
                "pair_flips_sampled": flips_s, "pair_flips_corrected": flips_c}

    h2f = h2_block("arm_f")
    h2a_ok = all(h2f["sampled_mean"][n] > h2f["exact"][n] for n in RANKER_ORDER) and \
        h2f["order_sampled"] == h2f["order_exact"]
    verdicts["H2a"] = {"verdict": "SUPPORTED" if h2a_ok else "NOT SUPPORTED", "evidence": h2f}
    cond1 = h2f["mean_abs_err_corrected"] < h2f["mean_abs_err_sampled"]
    cond2 = any(v[0] >= 8 and h2f["pair_flips_corrected"][k][0] <= 2
                for k, v in h2f["pair_flips_sampled"].items())
    verdicts["H2b"] = {"verdict": "SUPPORTED" if (cond1 and cond2) else "NOT SUPPORTED",
                       "evidence": {"err_sampled": h2f["mean_abs_err_sampled"],
                                    "err_corrected": h2f["mean_abs_err_corrected"],
                                    "condition_error_reduction": bool(cond1),
                                    "condition_flip_pattern": bool(cond2),
                                    "pair_flips_sampled": h2f["pair_flips_sampled"],
                                    "pair_flips_corrected": h2f["pair_flips_corrected"]}}
    for arm in ("arm_t_kuairec", "arm_t_ml1m"):
        verdicts[f"H2_replication_{arm}"] = h2_block(arm)

    # H3a
    def h3_block(ds: str, arm: str) -> dict:
        per_ranker = {}
        for name in ("Popularity", "ItemKNN", "EASE", "iALS"):
            vals = [_f(r["ndcg_random"]) for r in random_rows
                    if r["dataset"] == ds and r["ranker"] == name]
            per_ranker[name] = {"random_mean": float(np.mean(vals)) if vals else None,
                                "temporal": exact(arm, name),
                                "random_exceeds": bool(vals and np.mean(vals) > exact(arm, name))}
        return per_ranker
    h3k = h3_block("kuairec_big", "arm_t_kuairec")
    h3m = h3_block("ml1m", "arm_t_ml1m")
    count_k = sum(1 for v in h3k.values() if v["random_exceeds"])
    count_m = sum(1 for v in h3m.values() if v["random_exceeds"])
    verdicts["H3a"] = {"verdict": "SUPPORTED" if count_k >= 3 else "NOT SUPPORTED",
                       "evidence": {"kuairec_rankers_random_exceeds": count_k, "kuairec": h3k,
                                    "ml1m_rankers_random_exceeds": count_m, "ml1m": h3m}}

    # H3b
    clean_ok = bool(leakage.get("clean", {}).get("pair_overlap_ok")
                    and leakage.get("clean", {}).get("time_order_ok"))
    verdicts["H3b"] = {"verdict": "SUPPORTED" if (clean_ok and leakage.get("audit_flags_planted")) else "FAILS",
                       "evidence": leakage}

    # H4a / H4b / S1 from the exposure arm.
    def tau_diff(gamma: float, condition: str, est_a: str, est_b: str = "naive") -> dict:
        rows = [r for r in tau_rows if _f(r["gamma"]) == gamma and r["condition"] == condition]
        diffs = np.array([_f(r[f"tau_{est_a}"]) - _f(r[f"tau_{est_b}"]) for r in rows])
        res = paired_bootstrap(diffs, n_boot=BOOT, seed=0)
        return {"mean_tau_diff": float(diffs.mean()), "ci_lo": res["ci_lo"], "ci_hi": res["ci_hi"],
                "n_seeds": int(diffs.size)}
    h4a_ips = tau_diff(1.0, "true", "ips")
    h4a_snips = tau_diff(1.0, "true", "snips")
    h4a_ok = (h4a_ips["mean_tau_diff"] > 0 and h4a_ips["ci_lo"] > 0
              and h4a_snips["mean_tau_diff"] > 0 and h4a_snips["ci_lo"] > 0)
    verdicts["H4a"] = {"verdict": "SUPPORTED" if h4a_ok else "NOT SUPPORTED",
                       "rule": "substituted rule, DECISIONS.md D2",
                       "evidence": {"ips_vs_naive": h4a_ips, "snips_vs_naive": h4a_snips}}
    h4b = tau_diff(1.0, "estimated", "snips")
    verdicts["H4b"] = {"verdict": "SUPPORTED" if (h4b["mean_tau_diff"] > 0 and h4b["ci_lo"] > 0) else "NOT SUPPORTED",
                       "evidence": h4b}
    bias_rows = [r for r in est_rows if _f(r["gamma"]) == 1.0 and r["condition"] == "true"]
    seeds = sorted({int(r["seed"]) for r in bias_rows})
    diffs = []
    for s in seeds:
        pop = [r for r in bias_rows if int(r["seed"]) == s and r["ranker"] == "Popularity"][0]
        ease = [r for r in bias_rows if int(r["seed"]) == s and r["ranker"] == "EASE"][0]
        diffs.append((_f(pop["naive"]) - _f(pop["truth"])) - (_f(ease["naive"]) - _f(ease["truth"])))
    res = paired_bootstrap(np.array(diffs), n_boot=BOOT, seed=0)
    verdicts["S1"] = {"verdict": "SUPPORTED" if (np.mean(diffs) > 0 and res["ci_lo"] > 0) else "NOT SUPPORTED",
                      "evidence": {"mean_bias_difference_popularity_minus_ease": float(np.mean(diffs)),
                                   "ci_lo": res["ci_lo"], "ci_hi": res["ci_hi"], "n_seeds": len(seeds)}}

    # H5
    slice_orders = {}
    h5_diff = False
    for slice_name in ("head_top1pct", "torso_next9pct", "tail_rest"):
        rows = [r for r in slice_rows if r["slice"] == slice_name]
        t_order = _order_of({r["ranker"]: _f(r["truth_ndcg"]) for r in rows})
        s_order = _order_of({r["ranker"]: _f(r["sampled_ndcg_mean"]) for r in rows})
        slice_orders[slice_name] = {"truth_order": t_order, "sampled_order": s_order}
        if t_order != s_order:
            h5_diff = True
    verdicts["H5"] = {"verdict": "SUPPORTED" if h5_diff else "NOT SUPPORTED", "evidence": slice_orders}

    # H6
    pooled = [r for r in pop_rows if r["arm"] == "arm_f" and r["ranker"] == "POOLED"][0]
    share = _f(pooled["top10pct_share"])
    n_rec = int(_f(pooled["n_recommendations"]))
    z = (share - 0.10) / np.sqrt(0.1 * 0.9 / n_rec)
    verdicts["H6"] = {"verdict": "SUPPORTED" if z > 1.645 else "NOT SUPPORTED",
                      "evidence": {"top10pct_share": share, "top1pct_share": _f(pooled["top1pct_share"]),
                                   "n_recommendations": n_rec, "z": float(z), "gini_pooled": _f(pooled["gini"])}}

    # H7
    def cold_gap(arm: str):
        rows = {(r["slice"], r["ranker"]): r for r in cold_rows if r["arm"] == arm}
        knn = rows.get(("item_cold", "ItemKNN"))
        pop = rows.get(("item_cold", "Popularity"))
        if not knn or not pop or knn["ndcg"] in ("", "None") or pop["ndcg"] in ("", "None"):
            return None
        return {"n_users": int(_f(knn["n_users"])),
                "gap_cold": _f(knn["ndcg"]) - _f(pop["ndcg"]),
                "gap_full": exact(arm, "ItemKNN") - exact(arm, "Popularity")}
    h7_arm, h7 = "arm_t_kuairec", cold_gap("arm_t_kuairec")
    if h7 is None or h7["n_users"] < 30:
        h7_arm, h7 = "arm_t_ml1m", cold_gap("arm_t_ml1m")
    verdicts["H7"] = {"verdict": "SUPPORTED" if (h7 and h7["gap_cold"] < h7["gap_full"]) else "NOT SUPPORTED",
                      "evidence": {"arm_used": h7_arm, **(h7 or {})}}

    # Track-level GO conditions (pack section 1.2 / 1.3).
    import subprocess
    prereg_hash = subprocess.run(
        ["git", "log", "--diff-filter=A", "--format=%H", "--", "PREREG.md"],
        cwd=ROOT, capture_output=True, text=True).stdout.strip().splitlines()
    conditions = {
        "second_dataset_added": any(r["arm"] == "arm_t_ml1m" for r in arm_metrics.values()),
        "causal_estimator_implemented": len(est_rows) > 0,
        "exact_metric_calibration_and_correction": len(sampled) > 0,
        "cold_start_and_popularity_slices_logged": len(cold_rows) > 0 and len(pop_rows) > 0,
        "preregistration_pinned": bool(prereg_hash),
        "preregistration_commit": prereg_hash[0] if prereg_hash else None,
    }
    verdicts["track"] = {
        "verdict": "GO" if all(v for k, v in conditions.items() if k != "preregistration_commit") else "CONDITIONAL GO",
        "conditions": conditions}
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "verdicts.json").write_text(json.dumps(verdicts, indent=2))
    log("verdicts written")
    return verdicts


def _save_chosen(chosen: dict) -> None:
    RESULTS.mkdir(parents=True, exist_ok=True)
    path = RESULTS / "chosen_configs.json"
    current = {}
    if path.exists():
        current = json.loads(path.read_text())
    current.update(chosen)
    path.write_text(json.dumps(current, indent=2))


def _load_chosen() -> dict:
    path = RESULTS / "chosen_configs.json"
    if path.exists():
        return json.loads(path.read_text())
    return {}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("stage", choices=["audit", "arm_t", "ml1m", "arm_f", "random", "verdicts", "all"])
    args = ap.parse_args()
    RESULTS.mkdir(parents=True, exist_ok=True)
    TABLES.mkdir(parents=True, exist_ok=True)

    if args.stage in ("audit", "all"):
        import subprocess
        out = subprocess.run([sys.executable, str(ROOT / "experiments" / "audit_data.py")],
                             capture_output=True, text=True)
        if out.returncode != 0:
            print(out.stderr[-3000:])
            return 1
        (RESULTS / "data_audit.json").write_text(out.stdout)
        log("audit written to results/data_audit.json")
        if args.stage == "audit":
            return 0

    audit = {}
    if (RESULTS / "data_audit.json").exists():
        audit = json.loads((RESULTS / "data_audit.json").read_text())
    chosen = _load_chosen()
    big = small = ml = None
    if args.stage in ("arm_t", "arm_f", "random", "all"):
        big, small, ml = load_all()
    elif args.stage == "ml1m":
        _b, _s, ml = load_all()

    if args.stage in ("arm_t", "all"):
        holder: dict = {}
        stage_arm_t("arm_t_kuairec", big, big["watch_ratio"] > 2.0, holder)
        chosen.update(holder)
        _save_chosen(chosen)
    if args.stage in ("ml1m", "all"):
        holder = {}
        stage_arm_t("arm_t_ml1m", ml, ml["rating"] >= 4.0, holder)
        chosen.update(holder)
        _save_chosen(chosen)
    if args.stage in ("arm_f", "all"):
        if "arm_t_kuairec" not in chosen:
            raise SystemExit("arm_f needs chosen configs from arm_t; run arm_t first")
        stage_arm_f(big, small, audit, chosen)
    if args.stage in ("random", "all"):
        stage_random(big, ml, chosen)
    if args.stage in ("verdicts", "all"):
        v = stage_verdicts()
        print(json.dumps({k: (val.get("verdict") if isinstance(val, dict) else val)
                          for k, val in v.items()}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
