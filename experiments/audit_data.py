"""Data audit (design pack checks A1 to A4). Descriptive statistics only:
row counts, timestamp ranges and quantiles, id overlap, label rates. No
model is fitted and no evaluation metric is computed here. The output pins
the split cutoffs that PREREG.md freezes.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.dataio import load_kuairec, load_ml1m, pair_keys  # noqa: E402

RAW = Path(__file__).resolve().parents[1] / "data" / "raw"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 22), b""):
            h.update(chunk)
    return h.hexdigest()


def describe(name: str, d: dict, label: np.ndarray) -> dict:
    ts = d["timestamp"]
    return {
        "dataset": name,
        "rows": int(d["user"].size),
        "n_users": d["n_users"],
        "n_items": d["n_items"],
        "ts_missing": int(np.isnan(ts).sum()),
        "ts_min": float(np.nanmin(ts)),
        "ts_max": float(np.nanmax(ts)),
        "ts_q80": float(np.nanquantile(ts, 0.80)),
        "ts_q90": float(np.nanquantile(ts, 0.90)),
        "positive_rate": float(label.mean()),
        "users_with_zero_positives": int((np.bincount(d["user"][label], minlength=d["n_users"]) == 0).sum()),
    }


def main() -> int:
    out: dict = {"files": {}}
    for fname in ("KuaiRec.zip", "ml-1m.zip"):
        p = RAW / fname
        out["files"][fname] = {"sha256": sha256(p), "bytes": p.stat().st_size}

    big = load_kuairec(str(RAW / "big_matrix.csv"))
    small = load_kuairec(str(RAW / "small_matrix.csv"))
    big_pos2 = big["watch_ratio"] > 2.0
    big_pos1 = big["watch_ratio"] > 1.0
    small_pos2 = small["watch_ratio"] > 2.0
    small_pos1 = small["watch_ratio"] > 1.0

    out["kuairec_big"] = describe("kuairec_big", big, big_pos2)
    out["kuairec_big"]["positive_rate_gt1"] = float(big_pos1.mean())
    out["kuairec_small"] = describe("kuairec_small", small, small_pos2)
    out["kuairec_small"]["positive_rate_gt1"] = float(small_pos1.mean())

    # A2/A3: timeline and id overlap between the matrices.
    t_s = float(np.nanmin(small["timestamp"]))
    out["arm_f"] = {
        "small_ts_min": t_s,
        "small_ts_median": float(np.nanmedian(small["timestamp"])),
        "big_frac_before_small_min": float((big["timestamp"] < t_s).mean()),
        "small_users_subset_of_big": bool(np.isin(small["user_ids"], big["user_ids"]).all()),
        "small_items_subset_of_big": bool(np.isin(small["item_ids"], big["item_ids"]).all()),
        "small_user_count_in_big_ids": int(np.isin(small["user_ids"], big["user_ids"]).sum()),
        "small_item_count_in_big_ids": int(np.isin(small["item_ids"], big["item_ids"]).sum()),
    }
    # Small ids are remapped per file; overlap of raw ids needs raw values.
    # The loaders remap per file, so compare through the raw id arrays.
    out["arm_f"]["note"] = (
        "user_ids/item_ids above are the raw ids stored by the loaders before "
        "remapping; subset checks use them directly."
    )
    # Pair overlap (E2: small pairs are excluded from big by construction).
    big_keys = np.unique(pair_keys(big["user"], big["item"], big["n_items"]))
    # Small pairs keyed in the big id space require shared raw ids; remap
    # small raw ids into big index space through the raw id arrays.
    big_user_index = {int(v): i for i, v in enumerate(big["user_ids"])}
    big_item_index = {int(v): i for i, v in enumerate(big["item_ids"])}
    su = np.array([big_user_index[int(v)] for v in small["user_ids"]])[small["user"]]
    si = np.array([big_item_index[int(v)] for v in small["item_ids"]])[small["item"]]
    small_keys = pair_keys(su, si, big["n_items"])
    out["arm_f"]["small_pairs_present_in_big"] = int(np.isin(small_keys, big_keys).sum())
    out["arm_f"]["small_pairs_total"] = int(small_keys.size)
    # Arm F training pool: big events on small items.
    on_small_items = np.isin(big["item"], np.array([big_item_index[int(v)] for v in small["item_ids"]]))
    out["arm_f"]["big_events_on_small_items"] = int(on_small_items.sum())
    out["arm_f"]["big_events_on_small_items_frac_before_small_min"] = float(
        ((big["timestamp"] < t_s) & on_small_items).sum() / max(on_small_items.sum(), 1)
    )
    out["arm_f"]["big_events_on_small_items_frac_before_small_median"] = float(
        ((big["timestamp"] < float(np.nanmedian(small["timestamp"]))) & on_small_items).sum()
        / max(on_small_items.sum(), 1)
    )

    ml = load_ml1m(str(RAW / "ml-1m" / "ratings.dat"))
    ml_pos = ml["rating"] >= 4.0
    out["ml1m"] = describe("ml1m", ml, ml_pos)
    out["ml1m"]["rating_counts"] = {str(int(r)): int((ml["rating"] == r).sum()) for r in (1, 2, 3, 4, 5)}

    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
