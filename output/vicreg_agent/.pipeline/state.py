"""Coordinator helper: maintain reports/agent-runs.json (schema 1) from recorded host events."""
import hashlib, json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / "reports/agent-runs.json"
def h(p): return hashlib.sha256((ROOT / p).read_bytes()).hexdigest()
def load():
    if STATE.exists(): return json.loads(STATE.read_text())
    return {"schema_version": 1, "route": "python",
            "repository": {"url": "https://github.com/facebookresearch/vicreg", "commit": "4e12602fd495af83efd1631fbe82523e6db092e0"},
            "tutorials": [{"id": "vicreg_loss", "module": "main_vicreg", "source": "repo/vicreg/main_vicreg.py", "sha256": h("repo/vicreg/main_vicreg.py")}],
            "runs": [], "exclusions": []}
def save(s): STATE.write_text(json.dumps(s, indent=2) + "\n")
def add_run(rec, produced=None, tested=None):
    s = load()
    rec["report_sha256"] = h(rec["report"])
    if produced: rec["produced_files"] = {p: h(p) for p in produced}
    if tested: rec["tested_files"] = {p: h(p) for p in tested}
    s["runs"] = [r for r in s["runs"] if r["id"] != rec["id"]] + [rec]
    save(s)
if __name__ == "__main__":
    add_run(json.loads(sys.argv[1]), json.loads(sys.argv[2]) if len(sys.argv) > 2 else None, json.loads(sys.argv[3]) if len(sys.argv) > 3 else None)
