import asyncio, json, os, subprocess, sys
from pathlib import Path
from fastmcp import Client
from fastmcp.client.transports import StdioTransport
B = Path(sys.argv[1]); REF = json.load(open(sys.argv[2]))["results"]
PKG = B / "vicreg-mcp"; PY = str(PKG / ".venv/bin/python"); TI = B / "test-inputs"; OUT = B / "outputs" / "scientific"
TERMS = ("total_loss", "invariance_loss", "variance_loss", "covariance_loss")
env = {k: v for k, v in os.environ.items() if k not in ("VICREG_REPO_DIR", "PYTHONPATH", "VIRTUAL_ENV")}
def direct(z, zp, c, dt="float32"):
    r = subprocess.run([PY, str(B / "scripts/direct_upstream.py"), str(PKG / "repo/vicreg"), str(z), str(zp), *map(str, c), dt],
                       capture_output=True, text=True, env=env, cwd=str(B), check=True)
    return json.loads(r.stdout.strip().splitlines()[-1])
async def main():
    res = {}
    tr = StdioTransport(command=PY, args=[str(PKG / "src/vicreg_mcp.py")], env=env, cwd=str(PKG))
    async with Client(tr) as c:
        async def call(args, expect_error=False):
            r = await c.call_tool("vicreg_compute_loss", args, raise_on_error=False)
            if r.is_error:
                return {"is_error": True, "text": " ".join(getattr(x, "text", "") for x in r.content)}
            data = r.structured_content if r.structured_content is not None else json.loads(r.content[0].text)
            data = data.get("result", data) if isinstance(data, dict) and "total_loss" not in data else data
            art = json.load(open(data["artifacts"][0]["path"]))
            return {"is_error": False, "result": data, "artifact": art}
        def cmp_exact(name, got, art, ref, keys=TERMS):
            rows = {k: {"returned": got[k], "artifact": art[k], "reference": ref[k],
                        "returned_equal": got[k] == ref[k], "artifact_equal": art[k] == ref[k]} for k in keys}
            ok = all(v["returned_equal"] and v["artifact_equal"] for v in rows.values())
            return {"case": name, "comparison": "exact equality (float from JSON)", "values": rows, "pass": ok}
        # reference cases
        specs = [("a_default", "a_default", (25., 25., 1.), "float32"), ("e_128x256_custom", "e_128x256_custom", (10., 5., 2.), "float32"),
                 ("f_dtype_float64_of_a", "a_default", (25., 25., 1.), "float64"), ("c_identical", "c_identical", (25., 25., 1.), "float32"),
                 ("d_collapsed", "d_collapsed", (25., 25., 1.), "float32")]
        comps = []
        for refname, stem, co, dt in specs:
            r = await call({"embeddings_path": str(TI / f"{stem}_z.npy"), "embeddings_prime_path": str(TI / f"{stem}_zp.npy"),
                            "sim_coeff": co[0], "std_coeff": co[1], "cov_coeff": co[2], "dtype": dt, "output_dir": str(OUT)})
            e = cmp_exact(refname, r["result"], r["artifact"], REF[refname])
            art = r["artifact"]; e["artifact_checks"] = {
                "n_samples": art["n_samples"] == REF[refname]["n"], "n_features": art["n_features"] == REF[refname]["d"],
                "coefficients": art["coefficients"] == REF[refname]["coefficients"], "dtype": art["dtype"] == dt,
                "weighted_sum_abs_diff_vs_total": abs(sum(art["weighted_contributions"].values()) - art["total_loss"]),
                "artifact_path": r["result"]["artifacts"][0]["path"]}
            e["pass"] = e["pass"] and all(v for k, v in e["artifact_checks"].items() if isinstance(v, bool))
            comps.append(e)
        res["reference_comparisons"] = comps
        # changed input vs direct upstream
        ch = []
        for fmt in ("npy", "csv"):
            for co, dt in (((3., 7., .5), "float32"), ((25., 25., 1.), "float64")):
                z, zp = TI / f"new_seeded_z.{fmt}", TI / f"new_seeded_zp.{fmt}"
                r = await call({"embeddings_path": str(z), "embeddings_prime_path": str(zp), "sim_coeff": co[0], "std_coeff": co[1],
                                "cov_coeff": co[2], "dtype": dt, "output_dir": str(OUT)})
                dref = direct(z, zp, co, dt)
                rows = {k: {"returned": r["result"][k], "artifact": r["artifact"][k], "direct_upstream": dref[k]} for k in TERMS}
                ok = all(v["returned"] == v["direct_upstream"] and v["artifact"] == v["direct_upstream"] for v in rows.values())
                ch.append({"input": f"new_seeded (96x48, numpy default_rng(20260927)) .{fmt}", "coeffs": co, "dtype": dt,
                           "direct_upstream_file": dref["upstream_file"], "values": rows, "comparison": "exact equality", "pass": ok,
                           "shape_ok": r["result"]["n_samples"] == 96 and r["result"]["n_features"] == 48})
        res["changed_input_vs_direct_upstream"] = ch
        # error cases
        errs = []
        for nm, a, frag in [("missing", {"embeddings_path": str(TI / "nope.npy"), "embeddings_prime_path": str(TI / "a_default_zp.npy")}, "file not found"),
                            ("mismatch", {"embeddings_path": str(TI / "a_default_z.npy"), "embeddings_prime_path": str(TI / "mismatch_128x32.npy")}, "shape mismatch"),
                            ("bad dtype enum", {"embeddings_path": str(TI / "a_default_z.npy"), "embeddings_prime_path": str(TI / "a_default_zp.npy"), "dtype": "float16"}, "float16")]:
            a["output_dir"] = str(B / "outputs" / "errors")
            r = await call(a)
            errs.append({"case": nm, "is_error": r["is_error"], "contains": frag in r.get("text", ""), "text": r.get("text", "")[:300],
                         "pass": r["is_error"] and frag in r.get("text", "")})
        res["error_cases"] = errs
        res["error_output_dir_created"] = (B / "outputs" / "errors").exists()
        # repeated calls
        rep = []
        for _ in range(3):
            r = await call({"embeddings_path": str(TI / "a_default_z.npy"), "embeddings_prime_path": str(TI / "a_default_zp.npy"), "output_dir": str(B / "outputs" / "repeat")})
            rep.append((r["result"]["artifacts"][0]["path"], r["result"]["total_loss"]))
        res["repeated_calls"] = {"paths": [p for p, _ in rep], "distinct_dirs": len({str(Path(p).parent) for p, _ in rep}) == 3,
                                 "all_exist": all(Path(p).is_file() for p, _ in rep), "identical_totals": len({t for _, t in rep}) == 1,
                                 "pass": None}
        res["repeated_calls"]["pass"] = res["repeated_calls"]["distinct_dirs"] and res["repeated_calls"]["all_exist"] and res["repeated_calls"]["identical_totals"]
        # default output_dir
        r = await call({"embeddings_path": str(TI / "a_default_z.npy"), "embeddings_prime_path": str(TI / "a_default_zp.npy")})
        p = Path(r["result"]["artifacts"][0]["path"])
        res["default_output_dir"] = {"artifact_path": str(p), "under_package_tmp_outputs": str(p).startswith(str((PKG / "tmp" / "outputs").resolve()) + "/"),
                                     "exists": p.is_file(), "total_equals_reference": r["artifact"]["total_loss"] == REF["a_default"]["total_loss"]}
        res["default_output_dir"]["pass"] = all(v for k, v in res["default_output_dir"].items() if isinstance(v, bool))
    allp = [x["pass"] for x in res["reference_comparisons"] + res["changed_input_vs_direct_upstream"] + res["error_cases"]]
    res["all_pass"] = all(allp) and res["repeated_calls"]["pass"] and res["default_output_dir"]["pass"] and not res["error_output_dir_created"]
    print(json.dumps(res, indent=1))
asyncio.run(main())
