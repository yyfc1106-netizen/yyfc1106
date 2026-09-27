"""Independent verification of the `vicreg_compute_loss` MCP tool (module main_vicreg).

Expectations come from (1) the saved upstream reference driver outputs
(notebooks/vicreg_loss/reference_outputs.json), (2) NEW direct calls of the pinned upstream
``main_vicreg.VICReg.forward`` made here independently of the wrapper, (3) a float64 numpy
re-derivation of the paper's Algorithm 1 / Eq. 1-6 (test-only), and (4) properties that follow
from the definition of the loss. The tool is always exercised through ``fastmcp.Client``.
"""
import argparse
import ast
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import pytest
import torch
import torch.distributed as dist
from fastmcp import Client
from fastmcp.exceptions import ToolError
from torch import nn

PROJECT_ROOT = Path(__file__).resolve().parents[3]
sys.dont_write_bytecode = True
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from tools.main_vicreg import main_vicreg_mcp  # noqa: E402

TOOL = "vicreg_compute_loss"
SRC_FILE = PROJECT_ROOT / "src" / "tools" / "main_vicreg.py"
REPO_DIR = PROJECT_ROOT / "repo" / "vicreg"
REF_DIR = PROJECT_ROOT / "notebooks" / "vicreg_loss"
REF_DATA = REF_DIR / "data"
REF = json.loads((REF_DIR / "reference_outputs.json").read_text())["results"]
FIX = PROJECT_ROOT / "tests" / "data" / "main_vicreg"
OUT = PROJECT_ROOT / "tmp" / "outputs" / "verify_main_vicreg"
RESULTS = PROJECT_ROOT / "tests" / "results" / "main_vicreg"
TERMS = ("total_loss", "invariance_loss", "variance_loss", "covariance_loss")

# float32 tolerance: same machine/threads normally gives bit-exact values (the executor observed
# exact replay); 1e-6 relative (~8 float32 ulps) only guards reduction-order differences.
RTOL32 = 1e-6
# float64 tolerance for float64 computations (reductions of <= 128*256 terms).
RTOL64 = 1e-10

# ---------------------------------------------------------------------------------------------
# Independent direct upstream access (own module object, not the wrapper's).
if str(REPO_DIR) not in sys.path:
    sys.path.insert(0, str(REPO_DIR))
_spec = importlib.util.spec_from_file_location("verify_upstream_main_vicreg", REPO_DIR / "main_vicreg.py")
upstream = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = upstream
_spec.loader.exec_module(upstream)


def _init_group():
    if not dist.is_initialized():
        fd, f = tempfile.mkstemp(prefix="verify_vicreg_gloo_")
        os.close(fd)
        os.remove(f)
        dist.init_process_group("gloo", init_method=f"file://{f}", world_size=1, rank=0)
    assert dist.get_world_size() == 1


def direct_forward(z: np.ndarray, zp: np.ndarray, coeffs) -> float:
    """Upstream VICReg.forward with identity backbone/projector, batch_size=n, num_features=d."""
    _init_group()
    n, d = z.shape
    m = upstream.VICReg.__new__(upstream.VICReg)
    nn.Module.__init__(m)
    m.args = argparse.Namespace(batch_size=n, sim_coeff=coeffs[0], std_coeff=coeffs[1],
                                cov_coeff=coeffs[2], mlp=str(d))
    m.num_features = d
    m.backbone = nn.Identity()
    m.projector = nn.Identity()
    with torch.no_grad():
        return float(m.forward(torch.from_numpy(z.copy()), torch.from_numpy(zp.copy())).item())


def direct_all(z, zp, coeffs):
    return {
        "total_loss": direct_forward(z, zp, coeffs),
        "invariance_loss": direct_forward(z, zp, (1.0, 0.0, 0.0)),
        "variance_loss": direct_forward(z, zp, (0.0, 1.0, 0.0)),
        "covariance_loss": direct_forward(z, zp, (0.0, 0.0, 1.0)),
    }


def numpy_paper_terms(z, zp, batch_size=None, eps=1e-4, gamma=1.0):
    """Float64 re-derivation of Algorithm 1 (paper App. A) with N = batch_size (default n).

    Returns Algorithm-1 quantities: sim = mse over n*d elements; std_sum = v(Z)+v(Z') (Eq. 1-2);
    cov = c(Z)+c(Z') (Eq. 3-4) with C = Zc^T Zc / (N-1) and 1/d scaling.
    """
    z = np.asarray(z, np.float64)
    zp = np.asarray(zp, np.float64)
    n, d = z.shape
    N = n if batch_size is None else batch_size
    sim = np.mean((z - zp) ** 2)

    def v(x):
        s = np.sqrt(x.var(axis=0, ddof=1) + eps)
        return np.mean(np.maximum(0.0, gamma - s))

    def c(x):
        xc = x - x.mean(axis=0)
        cov = xc.T @ xc / (N - 1)
        off = cov[~np.eye(d, dtype=bool)]
        return np.sum(off ** 2) / d

    return {"sim": sim, "std_sum": v(z) + v(zp), "cov": c(z) + c(zp)}


def close(a, b, rtol):
    return abs(a - b) <= rtol * max(1.0, abs(b))


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


async def call(**arguments):
    async with Client(main_vicreg_mcp) as client:
        result = await client.call_tool(TOOL, arguments)
    return result.data


def outdir(name):
    d = OUT / name
    d.mkdir(parents=True, exist_ok=True)
    return str(d)


def save_pair(tmp_path, z, zp, tag="x"):
    a, b = tmp_path / f"{tag}_z.npy", tmp_path / f"{tag}_zp.npy"
    np.save(a, z)
    np.save(b, zp)
    return str(a), str(b)


def check_artifact(data, base):
    assert set(("message", "reference", "artifacts")) <= set(data)
    assert "4e12602fd495af83efd1631fbe82523e6db092e0" in data["reference"]
    assert len(data["artifacts"]) == 1
    p = Path(data["artifacts"][0]["path"])
    assert p.is_absolute() and p.is_file()
    assert Path(base).resolve() in p.resolve().parents
    rec = json.loads(p.read_text())
    for k in TERMS:
        assert rec[k] == data[k]
    assert rec["n_samples"] == data["n_samples"] and rec["n_features"] == data["n_features"]
    assert rec["coefficients"] == data["coefficients"]
    c = data["coefficients"]
    w = rec["weighted_contributions"]
    assert w["invariance"] == c["sim_coeff"] * data["invariance_loss"]
    assert w["variance"] == c["std_coeff"] * data["variance_loss"]
    assert w["covariance"] == c["cov_coeff"] * data["covariance_loss"]
    return rec


# ---------------------------------------------------------------------------------------------
# 1. Saved reference cases (a, c, d, e, f) and linearity case b.
REF_CASES = ["a_default", "c_identical", "d_collapsed", "e_128x256_custom"]
_comparisons = {}


@pytest.fixture(scope="module", autouse=True)
def _write_comparisons():
    yield
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "reference_comparisons.json").write_text(json.dumps(_comparisons, indent=2))


@pytest.mark.parametrize("case", REF_CASES)
async def test_reference_case(case):
    ref = REF[case]
    z, zp = REF_DATA / f"{case}_z.npy", REF_DATA / f"{case}_zp.npy"
    c = ref["coefficients"]
    before = (sha(z), sha(zp))
    data = await call(embeddings_path=str(z), embeddings_prime_path=str(zp), output_dir=outdir(f"ref_{case}"), **c)
    assert (sha(z), sha(zp)) == before
    assert data["n_samples"] == ref["n"] and data["n_features"] == ref["d"]
    assert data["coefficients"] == c
    rec = check_artifact(data, OUT)
    assert rec["dtype"] == "float32"
    comp = {}
    for k in TERMS:
        assert np.isfinite(data[k])
        assert close(data[k], ref[k], RTOL32), (k, data[k], ref[k])
        comp[k] = {"tool": data[k], "reference": ref[k], "abs_diff": abs(data[k] - ref[k]),
                   "exact": data[k] == ref[k]}
    _comparisons[case] = comp


async def test_reference_case_b_linearity():
    ref = REF["a_default"]
    data = await call(embeddings_path=str(REF_DATA / "a_default_z.npy"),
                      embeddings_prime_path=str(REF_DATA / "a_default_zp.npy"), output_dir=outdir("ref_b"))
    recon = 25.0 * data["invariance_loss"] + 25.0 * data["variance_loss"] + 1.0 * data["covariance_loss"]
    assert close(recon, REF["b_per_term_check_on_a"]["weighted_sum_of_terms"], RTOL32)
    # float32 total vs float64 reconstruction from float32 terms: a few ulps at magnitude ~2
    assert abs(recon - data["total_loss"]) <= 1e-6 * max(1.0, abs(ref["total_loss"]))
    _comparisons["b_per_term_check_on_a"] = {"weighted_sum": recon, "total": data["total_loss"],
                                             "abs_diff": abs(recon - data["total_loss"])}


async def test_reference_case_f_float64():
    ref = REF["f_dtype_float64_of_a"]
    data = await call(embeddings_path=str(REF_DATA / "a_default_z.npy"),
                      embeddings_prime_path=str(REF_DATA / "a_default_zp.npy"), dtype="float64",
                      output_dir=outdir("ref_f"))
    assert check_artifact(data, OUT)["dtype"] == "float64"
    comp = {}
    for k in TERMS:
        assert close(data[k], ref[k], RTOL64), (k, data[k], ref[k])
        comp[k] = {"tool": data[k], "reference": ref[k], "abs_diff": abs(data[k] - ref[k]), "exact": data[k] == ref[k]}
    # float64 differs from float32 by roughly float32 precision, so dtype is actually honored
    assert data["total_loss"] != REF["a_default"]["total_loss"]
    assert abs(data["total_loss"] - REF["a_default"]["total_loss"]) < 1e-5
    _comparisons["f_dtype_float64_of_a"] = comp


# ---------------------------------------------------------------------------------------------
# 2. Changed inputs vs NEW direct upstream calls.
CHANGED = [
    # (seed, n, d, coeffs, dtype)
    (11, 50, 20, (3.5, 0.7, 12.0), "float32"),
    (12, 17, 300, (25.0, 25.0, 1.0), "float32"),   # d > n
    (13, 2, 5, (1.0, 2.0, 3.0), "float32"),         # minimum n
    (14, 40, 1, (25.0, 25.0, 1.0), "float32"),      # d = 1 -> covariance 0
    (15, 96, 64, (0.0, 10.0, 0.5), "float64"),
]


@pytest.mark.parametrize("seed,n,d,coeffs,dtype", CHANGED)
async def test_changed_inputs_vs_direct_upstream(tmp_path, seed, n, d, coeffs, dtype):
    rng = np.random.default_rng(seed)
    npdt = np.float32 if dtype == "float32" else np.float64
    mix = rng.standard_normal((d, d)) * 0.3  # correlated features -> nonzero covariance
    z = (rng.standard_normal((n, d)) @ (np.eye(d) + mix) * rng.uniform(0.2, 1.5)).astype(npdt)
    zp = (z + 0.3 * rng.standard_normal((n, d))).astype(npdt)
    a, b = save_pair(tmp_path, z, zp)
    data = await call(embeddings_path=a, embeddings_prime_path=b, sim_coeff=coeffs[0], std_coeff=coeffs[1],
                      cov_coeff=coeffs[2], dtype=dtype, output_dir=outdir("changed"))
    check_artifact(data, OUT)
    exp = direct_all(z, zp, coeffs)
    rtol = RTOL32 if dtype == "float32" else RTOL64
    for k in TERMS:
        assert close(data[k], exp[k], rtol), (k, data[k], exp[k])
    assert data["n_samples"] == n and data["n_features"] == d
    assert data["coefficients"] == dict(zip(("sim_coeff", "std_coeff", "cov_coeff"), coeffs))
    if d == 1:
        assert data["covariance_loss"] == 0.0


async def test_coefficients_not_ignored(tmp_path):
    a, b = str(REF_DATA / "a_default_z.npy"), str(REF_DATA / "a_default_zp.npy")
    base = await call(embeddings_path=a, embeddings_prime_path=b, output_dir=outdir("coeffs"))
    for coeffs in [(1.0, 25.0, 1.0), (25.0, 1.0, 1.0), (25.0, 25.0, 7.0)]:
        d = await call(embeddings_path=a, embeddings_prime_path=b, sim_coeff=coeffs[0], std_coeff=coeffs[1],
                       cov_coeff=coeffs[2], output_dir=outdir("coeffs"))
        assert d["total_loss"] != base["total_loss"]
        assert close(d["total_loss"], direct_forward(np.load(a), np.load(b), coeffs), RTOL32)
        # unweighted terms do not depend on the coefficients
        for k in TERMS[1:]:
            assert d[k] == base[k]


# ---------------------------------------------------------------------------------------------
# 3. Independently justified properties.
def _rand(seed, n=48, d=24):
    rng = np.random.default_rng(seed)
    return rng.standard_normal((n, d)).astype(np.float32), rng.standard_normal((n, d)).astype(np.float32)


async def test_identical_views_invariance_zero(tmp_path):
    z, _ = _rand(21)
    a, b = save_pair(tmp_path, z, z.copy())
    data = await call(embeddings_path=a, embeddings_prime_path=b, output_dir=outdir("props"))
    assert data["invariance_loss"] == 0.0
    assert data["variance_loss"] > 0 and data["covariance_loss"] > 0


async def test_collapsed_views(tmp_path):
    n, d = 32, 16
    z = np.full((n, d), 0.5, np.float32)
    zp = np.full((n, d), -1.5, np.float32)
    a, b = save_pair(tmp_path, z, zp)
    data = await call(embeddings_path=a, embeddings_prime_path=b, output_dir=outdir("props"))
    # zero variance -> std = sqrt(1e-4) = 0.01, hinge 1 - 0.01 = 0.99 per dim, averaged over branches
    assert abs(data["variance_loss"] - (1 - np.sqrt(1e-4))) < 1e-6
    assert data["covariance_loss"] == 0.0
    assert abs(data["invariance_loss"] - 4.0) < 1e-6  # (0.5 - (-1.5))^2
    assert abs(data["total_loss"] - (25 * 4.0 + 25 * 0.99)) < 1e-4


async def test_linearity_in_coefficients(tmp_path):
    z, zp = _rand(22)
    a, b = save_pair(tmp_path, z, zp)
    coeffs = (2.25, 13.0, 4.5)
    data = await call(embeddings_path=a, embeddings_prime_path=b, sim_coeff=coeffs[0], std_coeff=coeffs[1],
                      cov_coeff=coeffs[2], dtype="float64", output_dir=outdir("props"))
    recon = sum(c * data[k] for c, k in zip(coeffs, TERMS[1:]))
    assert close(recon, data["total_loss"], 1e-12)


async def test_covariance_scale_sensitivity(tmp_path):
    z, zp = _rand(23)
    s = 3.0
    a, b = save_pair(tmp_path, z.astype(np.float64), zp.astype(np.float64), "base")
    c, d = save_pair(tmp_path, s * z.astype(np.float64), s * zp.astype(np.float64), "scaled")
    d0 = await call(embeddings_path=a, embeddings_prime_path=b, dtype="float64", output_dir=outdir("props"))
    d1 = await call(embeddings_path=c, embeddings_prime_path=d, dtype="float64", output_dir=outdir("props"))
    # covariance entries scale by s^2, squared off-diagonals by s^4; MSE by s^2
    assert close(d1["covariance_loss"], s ** 4 * d0["covariance_loss"], 1e-10)
    assert close(d1["invariance_loss"], s ** 2 * d0["invariance_loss"], 1e-10)
    assert d1["variance_loss"] < d0["variance_loss"]


async def test_swap_views_symmetric(tmp_path):
    z, zp = _rand(24)
    a, b = save_pair(tmp_path, z, zp)
    d0 = await call(embeddings_path=a, embeddings_prime_path=b, output_dir=outdir("props"))
    d1 = await call(embeddings_path=b, embeddings_prime_path=a, output_dir=outdir("props"))
    for k in TERMS:
        assert close(d0[k], d1[k], RTOL32)


# ---------------------------------------------------------------------------------------------
# 4. Paper Algorithm 1 / Eq. 1-6 re-derivation (test only) and the batch_size = n binding.
@pytest.mark.parametrize("case", ["a_default", "e_128x256_custom"])
async def test_numpy_paper_rederivation(case):
    z = np.load(REF_DATA / f"{case}_z.npy").astype(np.float64)
    zp = np.load(REF_DATA / f"{case}_zp.npy").astype(np.float64)
    a, b = str(REF_DATA / f"{case}_z.npy"), str(REF_DATA / f"{case}_zp.npy")
    data = await call(embeddings_path=a, embeddings_prime_path=b, dtype="float64", output_dir=outdir("paper"))
    p = numpy_paper_terms(z, zp)
    n, d = z.shape
    # invariance: Algorithm 1 mse_loss (mean over n*d); paper Eq. 5 sums over d, i.e. = d * mse
    assert close(data["invariance_loss"], p["sim"], RTOL64)
    # variance: code averages the two branch hinges (/2); Algorithm 1 / Eq. 6 sum v(Z)+v(Z')
    assert close(data["variance_loss"], p["std_sum"] / 2, RTOL64)
    # covariance: Eq. 3-4 with 1/(n-1) (N = n) and 1/d, summed over both branches
    assert close(data["covariance_loss"], p["cov"], RTOL64)
    # The upstream CLI default batch_size=2048 would not match the supplied batch's covariance.
    p2048 = numpy_paper_terms(z, zp, batch_size=2048)
    assert not close(data["covariance_loss"], p2048["cov"], 1e-3)
    assert close(p2048["cov"], p["cov"] * ((n - 1) / 2047) ** 2, 1e-12)


# ---------------------------------------------------------------------------------------------
# 5. Input formats, errors, unchanged inputs, artifact isolation, schema.
@pytest.mark.parametrize("ext,delim", [(".csv", ","), (".tsv", "\t"), (".txt", " ")])
async def test_text_formats_equal_npy(tmp_path, ext, delim):
    z = np.load(REF_DATA / "a_default_z.npy")
    zp = np.load(REF_DATA / "a_default_zp.npy")
    a, b = tmp_path / f"z{ext}", tmp_path / f"zp{ext}"
    np.savetxt(a, z, fmt="%.9g", delimiter=delim)  # 9 significant digits round-trip float32 exactly
    np.savetxt(b, zp, fmt="%.9g", delimiter=delim)
    data = await call(embeddings_path=str(a), embeddings_prime_path=str(b), output_dir=outdir("formats"))
    for k in TERMS:
        assert data[k] == REF["a_default"][k] or close(data[k], REF["a_default"][k], RTOL32)
    ref_npy = await call(embeddings_path=str(REF_DATA / "a_default_z.npy"),
                         embeddings_prime_path=str(REF_DATA / "a_default_zp.npy"), output_dir=outdir("formats"))
    for k in TERMS:
        assert data[k] == ref_npy[k]


ERRORS = [
    ("missing", str(FIX / "does_not_exist.npy"), str(FIX / "a_default_zp.npy"), "file not found"),
    ("mismatch", str(FIX / "a_default_z.npy"), str(FIX / "mismatch_128x32.npy"), "shape mismatch"),
    ("one_d", str(FIX / "one_d_64.npy"), str(FIX / "one_d_64.npy"), "expected a 2-D array"),
    ("single_row", str(FIX / "single_row_1x32.npy"), str(FIX / "single_row_1x32.npy"), "at least 2 samples"),
    ("nan", str(FIX / "nan_64x32.npy"), str(FIX / "a_default_zp.npy"), "NaN or infinite"),
    ("bad_ext", str(FIX / "a_default_z.json"), str(FIX / "a_default_zp.npy"), "unsupported extension"),
]


@pytest.mark.parametrize("name,a,b,frag", ERRORS, ids=[e[0] for e in ERRORS])
async def test_input_errors_are_tool_errors(name, a, b, frag):
    hashes = {p: sha(p) for p in (a, b) if Path(p).exists()}
    out = OUT / f"err_{name}"
    with pytest.raises(ToolError, match=frag) as info:
        await call(embeddings_path=a, embeddings_prime_path=b, output_dir=str(out))
    if name == "bad_ext":  # reported once, not re-wrapped as a numeric read failure
        assert "could not read" not in str(info.value)
    assert {p: sha(p) for p in hashes} == hashes
    assert not out.exists()  # no partial artifacts on invalid input


async def test_inf_and_nonnumeric_text_errors(tmp_path):
    z = np.load(FIX / "a_default_z.npy").copy()
    z[0, 0] = np.inf
    np.save(tmp_path / "inf.npy", z)
    with pytest.raises(ToolError, match="NaN or infinite"):
        await call(embeddings_path=str(tmp_path / "inf.npy"), embeddings_prime_path=str(FIX / "a_default_zp.npy"),
                   output_dir=outdir("errors"))
    (tmp_path / "hdr.csv").write_text("a,b\n1,2\n3,4\n")
    with pytest.raises(ToolError, match="could not read a numeric array"):
        await call(embeddings_path=str(tmp_path / "hdr.csv"), embeddings_prime_path=str(tmp_path / "hdr.csv"),
                   output_dir=outdir("errors"))


async def test_missing_required_argument_is_error():
    with pytest.raises(ToolError):
        await call(embeddings_path=str(FIX / "a_default_z.npy"))
    with pytest.raises(ToolError):
        await call(embeddings_path=str(FIX / "a_default_z.npy"), embeddings_prime_path=str(FIX / "a_default_zp.npy"),
                   dtype="float16")


async def test_repeated_calls_distinct_artifacts():
    args = dict(embeddings_path=str(FIX / "a_default_z.npy"), embeddings_prime_path=str(FIX / "a_default_zp.npy"),
                output_dir=outdir("repeat"))
    before = (sha(args["embeddings_path"]), sha(args["embeddings_prime_path"]))
    paths = []
    for _ in range(3):
        d = await call(**args)
        paths.append(Path(d["artifacts"][0]["path"]))
        assert d["total_loss"] == REF["a_default"]["total_loss"] or close(d["total_loss"], REF["a_default"]["total_loss"], RTOL32)
    assert len({p.parent for p in paths}) == 3 and all(p.exists() for p in paths)
    assert before == (sha(args["embeddings_path"]), sha(args["embeddings_prime_path"]))


async def test_schema():
    async with Client(main_vicreg_mcp) as client:
        tools = await client.list_tools()
    assert [t.name for t in tools] == [TOOL]
    schema = tools[0].input_schema
    assert set(schema["required"]) == {"embeddings_path", "embeddings_prime_path"}
    props = schema["properties"]
    assert set(props) == {"embeddings_path", "embeddings_prime_path", "sim_coeff", "std_coeff", "cov_coeff",
                          "dtype", "output_dir"}
    for k, v in props.items():
        assert v.get("description"), k
    assert props["sim_coeff"]["default"] == 25.0 and props["std_coeff"]["default"] == 25.0
    assert props["cov_coeff"]["default"] == 1.0 and props["dtype"]["default"] == "float32"
    assert set(props["dtype"]["enum"]) == {"float32", "float64"}
    # defaults agree with upstream get_arguments
    parser = upstream.get_arguments()
    ns = parser.parse_args(["--data-dir", "x"])  # --data-dir is required upstream
    assert (ns.sim_coeff, ns.std_coeff, ns.cov_coeff) == (25.0, 25.0, 1.0)


# ---------------------------------------------------------------------------------------------
# 6. Code review: source reuse, format, stdout silence, upstream integrity.
def _tree():
    return ast.parse(SRC_FILE.read_text())


def test_source_reuse_no_duplicated_formula():
    """Production must call upstream VICReg.forward and contain no loss arithmetic of its own."""
    tree = _tree()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            assert node.func.attr not in ("var", "std", "mse_loss", "relu", "sqrt", "pow", "pow_", "cov",
                                          "mean", "matmul", "off_diagonal"), ast.unparse(node)
        assert not isinstance(node, ast.MatMult)
    body = ast.unparse(tree)
    assert "main_vicreg.VICReg.__new__(main_vicreg.VICReg)" in body
    assert "module.forward(z, z_prime)" in body
    assert "spec_from_file_location" in body and "'main_vicreg.py'" in body
    assert "batch_size=n" in body and "module.num_features = d" in body
    assert "backbone = nn.Identity()" in body and "projector = nn.Identity()" in body


def test_tool_format():
    tree = _tree()
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == TOOL)
    assert any("tool" in ast.unparse(dec) for dec in fn.decorator_list)
    for arg in fn.args.args:
        ann = arg.annotation
        assert isinstance(ann, ast.Subscript) and ast.unparse(ann.value) == "Annotated", arg.arg
        desc = ann.slice.elts[1]
        assert isinstance(desc, ast.Constant) and isinstance(desc.value, str) and desc.value, arg.arg
    doc = ast.get_docstring(fn)
    assert len([l for l in doc.splitlines() if l.strip()]) == 2
    assert "Literal" in ast.unparse(next(a for a in fn.args.args if a.arg == "dtype").annotation)
    assert ast.unparse(fn.returns) == "dict"


def test_no_stdout_noise():
    script = (
        "import sys, asyncio; sys.path.insert(0, 'src')\n"
        "from fastmcp import Client\n"
        "from tools.main_vicreg import main_vicreg_mcp\n"
        "async def m():\n"
        "    async with Client(main_vicreg_mcp) as c:\n"
        f"        await c.call_tool('{TOOL}', {{'embeddings_path': '{FIX / 'a_default_z.npy'}', "
        f"'embeddings_prime_path': '{FIX / 'a_default_zp.npy'}', 'output_dir': '{OUT / 'stdout_check'}'}})\n"
        "asyncio.run(m())\n"
    )
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    r = subprocess.run([sys.executable, "-c", script], cwd=PROJECT_ROOT, capture_output=True, text=True, env=env,
                       timeout=300)
    assert r.returncode == 0, r.stderr
    assert r.stdout == ""


def test_upstream_checkout_untouched():
    assert not list(REPO_DIR.rglob("__pycache__"))
    r = subprocess.run(["git", "-C", str(REPO_DIR), "status", "--porcelain"], capture_output=True, text=True)
    assert r.returncode == 0 and r.stdout.strip() == ""
    assert sha(REPO_DIR / "main_vicreg.py") == "88c4439e2c508156c79416cbd7c628d05f52f517e3eb1f66eac8db483485cf20"
