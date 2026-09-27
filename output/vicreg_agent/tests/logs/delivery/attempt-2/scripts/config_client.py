import asyncio, json, os, sys
from fastmcp import Client
from fastmcp.client.transports import StdioTransport
cfg = json.load(open(sys.argv[1]))["vicreg"]; ti = sys.argv[2]; out = sys.argv[3]
env = {k: v for k, v in os.environ.items() if k not in ("VICREG_REPO_DIR", "PYTHONPATH", "VIRTUAL_ENV")}
async def main():
    async with Client(StdioTransport(command=cfg["command"], args=cfg["args"], env=env, cwd=out), timeout=600) as c:
        tools = [t.name for t in await c.list_tools()]
        r = await c.call_tool("vicreg_compute_loss", {"embeddings_path": ti + "/a_default_z.npy", "embeddings_prime_path": ti + "/a_default_zp.npy", "output_dir": out})
        d = r.structured_content
        print(json.dumps({"tools": tools, "total_loss": d["total_loss"], "equals_reference": d["total_loss"] == 2.1248912811279297, "artifact": d["artifacts"][0]["path"]}))
asyncio.run(main())
