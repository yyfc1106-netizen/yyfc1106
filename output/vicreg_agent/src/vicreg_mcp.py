"""VICReg MCP server: tools wrapping facebookresearch/vicreg (Bardes, Ponce & LeCun, ICLR 2022).

Run over stdio:  python src/vicreg_mcp.py
"""
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastmcp import FastMCP  # noqa: E402

from tools.main_vicreg import main_vicreg_mcp  # noqa: E402

mcp = FastMCP(name="vicreg")
mcp.mount(main_vicreg_mcp)

if __name__ == "__main__":
    mcp.run()
