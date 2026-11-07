#!/usr/bin/env bash
# Full pipeline: audit, Arm T (KuaiRec big), Arm T replication (ML-1M),
# Arm F (KuaiRec small) with the exposure arm, random-split arm, verdicts.
# Usage: experiments/run_all.sh [stage]   (default: all)
set -euo pipefail
cd "$(dirname "$0")/.."
export OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 MKL_NUM_THREADS=2
if [ -x .venv/bin/python ]; then PY=.venv/bin/python; else PY=python3; fi
exec "$PY" experiments/run_all.py "${1:-all}"
