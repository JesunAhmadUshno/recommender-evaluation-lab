"""The ranker ladder.

L0 Random, L1 Popularity (MostPop), L2 ItemKNN, A EASE, B iALS.
SASRec is excluded by design: the rendered design pack (section 4.6) shows
a mean of about 1,746 events per big-matrix user, so self-attention
training on 4 CPU cores cannot carry an honest tuning budget in the
timebox; the coordinator adoption note lists SASRec first in the drop
order. The exclusion is recorded in DECISIONS.md and PREREG.md, and the
class below raises rather than silently returning numbers.

Every ranker fits on a binary training-positive matrix X (users x items)
and returns a full score matrix for requested user rows.
"""
from __future__ import annotations

import numpy as np


class RandomRanker:
    name = "Random"

    def __init__(self, seed: int = 0):
        self.seed = seed

    def fit(self, X: np.ndarray, exposure: np.ndarray | None = None):
        self.n_items = X.shape[1]
        return self

    def scores(self, users: np.ndarray) -> np.ndarray:
        users = np.asarray(users)
        rng = np.random.default_rng([self.seed, int(users[0]) if users.size else 0])
        return rng.random((users.size, self.n_items), dtype=np.float32)


class Popularity:
    name = "Popularity"

    def fit(self, X: np.ndarray, exposure: np.ndarray | None = None):
        counts = exposure if exposure is not None else X.sum(axis=0)
        self.item_scores = np.asarray(counts, dtype=np.float32)
        self.n_items = X.shape[1]
        return self

    def scores(self, users: np.ndarray) -> np.ndarray:
        return np.tile(self.item_scores, (len(users), 1))


class ItemKNN:
    """Cosine item-item KNN with co-occurrence shrinkage."""

    name = "ItemKNN"

    def __init__(self, k: int = 100, shrink: float = 0.0):
        self.k = k
        self.shrink = shrink

    def fit(self, X: np.ndarray, exposure: np.ndarray | None = None):
        X = (X > 0).astype(np.float32)
        self.X = X
        n_items = X.shape[1]
        self.n_items = n_items
        pop = np.asarray(X.sum(axis=0)).ravel().astype(np.float64)
        k = min(self.k, n_items - 1)
        nbr_idx = np.zeros((n_items, k), dtype=np.int32)
        nbr_val = np.zeros((n_items, k), dtype=np.float32)
        # Blocked over item columns so the full similarity matrix is never
        # materialised: peak extra memory is one (n_items x block) slab.
        block = 1024
        for s in range(0, n_items, block):
            e = min(n_items, s + block)
            gram = X.T @ X[:, s:e]  # co-occurrence of every item with block items
            denom = np.sqrt(np.outer(pop, pop[s:e]))
            with np.errstate(divide="ignore", invalid="ignore"):
                sim = np.where(denom > 0, gram / np.maximum(denom, 1e-12), 0.0)
            if self.shrink > 0:
                sim = sim * (gram / (gram + self.shrink))
            for j in range(s, e):
                sim[j, j - s] = 0.0
            idx = np.argpartition(-sim, k - 1, axis=0)[:k, :]
            cols = np.arange(e - s)[None, :]
            vals = sim[idx, cols]
            order = np.argsort(-vals, axis=0, kind="stable")
            nbr_idx[s:e] = idx[order, cols].T
            nbr_val[s:e] = vals[order, cols].T
        self.nbr_idx = nbr_idx
        self.nbr_val = nbr_val
        return self

    def scores(self, users: np.ndarray) -> np.ndarray:
        users = np.asarray(users)
        Xu = self.X[users]
        out = np.zeros((users.size, self.n_items), dtype=np.float32)
        for j in range(self.n_items):
            col = Xu[:, j]
            if np.any(col):
                out[:, self.nbr_idx[j]] += col[:, None] * self.nbr_val[j][None, :]
        return out


class EASE:
    """EASE (Steck, WWW 2019): closed-form item-item linear model."""

    name = "EASE"

    def __init__(self, lam: float = 100.0):
        self.lam = lam

    def fit(self, X: np.ndarray, exposure: np.ndarray | None = None):
        X = (X > 0).astype(np.float32)
        n_items = X.shape[1]
        self.n_items = n_items
        dtype = np.float64 if n_items <= 6000 else np.float32
        gram = np.zeros((n_items, n_items), dtype=dtype)
        block = 512
        for s in range(0, X.shape[0], block):
            xb = X[s:s + block].astype(dtype)
            gram += xb.T @ xb
        gram[np.diag_indices(n_items)] += self.lam
        P = np.linalg.inv(gram)
        del gram
        diag = np.diag(P).copy()
        B = -P / diag[None, :]
        np.fill_diagonal(B, 0.0)
        self.B = B.astype(np.float32)
        return self

    def scores(self, users: np.ndarray, X: np.ndarray | None = None) -> np.ndarray:
        if X is None:
            raise ValueError("EASE.scores needs the user history matrix X")
        Xu = (X[np.asarray(users)] > 0).astype(np.float32)
        return Xu @ self.B


class IALS:
    """Implicit ALS (Hu, Koren, Volinsky, ICDM 2008)."""

    name = "iALS"

    def __init__(self, factors: int = 64, reg: float = 0.1, alpha: float = 10.0,
                 iterations: int = 15, seed: int = 0):
        self.factors = factors
        self.reg = reg
        self.alpha = alpha
        self.iterations = iterations
        self.seed = seed

    def fit(self, X: np.ndarray, exposure: np.ndarray | None = None):
        X = (X > 0)
        n_users, n_items = X.shape
        self.n_items = n_items
        rng = np.random.default_rng(self.seed)
        f = self.factors
        Y = rng.normal(0, 0.01, size=(n_items, f)).astype(np.float64)
        U = np.zeros((n_users, f), dtype=np.float64)
        user_pos = [np.flatnonzero(X[u]) for u in range(n_users)]
        item_pos = [np.flatnonzero(X[:, i]) for i in range(n_items)]
        reg_eye = self.reg * np.eye(f)
        for _ in range(self.iterations):
            YtY = Y.T @ Y
            for u in range(n_users):
                pos = user_pos[u]
                if pos.size == 0:
                    continue
                Yp = Y[pos]
                A = YtY + self.alpha * (Yp.T @ Yp) + reg_eye
                b = (1.0 + self.alpha) * Yp.sum(axis=0)
                U[u] = np.linalg.solve(A, b)
            UtU = U.T @ U
            for i in range(n_items):
                pos = item_pos[i]
                if pos.size == 0:
                    continue
                Up = U[pos]
                A = UtU + self.alpha * (Up.T @ Up) + reg_eye
                b = (1.0 + self.alpha) * Up.sum(axis=0)
                Y[i] = np.linalg.solve(A, b)
        self.U = U.astype(np.float32)
        self.Y = Y.astype(np.float32)
        return self

    def scores(self, users: np.ndarray) -> np.ndarray:
        return self.U[np.asarray(users)] @ self.Y.T


class SASRec:
    """Excluded by design; see module docstring and DECISIONS.md."""

    name = "SASRec"

    def fit(self, X: np.ndarray, exposure: np.ndarray | None = None):
        raise NotImplementedError(
            "SASRec is excluded from the measured ladder by the frozen design "
            "(PREREG.md section 3; DECISIONS.md entry D4). No SASRec numbers "
            "are claimed anywhere in this repo."
        )

    def scores(self, users: np.ndarray) -> np.ndarray:
        raise NotImplementedError("SASRec excluded; see DECISIONS.md entry D4.")


def mask_seen(scores: np.ndarray, X_rows: np.ndarray) -> np.ndarray:
    """Set scores of already-seen (training positive) items to -inf."""
    out = np.array(scores, dtype=np.float32, copy=True)
    out[np.asarray(X_rows) > 0] = -np.inf
    return out
