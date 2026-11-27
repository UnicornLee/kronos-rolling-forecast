#!/bin/bash
# 每天跑一次 Kronos 3 天预测 → 归档 → 重建 series.json → 推送 GitHub
# 由 launchd 每天北京时间 01:20 调用（日线 00:00 收盘后）
set -uo pipefail

BASE="/Volumes/ssd990pro1t/kronos"
FC="$BASE/forecast"
SITE="$BASE/rolling-forecast-site"
PY="$BASE/native-venv/bin/python"
SHIM_PY="$BASE/rolling-forecast-site/scripts/build_data.py"
LOG="$BASE/rolling-forecast-site/scripts/daily.log"

mkdir -p "$(dirname "$LOG")"
say() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }

say "=== 开始 ==="

# 0) 环境
[ -x "$PY" ] || { say "✗ 找不到 python: $PY"; exit 1; }
[ -d "$SITE/.git" ] || { say "✗ 站点仓库不存在: $SITE"; exit 1; }

# 1) 刷新日线数据（只取已收盘的）
say "1) 刷新 OHLCV"
cd "$BASE/Kronos/contrib/forecast" || { say "✗ 找不到 fetch_more"; exit 1; }
"$PY" - <<'PYEOF' 2>&1 | tee -a "$LOG"
import sys, os
sys.path.insert(0, os.getcwd())
import fetch_more as fm
for inst in ("BTC-USDT", "ETH-USDT", "XAUT-USDT"):
    try:
        rows = fm.collect(inst, "1D", 3000)
        closed = [r for r in rows if len(r) > 8 and r[8] == "1"]
        out = os.path.join("/Volumes/ssd990pro1t/kronos/forecast/data",
                           inst.split("-")[0] + "_1D.csv")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        import csv
        with open(out, "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["ts", "open", "high", "low", "close", "volume", "volCcy", "volCcyQuote", "confirm"])
            for r in closed:
                w.writerow(r)
        print(f"  {inst}: {len(closed)} 行 -> {out}")
    except Exception as e:
        print(f"  {inst} 失败: {e}")
PYEOF

# 2) 跑预测
say "2) 跑 3 天预测"
cd "$FC/scripts" || exit 1
KRONOS_H=3 "$PY" forecast_compare.py >> "$LOG" 2>&1
if [ ! -f "$FC/out_compare/all.json" ]; then
  say "✗ 预测没产出 all.json，中止"
  exit 1
fi

# 3) 归档
STAMP=$(date +%Y%m%d_%H%M)
ARCH="$FC/history/run_$STAMP"
mkdir -p "$ARCH"
cp "$FC/out_compare/"*.json "$ARCH"/ 2>/dev/null
say "3) 归档 $ARCH"

# 4) 同步进站点仓库并重建
say "4) 重建 series.json"
mkdir -p "$SITE/sources/runs/run_$STAMP" "$SITE/sources/actual"
cp "$ARCH/all.json" "$SITE/sources/runs/run_$STAMP/all.json"
for s in BTC ETH XAUT; do
  [ -f "$FC/data/${s}_1D.csv" ] && cp "$FC/data/${s}_1D.csv" "$SITE/sources/actual/${s}_1D.csv"
done
cd "$SITE" || exit 1
"$PY" "$SHIM_PY" >> "$LOG" 2>&1 || { say "✗ build_data.py 失败"; exit 1; }

# 5) 提交推送
say "5) 推送"
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git -c user.name="kronos-bot" -c user.email="kronos-bot@users.noreply.github.com" \
      commit -m "data: $(date '+%Y-%m-%d %H:%M') 预测更新" >> "$LOG" 2>&1
  if git push >> "$LOG" 2>&1; then
    say "✓ 已推送 $(git log --oneline -1)"
  else
    say "✗ push 失败"
    exit 1
  fi
else
  say "无变化，跳过提交"
fi

# 6) 只保留最近 40 次归档（本地与仓库都清）
KEEP=40
ls -1d "$FC"/history/run_* 2>/dev/null | sort | head -n -$KEEP | while read -r d; do
  rm -rf "$d"; say "清理旧归档 $(basename "$d")"
done
ls -1d "$SITE"/sources/runs/run_* 2>/dev/null | sort | head -n -$KEEP | while read -r d; do
  git -C "$SITE" rm -rq --cached "$(basename "$d")" 2>/dev/null
  rm -rf "$d"; say "清理仓库旧归档 $(basename "$d")"
done
if [ -n "$(git -C "$SITE" status --porcelain)" ]; then
  git -C "$SITE" add -A
  git -C "$SITE" -c user.name="kronos-bot" -c user.email="kronos-bot@users.noreply.github.com" \
      commit -m "chore: 清理超过 $KEEP 次的旧归档" >> "$LOG" 2>&1
  git -C "$SITE" push >> "$LOG" 2>&1 && say "✓ 清理已推送"
fi

say "=== 完成 ==="
