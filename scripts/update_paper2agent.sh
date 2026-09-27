#!/usr/bin/env bash
# 从上游 jmiao24/Paper2Agent 同步最新的 paper2agent 技能到 .claude/skills/paper2agent
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

git clone --depth 1 https://github.com/jmiao24/Paper2Agent.git "$tmp/Paper2Agent"
rm -rf "$repo_root/.claude/skills/paper2agent"
mkdir -p "$repo_root/.claude/skills/paper2agent"
cp -R "$tmp/Paper2Agent/skills/paper2agent/." "$repo_root/.claude/skills/paper2agent/"
cp "$tmp/Paper2Agent/LICENSE" "$repo_root/.claude/skills/paper2agent/LICENSE"
cp "$tmp/Paper2Agent/scripts/connect_remote_mcp.sh" "$repo_root/scripts/connect_remote_mcp.sh"

echo "已同步到上游提交 $(git -C "$tmp/Paper2Agent" rev-parse --short HEAD)"
