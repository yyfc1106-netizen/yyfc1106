"""Reference driver for execution id `vicreg_loss`.

Calls the UPSTREAM main_vicreg.VICReg.forward (repo/vicreg @ 4e12602) on seeded
embedding pairs, with backbone/projector = nn.Identity, args.batch_size = n,
args.mlp = str(d), num_features = d (binding from reports/tutorial-scanner.json).
The loss is NOT re-implemented here: every number below is returned by upstream forward.

Usage (run with PYTHONDONTWRITEBYTECODE=1):
  python run_reference.py generate   # create seeded inputs in data/, run, write reference_outputs.json
  python run_reference.py replay     # fresh process: load data/*.npy, rerun, compare -> replay_comparison.json
"""
import argparse
import hashlib
import json
import os
import platform
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parents[1]
REPO = PROJECT_ROOT / "repo" / "vicreg"
DATA = HERE / "data"
sys.dont_write_bytecode = True
sys.path.insert(0, str(REPO))

import numpy as np  # noqa: E402
import torch  # noqa: E402
import torch.distributed as dist  # noqa: E402
from torch import nn  # noqa: E402

import main_vicreg  # noqa: E402  (upstream, unmodified)

DEFAULT = (25.0, 25.0, 1.0)
UNIT = {"invariance": (1.0, 0.0, 0.0), "variance": (0.0, 1.0, 0.0), "covariance": (0.0, 0.0, 1.0)}


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def init_group():
    if not dist.is_initialized():
        fd, f = tempfile.mkstemp(prefix="vicreg_gloo_")
        os.close(fd)
        os.remove(f)
        dist.init_process_group("gloo", init_method=f"file://{f}", world_size=1, rank=0)
    assert dist.get_world_size() == 1


def build_module(n, d, coeffs):
    """Upstream VICReg instance without its ResNet (scanner binding: __init__ bypassed)."""
    m = main_vicreg.VICReg.__new__(main_vicreg.VICReg)
    nn.Module.__init__(m)
    m.args = argparse.Namespace(batch_size=n, sim_coeff=coeffs[0], std_coeff=coeffs[1],
                                cov_coeff=coeffs[2], mlp=str(d))
    m.num_features = d
    m.backbone = nn.Identity()
    m.projector = nn.Identity()
    return m


def upstream_loss(z, zp, coeffs):
    n, d = z.shape
    m = build_module(n, d, coeffs)
    with torch.no_grad():
        out = m.forward(z, zp)
    return out


def run_case(z, zp, coeffs):
    total = upstream_loss(z, zp, coeffs)
    terms = {k: upstream_loss(z, zp, c).item() for k, c in UNIT.items()}
    return {
        "n": int(z.shape[0]), "d": int(z.shape[1]),
        "input_dtype": str(z.dtype).replace("torch.", ""),
        "output_dtype": str(total.dtype).replace("torch.", ""),
        "output_shape": list(total.shape),
        "coefficients": {"sim_coeff": coeffs[0], "std_coeff": coeffs[1], "cov_coeff": coeffs[2]},
        "total_loss": total.item(),
        "invariance_loss": terms["invariance"],
        "variance_loss": terms["variance"],
        "covariance_loss": terms["covariance"],
    }


def make_inputs():
    """Seeded inputs; returns {case: (z, zp, coeffs, provenance)}."""
    cases = {}
    g = torch.Generator().manual_seed(0)
    z = torch.randn(64, 32, generator=g)
    noise = torch.randn(64, 32, generator=g)
    zp = z + 0.1 * noise
    prov_a = "torch.Generator().manual_seed(0); Z=randn(64,32); noise=randn(64,32); Z'=Z+0.1*noise (float32)"
    cases["a_default"] = (z, zp, DEFAULT, prov_a)
    cases["c_identical"] = (z, z.clone(), DEFAULT, "Z from case a; Z'=Z.clone()")
    zc = torch.full((64, 32), 0.5)
    cases["d_collapsed"] = (zc, zc.clone(), DEFAULT, "constant 0.5 for Z and Z' (64x32, float32), full collapse")
    g2 = torch.Generator().manual_seed(1)
    z2 = torch.randn(128, 256, generator=g2)
    zp2 = torch.randn(128, 256, generator=g2)
    cases["e_128x256_custom"] = (z2, zp2, (10.0, 5.0, 2.0),
                                 "torch.Generator().manual_seed(1); Z=randn(128,256); Z'=randn(128,256) independent (float32); coeffs (10,5,2)")
    return cases


def save_inputs(cases):
    DATA.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for name, (z, zp, coeffs, prov) in cases.items():
        entry = {"coefficients": list(coeffs), "provenance": prov, "files": {}}
        for tag, t in (("z", z), ("zp", zp)):
            p = DATA / f"{name}_{tag}.npy"
            np.save(p, t.numpy())
            entry["files"][tag] = {"path": str(p.relative_to(PROJECT_ROOT)), "shape": list(t.shape),
                                   "dtype": str(t.numpy().dtype), "sha256": sha256(p)}
        manifest[name] = entry
    (DATA / "inputs_manifest.json").write_text(json.dumps(manifest, indent=2))
    return manifest


def load_inputs():
    manifest = json.loads((DATA / "inputs_manifest.json").read_text())
    out = {}
    for name, e in manifest.items():
        ts = []
        for tag in ("z", "zp"):
            f = e["files"][tag]
            p = PROJECT_ROOT / f["path"]
            assert sha256(p) == f["sha256"], f"hash mismatch {p}"
            ts.append(torch.from_numpy(np.load(p)))
        out[name] = (ts[0], ts[1], tuple(e["coefficients"]), e["provenance"])
    return out


def compute_all(cases):
    results = {}
    for name, (z, zp, coeffs, prov) in cases.items():
        results[name] = run_case(z, zp, coeffs)
        results[name]["input_provenance"] = prov
    # (b) per-term cross-check on case a: linearity in coefficients (unit-coefficient calls)
    a = results["a_default"]
    c = a["coefficients"]
    recon = c["sim_coeff"] * a["invariance_loss"] + c["std_coeff"] * a["variance_loss"] + c["cov_coeff"] * a["covariance_loss"]
    results["b_per_term_check_on_a"] = {
        "note": "Per-term values are upstream forward with coefficient triples (1,0,0),(0,1,0),(0,0,1); reconstruction uses Python float64 arithmetic on float32 outputs.",
        "weighted_sum_of_terms": recon,
        "total_loss": a["total_loss"],
        "abs_diff": abs(recon - a["total_loss"]),
    }
    # float dtype behaviour: same case-a data cast to float64
    z, zp, coeffs, _ = cases["a_default"]
    r64 = run_case(z.double(), zp.double(), coeffs)
    r64["input_provenance"] = "case a inputs cast to float64 (.double())"
    results["f_dtype_float64_of_a"] = r64
    results["f_dtype_float64_of_a"]["abs_diff_total_vs_float32"] = abs(r64["total_loss"] - results["a_default"]["total_loss"])
    # (g) equivalence of __init__-bypass vs real VICReg(args) construction (resnet34 + projector discarded)
    args = argparse.Namespace(arch="resnet34", mlp=str(z.shape[1]), batch_size=z.shape[0],
                              sim_coeff=coeffs[0], std_coeff=coeffs[1], cov_coeff=coeffs[2])
    torch.manual_seed(0)
    real = main_vicreg.VICReg(args)
    real.backbone = nn.Identity()
    real.projector = nn.Identity()
    with torch.no_grad():
        real_total = real.forward(z, zp).item()
    results["g_real_init_equivalence_on_a"] = {
        "num_features_from_upstream_init": real.num_features,
        "total_loss": real_total,
        "equal_to_a_default": real_total == results["a_default"]["total_loss"],
    }
    return results


def runtime_info():
    return {"python": sys.version.split()[0], "torch": torch.__version__, "numpy": np.__version__,
            "platform": platform.platform(), "torch_threads": torch.get_num_threads(),
            "world_size": dist.get_world_size(), "backend": dist.get_backend(),
            "upstream_file": str(Path(main_vicreg.__file__).resolve()),
            "upstream_sha256": sha256(main_vicreg.__file__)}


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "generate"
    torch.use_deterministic_algorithms(True)
    init_group()
    t0 = time.time()
    try:
        if mode == "generate":
            cases = make_inputs()
            save_inputs(cases)
            cases = load_inputs()  # compute from the exact saved bytes
            res = compute_all(cases)
            out = {"execution_id": "vicreg_loss", "mode": "generate", "runtime": runtime_info(),
                   "elapsed_s": time.time() - t0, "results": res}
            (HERE / "reference_outputs.json").write_text(json.dumps(out, indent=2))
            print(json.dumps(res["a_default"], indent=2))
        elif mode == "replay":
            ref = json.loads((HERE / "reference_outputs.json").read_text())["results"]
            res = compute_all(load_inputs())
            cmp = {}
            ok = True
            for name, r in res.items():
                for k, v in r.items():
                    if isinstance(v, float) and k != "elapsed_s":
                        rv = ref[name][k]
                        diff = abs(v - rv)
                        # float32 CPU on the same machine/threads is expected to be bit-identical
                        passed = diff <= 1e-6 * max(1.0, abs(rv))
                        ok &= passed
                        cmp[f"{name}.{k}"] = {"reference": rv, "replay": v, "abs_diff": diff,
                                              "exact": v == rv, "pass": passed}
            all_exact = all(c["exact"] for c in cmp.values())
            out = {"execution_id": "vicreg_loss", "mode": "replay", "runtime": runtime_info(),
                   "tolerance": "abs_diff <= 1e-6 * max(1, |ref|); exact equality also reported",
                   "all_pass": ok, "all_exact": all_exact, "comparisons": cmp,
                   "elapsed_s": time.time() - t0}
            (HERE / "replay_comparison.json").write_text(json.dumps(out, indent=2))
            print(f"replay all_pass={ok} all_exact={all_exact} n_compared={len(cmp)}")
            if not ok:
                sys.exit(1)
        else:
            sys.exit(f"unknown mode {mode}")
    finally:
        dist.destroy_process_group()


if __name__ == "__main__":
    main()
