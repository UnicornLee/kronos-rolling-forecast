#!/usr/bin/env bash
# 在 Mac 上把新脚本同步进站点仓库并跑一次代理变量构建，验证是否可用。
# 仅用于首次接线，之后由 daily.sh 每天调用。
set -uo pipefail
SITE="/Volumes/ssd990pro1t/kronos/rolling-forecast-site"
PY="/Volumes/ssd990pro1t/kronos/native-venv/bin/python"
cd "$SITE" || exit 1
echo "=== fetch_proxy.py ==="
"$PY" scripts/fetch_proxy.py
echo "=== build_proxy_data.py ==="
"$PY" scripts/build_proxy_data.py
echo "=== git status ==="
git status --porcelain | head -20
