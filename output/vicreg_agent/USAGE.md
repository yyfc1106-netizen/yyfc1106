# VICReg MCP 服务器 — 使用说明

本服务器把论文 **VICReg: Variance-Invariance-Covariance Regularization for Self-Supervised Learning**（Bardes, Ponce & LeCun, ICLR 2022）官方代码中的损失函数封装成 MCP 工具，可在 Claude Code、Codex、Gemini CLI 等客户端的对话中直接调用。

- 官方代码：[facebookresearch/vicreg](https://github.com/facebookresearch/vicreg) @ `4e12602fd495af83efd1631fbe82523e6db092e0`（MIT 许可），**未经修改**地放在 `repo/vicreg/`（含其 `LICENSE`）。
- 由 [Paper2Agent](https://github.com/jmiao24/Paper2Agent) 的 Paper2MCP 流程生成并独立验证。

## 提供的工具

### `vicreg_compute_loss`

**用途**：给定同一批样本在两个视图/分支下的嵌入矩阵 Z 和 Z′（形状均为 `[n, d]`，行一一对应），计算 VICReg 总损失以及不变性、方差、协方差三项。可用于：
- 检查自己模型输出的嵌入是否塌缩（方差项接近 0.99、协方差项接近 0 说明各维退化为常数）；
- 比较不同系数 λ/μ/ν 下各项的贡献；
- 把 VICReg 作为评估指标，分析其它自监督方法得到的嵌入。

**计算方式**：直接调用官方 `main_vicreg.VICReg.forward`，将 backbone 和 projector 替换为恒等映射（即把你的嵌入当作 expander 的输出），`batch_size = n`、`num_features = d`，单进程（world_size = 1）。三个分项通过以单位系数 (1,0,0)/(0,1,0)/(0,0,1) 再次调用同一 `forward` 得到，没有重写任何损失公式。

| 参数 | 类型 / 默认值 | 说明 |
| --- | --- | --- |
| `embeddings_path` | 字符串，必填 | 第一个视图的嵌入 Z：`.npy`，或无表头纯数字 `.csv`（逗号）/ `.tsv`（制表符）/ `.txt`（空白分隔） |
| `embeddings_prime_path` | 字符串，必填 | 第二个视图的嵌入 Z′，形状与行顺序须与 Z 相同 |
| `sim_coeff` | 浮点，25.0 | 不变性项系数 λ（官方默认） |
| `std_coeff` | 浮点，25.0 | 方差项系数 μ（官方默认） |
| `cov_coeff` | 浮点，1.0 | 协方差项系数 ν（官方默认） |
| `dtype` | `"float32"`（默认）或 `"float64"` | 计算精度；官方训练使用 float32 |
| `output_dir` | 字符串，可选 | 输出根目录；每次调用新建子目录。默认 `<包目录>/tmp/outputs` |

**输入检查**：文件存在、为二维数值矩阵、两者形状一致、`n ≥ 2`、无 NaN/Inf；否则返回 MCP 工具错误。

**返回**：`total_loss`、`invariance_loss`、`variance_loss`、`covariance_loss`（均为未加权值）、`n_samples`、`n_features`、`coefficients`、`message`、`reference`，以及 `artifacts`：一个 `vicreg_loss.json`（含上述数值、各项加权贡献、精度、输入路径和方法说明）。

**与论文公式的差异（以官方代码为准）**：
- 方差项：代码返回两个分支的**平均** (v(Z)+v(Z′))/2；论文 Eq. 6 / Algorithm 1 写作两者之和。
- 不变性项：代码为逐元素均方误差（MSE，除以 n·d）；论文 Eq. 5 为 d × MSE。
- 协方差项与论文 Eq. 3–4 一致（除以 n−1 和 d）。方差项使用无偏方差 + ε=1e-4，hinge 目标 γ=1（代码固定，不作为参数暴露）。

## 安装

要求：Python 3.11（已测试 3.11.15），Linux x86_64，CPU 即可（无需 GPU）。以下命令在解压后的 `vicreg-mcp/` 目录中执行：

```bash
cd vicreg-mcp
uv venv .venv --python 3.11            # 或：python3.11 -m venv .venv
uv pip install --python .venv/bin/python -r src/requirements.txt
# 不用 uv 时：.venv/bin/pip install -r src/requirements.txt
```

`src/requirements.txt` 只固定直接依赖（fastmcp、torch、torchvision、numpy、pillow），其余依赖由安装器解析。PyPI 上的 Linux 版 torch 自带 CUDA 依赖，安装体积约 5 GB；如能访问 PyTorch 官方 CPU 源，可先装 CPU 版 `torch==2.14.0`、`torchvision==0.29.0` 以减小体积（该组合未在本包中测试）。

## 启动与连接客户端

直接启动（stdio 传输）：

```bash
.venv/bin/python src/vicreg_mcp.py
```

接入 Claude Code（在 `vicreg-mcp/` 目录下执行，使用绝对路径）：

```bash
claude mcp add vicreg -- "$(pwd)/.venv/bin/python" "$(pwd)/src/vicreg_mcp.py"
claude mcp list     # 或在 Claude Code 中输入 /mcp 查看连接状态
```

也可以用 FastMCP 自带的安装命令（语法取自 `fastmcp install claude-code --help`，FastMCP 4.0.3；该命令本身未在交付验证中实际执行）：

```bash
.venv/bin/fastmcp install claude-code src/vicreg_mcp.py --name vicreg --with-requirements src/requirements.txt
```

其它客户端可生成配置 JSON（必须带 `--with-requirements`，否则生成的 `uv run` 配置不会安装 numpy/torch 而启动失败；设置 `COLUMNS` 以免输出被折行）：

```bash
COLUMNS=1000 .venv/bin/fastmcp install mcp-json src/vicreg_mcp.py --name vicreg --with-requirements src/requirements.txt
```

环境变量 `VICREG_REPO_DIR` 可指定另一份官方代码目录（默认使用包内 `repo/vicreg/`）。

## 使用示例

在客户端对话中：

```text
用 vicreg 工具计算 /data/emb_view1.npy 和 /data/emb_view2.npy 的 VICReg 损失，
再把协方差系数改成 0.04 重算一次，比较三项的变化。
```

## 验证情况与限制

- 参考结果：在 64×32、128×256 等种子数据上直接运行官方 `VICReg.forward`，保存输入与输出并在新进程中重放，结果逐位一致。
- 独立验证：由未参与实现的代理编写 36 项测试（通过 MCP 客户端调用），全部通过。测试覆盖：参考值逐位一致；新形状与新系数下与重新直接调用官方代码的结果一致；各项性质（Z=Z′ 时不变性项为 0；常数嵌入时方差项为 0.99、协方差项为 0；总损失等于 Σ 系数×分项；交换 Z 与 Z′ 结果不变）；论文公式的 numpy 复算（确认 `batch_size = n` 的取法正确）；各类错误输入；重复调用输出目录互不覆盖。
- 运行时验收：项目环境与全新环境中均通过真实 stdio 的 9 个用例（含错误用例）；本 ZIP 解压到新目录（路径含空格）并按本文档安装后，15 个真实调用用例全部通过，结果与参考值逐位一致。
- 未覆盖：多进程/多 GPU 分布式聚合；梯度（仅测试前向计算）；非 Linux 平台。float32 结果在其它硬件上最后几位可能不同。
- 暂不提供（已记录原因）：预训练 ResNet 特征提取（`hubconf.py`，需要从 `dl.fbaipublicfiles.com` 下载权重，构建环境无法访问）；线性评估（`evaluate.py`，需要权重与 ImageNet）；完整预训练（需要 ImageNet 与多块 GPU）。
