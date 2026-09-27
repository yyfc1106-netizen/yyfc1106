"""Direct call of EXTRACTED repo/vicreg main_vicreg.VICReg.forward (binding: identity backbone/projector)."""
import argparse, importlib.util, json, os, sys, tempfile
import numpy as np, torch, torch.distributed as dist
from torch import nn
repo = sys.argv[1]; z_path, zp_path = sys.argv[2], sys.argv[3]; coeffs = tuple(map(float, sys.argv[4:7])); dt = sys.argv[7]
sys.path.insert(0, repo); sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("up_main_vicreg", os.path.join(repo, "main_vicreg.py"))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
fd, f = tempfile.mkstemp(); os.close(fd); os.remove(f)
dist.init_process_group("gloo", init_method=f"file://{f}", world_size=1, rank=0)
npdt = np.float32 if dt == "float32" else np.float64
def load(p):
    return np.load(p).astype(npdt) if p.endswith(".npy") else np.loadtxt(p, delimiter=",", dtype=np.float64, ndmin=2).astype(npdt)
z = torch.from_numpy(np.ascontiguousarray(load(z_path))); zp = torch.from_numpy(np.ascontiguousarray(load(zp_path)))
n, d = z.shape
def run(c):
    mod = m.VICReg.__new__(m.VICReg); nn.Module.__init__(mod)
    mod.args = argparse.Namespace(batch_size=n, sim_coeff=c[0], std_coeff=c[1], cov_coeff=c[2], mlp=str(d))
    mod.num_features = d; mod.backbone = nn.Identity(); mod.projector = nn.Identity()
    with torch.no_grad(): return float(mod.forward(z, zp).item())
out = {"upstream_file": m.__file__, "total_loss": run(coeffs), "invariance_loss": run((1., 0., 0.)),
       "variance_loss": run((0., 1., 0.)), "covariance_loss": run((0., 0., 1.))}
print(json.dumps(out))
