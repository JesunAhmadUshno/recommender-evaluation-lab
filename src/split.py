"""Split protocols.

Arm T: one global timeline. Cut points at the 80th and 90th percentiles of
the event timestamps. Train t < q80, validation q80 <= t < q90, test
t >= q90. Test positives are first-time positives: a (user, item) pair that
is positive in the test window and does not appear in the training window.

Arm F: rankers are trained on big-matrix events restricted to small-matrix
items (see DECISIONS.md), under the strict time rule when the audit allows
it, else the frozen fallback. Evaluation uses the full small matrix as
truth.

Random arm: seeded 80/10/10 split of events, the leakage comparison.
"""
from __future__ import annotations

import numpy as np

from .dataio import pair_keys


def temporal_cutoffs(timestamps: np.ndarray, q1: float = 0.80, q2: float = 0.90) -> tuple[float, float]:
    return float(np.quantile(timestamps, q1)), float(np.quantile(timestamps, q2))


def temporal_masks(timestamps: np.ndarray, t1: float, t2: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    train = timestamps < t1
    val = (timestamps >= t1) & (timestamps < t2)
    test = timestamps >= t2
    return train, val, test


def first_time_mask(train_user: np.ndarray, train_item: np.ndarray,
                    cand_user: np.ndarray, cand_item: np.ndarray,
                    n_items: int) -> np.ndarray:
    """True where a candidate (user, item) pair does not appear in train."""
    train_keys = np.unique(pair_keys(train_user, train_item, n_items))
    cand_keys = pair_keys(cand_user, cand_item, n_items)
    return ~np.isin(cand_keys, train_keys)


def random_masks(n_events: int, seed: int, fracs: tuple[float, float] = (0.80, 0.10)) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    perm = rng.permutation(n_events)
    n1 = int(fracs[0] * n_events)
    n2 = n1 + int(fracs[1] * n_events)
    train = np.zeros(n_events, dtype=bool)
    val = np.zeros(n_events, dtype=bool)
    test = np.zeros(n_events, dtype=bool)
    train[perm[:n1]] = True
    val[perm[n1:n2]] = True
    test[perm[n2:]] = True
    return train, val, test
