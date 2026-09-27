# Paper2MCP run context (VICReg)

- PROJECT_ROOT = /home/user/yyfc1106/output/vicreg_agent
- REPO_NAME = vicreg ; pinned source: repo/vicreg @ 4e12602fd495af83efd1631fbe82523e6db092e0 (https://github.com/facebookresearch/vicreg, MIT)
- SKILL_ROOT = /home/user/yyfc1106/.claude/skills/paper2agent/paper2mcp
- PROJECT_ENV = /home/user/yyfc1106/output/vicreg_agent/vicreg-env ; PROJECT_PYTHON = $PROJECT_ENV/bin/python
- Route: python ; GPU: none (see .pipeline/language.json). Machine: 4 CPU, 15 GB RAM, no GPU.
- Network: PyPI reachable (use default PyPI torch; download.pytorch.org and dl.fbaipublicfiles.com are BLOCKED by network policy).
- User scope (filter): "VICReg loss computation on user-supplied embeddings" from repo/vicreg/main_vicreg.py
  (VICReg.forward, off_diagonal, FullGatherLayer). Deferred: pretrained ResNet feature extraction (hubconf.py, weights host blocked),
  linear evaluation (evaluate.py, needs weights + ImageNet). Out of scope: full pretraining.
- The paper itself is available as a skill at /home/user/yyfc1106/.claude/skills/vicreg-paper (paper.md) for context on the loss (Sec. 4.1, Eq. 1-6, Algorithm 1).
- Scratch: /tmp/claude-0/-home-user-yyfc1106/5963f845-5f93-5583-a082-e8ff3276f540/scratchpad
- Never modify files under repo/vicreg. Write only the paths you are assigned.
