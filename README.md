# Paper2Agent 论文研究工作区

本仓库已集成 Nature 论文 **Reimagining research papers as interactive and reliable AI agents**（Miao et al., *Nature* 2026, [doi:10.1038/s41586-026-11044-y](https://www.nature.com/articles/s41586-026-11044-y)）的开源实现 [Paper2Agent](https://github.com/jmiao24/Paper2Agent)，用于把论文变成可对话、可执行的 AI Agent。

技能已作为 **Claude Code 项目技能** 放在 `.claude/skills/paper2agent/`（上游 MIT 许可，见该目录下 `LICENSE`）。在本仓库中打开 Claude Code（网页版 claude.ai/code 或本地 CLI）即可直接使用 `/paper2agent`，无需另外安装。

## Paper2Agent 能做什么

| 组件 | 输入 | 产出 | 适合场景 |
| --- | --- | --- | --- |
| **Paper2Skill** | 论文 PDF、补充材料 PDF、表格（xlsx/csv）、图片 | `<名称>-paper/` 技能包：`SKILL.md` + 按章节整理的正文/补充材料 Markdown + 图表资源 | 精读、问答、查图表、比较方法和结果 |
| **Paper2MCP** | 论文的代码仓库（Python / R / 命令行） | 经过测试的 MCP 服务器（ZIP，含 `USAGE.md`） | 在对话里直接调用论文的方法处理你自己的数据 |
| 两者组合 | 论文 + 代码 | `dist/<项目>-agent/{skill,mcp}` | 既要读懂论文又要复现/应用方法 |

## 目录约定

```text
papers/   放要研究的论文 PDF、补充材料、表格
output/   生成的论文技能包与 MCP 服务器
scripts/  update_paper2agent.sh（同步上游技能）、connect_remote_mcp.sh（连接远程 MCP）
```

## 用法（在 Claude Code 中直接输入）

### 1. 只有论文 → 生成可问答的论文技能

把 PDF 放进 `papers/`（或给出论文 URL），然后：

```text
/paper2agent 把 papers/xxx.pdf（以及补充材料 papers/xxx_supp.pdf）转换为论文技能，
输出到 output/，名称为 xxx-paper。按技能说明完成审阅与验证。
```

生成后可以把 `output/xxx-paper/` 复制到 `.claude/skills/` 下，之后直接提问，例如：
“根据 xxx-paper，Figure 3 的实验设置是什么？主要结论和局限性是什么？”

### 2. 有代码仓库 → 生成可调用的 MCP 工具

```text
/paper2agent Convert https://github.com/<作者>/<仓库> into tested MCP tools in output/<名称>_Agent.
Focus on "<某个教程标题或任务>".
```

需要 API Key 的仓库：先把密钥设为环境变量（网页版在环境设置的环境变量里配置），再补充一句
`Read the API key from the environment variable <变量名>.` 密钥不会写入生成的代码或 ZIP。

生成完成后：

```text
Connect the generated MCP server to my coding-agent client using its USAGE.md.
```

### 3. 论文 + 代码一起

```text
/paper2agent 请把这篇论文及其相关文件，连同代码仓库一起 agent 化。
论文及相关文件: papers/xxx.pdf
代码仓库: https://github.com/<作者>/<仓库>
输出目录: output/xxx
```

### 4. 研究 Paper2Agent 论文本身

技能内已附带 Paper2Agent 论文全文、补充材料和图表（`.claude/skills/paper2agent/paper2agent-paper/`），可以直接问：

```text
根据 Paper2Agent 论文，它是如何验证生成的 MCP 工具可靠性的？和 Figure 2 对应的结果是什么？
```

### 5. 直接使用官方托管的论文 Agent（无需自己转换）

| Agent | 地址 |
| --- | --- |
| AlphaGenome | https://Paper2Agent-alphagenome-mcp.hf.space |
| Scanpy | https://Paper2Agent-scanpy-mcp.hf.space |
| TISSUE | https://Paper2Agent-tissue-mcp.hf.space |

在本地 Claude Code 中（端点路径与认证方式以托管页面说明为准）：

```bash
claude mcp add --transport http alphagenome <MCP_ENDPOINT_URL>
# 或
bash scripts/connect_remote_mcp.sh --working_dir ./analysis --mcp_name alphagenome --mcp_url <MCP_ENDPOINT_URL>
```

用 `claude mcp list` 或 `/mcp` 检查连接状态。

## 运行要求

- Claude Code（需支持技能、Shell 与子 Agent 并行，Paper2MCP 依赖子 Agent）。
- Python ≥ 3.11 与 [uv](https://docs.astral.sh/uv/)：Paper2Skill 的 `paper_bundle.py` 通过 `uv run` 自动安装依赖（pymupdf、pypdf、pillow 等）。
- Git；以及目标代码仓库自身需要的 R / GPU / 数据 / API 等。
- 在 Claude Code 网页版中使用时，需确保环境网络策略允许访问 PyPI、GitHub 等。容器是临时的，生成的结果请提交推送到仓库保存。

## 同步上游更新

```bash
bash scripts/update_paper2agent.sh
```

## 引用

```bibtex
@article{miao2026paper2agent,
  title={Reimagining research papers as interactive and reliable {AI} agents},
  author={Miao, Jiacheng and Davis, Joe R. and Zhang, Yaohui and Pritchard, Jonathan K. and Zou, James},
  journal={Nature},
  year={2026},
  doi={10.1038/s41586-026-11044-y}
}
```
