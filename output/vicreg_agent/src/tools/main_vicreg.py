"""Tools wrapping the VICReg loss from facebookresearch/vicreg main_vicreg.py (VICReg.forward).

The loss is computed by the unmodified upstream ``main_vicreg.VICReg.forward`` from the
pinned checkout (repo/vicreg @ 4e12602). Backbone and projector are replaced by
``nn.Identity`` so that forward receives the user's embeddings directly as the
expander outputs Z and Z' (paper Sec. 4.1, Eq. 1-6, Algorithm 1).
"""
import argparse
import importlib.util
import json
import os
import sys
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal

import numpy as np
import torch
import torch.distributed as dist
from fastmcp import FastMCP
from torch import nn

PROJECT_ROOT = Path(__file__).resolve().parents[2]
REPO_DIR = Path(os.environ.get("VICREG_REPO_DIR", PROJECT_ROOT / "repo" / "vicreg")).resolve()
DEFAULT_OUTPUT_BASE = PROJECT_ROOT / "tmp" / "outputs"
UPSTREAM_COMMIT = "4e12602fd495af83efd1631fbe82523e6db092e0"
REFERENCE = f"https://github.com/facebookresearch/vicreg/blob/{UPSTREAM_COMMIT}/main_vicreg.py"

# Import the upstream module from the pinned checkout without writing __pycache__ into it.
if not (REPO_DIR / "main_vicreg.py").is_file():
    raise ImportError(f"main_vicreg.py not found in {REPO_DIR}; set VICREG_REPO_DIR to the vicreg checkout")
sys.dont_write_bytecode = True
if str(REPO_DIR) not in sys.path:
    sys.path.insert(0, str(REPO_DIR))  # upstream imports its siblings augmentations/distributed/resnet
# Loaded by file path under a distinct name: this wrapper module is itself named main_vicreg.
_spec = importlib.util.spec_from_file_location("vicreg_upstream_main_vicreg", REPO_DIR / "main_vicreg.py")
main_vicreg = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = main_vicreg
_spec.loader.exec_module(main_vicreg)  # upstream, unmodified

main_vicreg_mcp = FastMCP(name="main_vicreg")

# Unit coefficient triples (sim, std, cov) that make upstream forward return each unweighted term.
_UNIT_COEFFS = {
    "invariance_loss": (1.0, 0.0, 0.0),
    "variance_loss": (0.0, 1.0, 0.0),
    "covariance_loss": (0.0, 0.0, 1.0),
}
_TEXT_DELIMITERS = {".csv": ",", ".tsv": "\t", ".txt": None}
_lock = threading.Lock()


def _ensure_process_group() -> None:
    """VICReg.forward all-gathers via FullGatherLayer; use a single-process gloo group."""
    if not dist.is_initialized():
        fd, init_file = tempfile.mkstemp(prefix="vicreg_gloo_")
        os.close(fd)
        os.remove(init_file)
        dist.init_process_group("gloo", init_method=f"file://{init_file}", world_size=1, rank=0)
    if dist.get_world_size() != 1:
        raise RuntimeError("vicreg_compute_loss expects a single-process group (world_size=1)")


def _load_embeddings(path_str: str, name: str, dtype: np.dtype) -> np.ndarray:
    path = Path(path_str).expanduser()
    if not path.is_file():
        raise FileNotFoundError(f"{name}: file not found: {path}")
    suffix = path.suffix.lower()
    try:
        if suffix == ".npy":
            arr = np.load(path, allow_pickle=False)
        elif suffix in _TEXT_DELIMITERS:
            arr = np.loadtxt(path, delimiter=_TEXT_DELIMITERS[suffix], dtype=np.float64, ndmin=2)
        else:
            raise ValueError(f"{name}: unsupported extension '{suffix}' (use .npy, .csv, .tsv or .txt)")
        arr = np.asarray(arr, dtype=dtype)
    except ValueError as exc:
        raise ValueError(f"{name}: could not read a numeric array from {path}: {exc}") from exc
    if arr.ndim != 2:
        raise ValueError(f"{name}: expected a 2-D array [n, d], got shape {list(arr.shape)}")
    if not np.all(np.isfinite(arr)):
        raise ValueError(f"{name}: contains NaN or infinite values")
    return arr


def _upstream_loss(z: torch.Tensor, z_prime: torch.Tensor, coeffs: tuple[float, float, float]) -> float:
    """Call upstream VICReg.forward with identity backbone/projector (scanner binding)."""
    n, d = z.shape
    module = main_vicreg.VICReg.__new__(main_vicreg.VICReg)
    nn.Module.__init__(module)
    module.args = argparse.Namespace(batch_size=n, sim_coeff=coeffs[0], std_coeff=coeffs[1],
                                     cov_coeff=coeffs[2], mlp=str(d))
    module.num_features = d
    module.backbone = nn.Identity()
    module.projector = nn.Identity()
    with torch.no_grad():
        return float(module.forward(z, z_prime).item())


@main_vicreg_mcp.tool()
def vicreg_compute_loss(
    embeddings_path: Annotated[str, "Embeddings Z of the first view/branch as a 2-D numeric array [n, d]: .npy, or header-less numeric .csv (comma), .tsv (tab) or .txt (whitespace)"],
    embeddings_prime_path: Annotated[str, "Embeddings Z' of the second view/branch, same shape [n, d] and row order as embeddings_path, same file formats"],
    sim_coeff: Annotated[float, "Invariance (MSE) loss coefficient lambda; upstream default 25.0"] = 25.0,
    std_coeff: Annotated[float, "Variance (std hinge, gamma=1, eps=1e-4) loss coefficient mu; upstream default 25.0"] = 25.0,
    cov_coeff: Annotated[float, "Covariance (off-diagonal) loss coefficient nu; upstream default 1.0"] = 1.0,
    dtype: Annotated[Literal["float32", "float64"], "Floating-point precision for the computation; upstream trains in float32"] = "float32",
    output_dir: Annotated[str | None, "Base output directory; a fresh subdirectory is created per call (default: <project>/tmp/outputs)"] = None,
) -> dict:
    """Compute the VICReg loss and its invariance/variance/covariance terms for two embedding matrices.
    Two [n, d] embedding files -> JSON with total loss, unweighted terms and weighted contributions.
    """
    np_dtype = np.float32 if dtype == "float32" else np.float64
    z_np = _load_embeddings(embeddings_path, "embeddings_path", np_dtype)
    zp_np = _load_embeddings(embeddings_prime_path, "embeddings_prime_path", np_dtype)
    if z_np.shape != zp_np.shape:
        raise ValueError(f"shape mismatch: embeddings_path {list(z_np.shape)} vs embeddings_prime_path {list(zp_np.shape)}")
    n, d = z_np.shape
    if n < 2:
        raise ValueError(f"need at least 2 samples (rows) to compute variance/covariance, got n={n}")

    z = torch.from_numpy(np.ascontiguousarray(z_np))
    zp = torch.from_numpy(np.ascontiguousarray(zp_np))
    coeffs = (float(sim_coeff), float(std_coeff), float(cov_coeff))
    with _lock:
        _ensure_process_group()
        total = _upstream_loss(z, zp, coeffs)
        terms = {key: _upstream_loss(z, zp, unit) for key, unit in _UNIT_COEFFS.items()}
    print(f"[vicreg_compute_loss] n={n} d={d} dtype={dtype} total={total}", file=sys.stderr)

    coefficients = {"sim_coeff": coeffs[0], "std_coeff": coeffs[1], "cov_coeff": coeffs[2]}
    weighted = {
        "invariance": coeffs[0] * terms["invariance_loss"],
        "variance": coeffs[1] * terms["variance_loss"],
        "covariance": coeffs[2] * terms["covariance_loss"],
    }
    base = Path(output_dir).expanduser() if output_dir else DEFAULT_OUTPUT_BASE
    run_dir = base / f"vicreg_loss_{datetime.now(timezone.utc):%Y%m%dT%H%M%S}_{uuid.uuid4().hex[:8]}"
    run_dir.mkdir(parents=True, exist_ok=False)
    json_path = run_dir / "vicreg_loss.json"
    record = {
        "total_loss": total,
        **terms,
        "weighted_contributions": weighted,
        "n_samples": n,
        "n_features": d,
        "coefficients": coefficients,
        "dtype": dtype,
        "inputs": {"embeddings_path": str(Path(embeddings_path).expanduser().resolve()),
                   "embeddings_prime_path": str(Path(embeddings_prime_path).expanduser().resolve())},
        "method": "upstream main_vicreg.VICReg.forward with identity backbone/projector, batch_size=n, "
                  "num_features=d, world_size=1; unweighted terms from forward with unit coefficients",
        "reference": REFERENCE,
    }
    json_path.write_text(json.dumps(record, indent=2))

    return {
        "message": f"VICReg loss for {n} x {d} embeddings: total={total:.6g} "
                   f"(invariance={terms['invariance_loss']:.6g}, variance={terms['variance_loss']:.6g}, "
                   f"covariance={terms['covariance_loss']:.6g})",
        "reference": REFERENCE,
        "artifacts": [{"description": "VICReg loss values, terms, coefficients and settings (JSON)",
                       "path": str(json_path.resolve())}],
        "total_loss": total,
        "invariance_loss": terms["invariance_loss"],
        "variance_loss": terms["variance_loss"],
        "covariance_loss": terms["covariance_loss"],
        "n_samples": n,
        "n_features": d,
        "coefficients": coefficients,
    }
