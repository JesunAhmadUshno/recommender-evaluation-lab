"""Portfolio standard checks: the lock holds, the required files exist, no grade is public."""
import glob
import hashlib
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# SHA-256 of PREREG.md as committed in cab910e (tag proposal-v1), before any code or metric.
LOCKED_SHA256 = "c4c23f4c4658d1422d42bef06b25a8684b6caf7da6fc39d033ef40e1ab23d0ea"


def test_prereg_is_unchanged_since_the_lock():
    with open(os.path.join(ROOT, "PREREG.md"), "rb") as f:
        assert hashlib.sha256(f.read()).hexdigest() == LOCKED_SHA256, \
            "PREREG.md changed after its lock; add a dated amendment and a DECISIONS.md entry instead"


def test_required_files_exist():
    need = ["README.md", "PREREG.md", "REPORT.md", "RESULTS.md", "AUDIT.md", "DECISIONS.md", "CHANGELOG.md",
            "CITATION.cff", "SECURITY.md", "LICENSE", "DATA_LICENSE.md", "data/README.md",
            "results/data_audit.json", "results/verdicts.json", "results/headline_table.md",
            "scripts/reproduce_headline.py", "experiments/run_all.sh"]
    missing = [p for p in need if not os.path.exists(os.path.join(ROOT, p))]
    assert not missing, "missing: " + ", ".join(missing)


def test_no_public_grade():
    public = glob.glob(os.path.join(ROOT, "*.md")) + glob.glob(os.path.join(ROOT, "docs", "**", "*.md"), recursive=True) \
        + glob.glob(os.path.join(ROOT, "site", "src", "*"))
    for path in public:
        text = open(path, encoding="utf-8").read()
        for mark in ("of 10,000", "10,000 scale", "Grade:", "GRADE"):
            assert mark not in text, f"{os.path.relpath(path, ROOT)} carries a grade ({mark!r}); grades are internal"


def test_readme_opens_with_the_abstract():
    text = open(os.path.join(ROOT, "README.md"), encoding="utf-8").read()
    for field in ("**Question.**", "**Headline.**", "**Field.**", "**Job family.**", "**Verdict.**", "## Lifecycle"):
        assert field in text, "README.md is missing " + field
