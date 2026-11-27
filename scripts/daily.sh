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

OUTDIR = "/Volumes/ssd990pro1t/kronos/forecast/data"
os.makedirs(OUTDIR, exist_ok=True)

for sym, inst in fm.SYMS.items():
    try:
        rows = fm.collect(inst, "1D", 3000)          # 返回 dict{ts: row}
        closed = [rows[t] for t in sorted(rows) if len(rows[t]) > 8 and rows[t][8] == "1"]
        path = os.path.join(OUTDIR, f"{sym}_1D.csv")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("timestamps,open,high,low,close,volume,amount\n")
            for r in closed:
                fh.write(",".join([fm.fmt(int(r[0])), r[1], r[2], r[3], r[4], r[5], r[7]]) + "\n")
        print(f"  {sym}: {len(closed)} 行  {fm.fmt(int(closed[-1][0]))} close={closed[-1][4]}")
    except Exception as e:
        print(f"  {sym} 失败: {e}")
PYEOF

# 2) 跑预测
say "2) 跑 3 天预测"
cd "$FC/scripts" || exit 1

# 数据没往前推进就不用重跑（同一天手动触发多次时省 2 分钟 + 省 GPU）
LAST_CSV_TS=$(tail -1 "$FC/data/BTC_1D.csv" 2>/dev/null | cut -d, -f1)
LAST_RUN_TS=$(/Volumes/ssd990pro1t/kronos/native-venv/bin/python - <<'PYEOF' 2>/dev/null
import glob, json, os
runs = sorted(glob.glob("/Volumes/ssd990pro1t/kronos/forecast/history/run_*/all.json"))
if runs:
    d = json.load(open(runs[-1], encoding="utf-8"))
    print(next(iter(d.values())).get("history_to", ""))
PYEOF
)
if [ -n "$LAST_CSV_TS" ] && [ "$LAST_CSV_TS" = "$LAST_RUN_TS" ]; then
  say "  数据未推进（最后收盘 $LAST_CSV_TS 已预测过），跳过重跑，只重建"
  STAMP=""
else
  KRONOS_H=3 "$PY" forecast_compare.py >> "$LOG" 2>&1
  STAMP=$(date +%Y%m%d_%H%M)
fi

if [ ! -f "$FC/out_compare/all.json" ]; then
  say "✗ 预测没产出 all.json，中止"
  exit 1
fi

# 3) 归档
if [ -n "$STAMP" ]; then
  ARCH="$FC/history/run_$STAMP"
  mkdir -p "$ARCH"
  cp "$FC/out_compare/"*.json "$ARCH"/ 2>/dev/null
  say "3) 归档 $ARCH"
else
  say "3) 使用已有归档，不新建"
fi

# 4) 同步进站点仓库并重建
say "4) 重建 series.json"
mkdir -p "$SITE/sources/actual"
if [ -n "$STAMP" ]; then
  mkdir -p "$SITE/sources/runs/run_$STAMP"
  cp "$ARCH/all.json" "$SITE/sources/runs/run_$STAMP/all.json"
  say "  已复制新批次 run_$STAMP"
fi
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
  git pull --rebase --autostash -q >> "$LOG" 2>&1 || say "  ! rebase 有冲突，继续尝试推送"
  if git push >> "$LOG" 2>&1; then
    say "✓ 已推送 $(git log --oneline -1)"
  else
    say "✗ push 失败，详见 $LOG"
    exit 1
  fi
else
  say "无变化，跳过提交"
fi

# 6) 只保留最近 KEEP 次归档（本地与仓库都清）
KEEP=40
list_trim() {                       # $1=目录模式  → 输出需要删除的路径
  local all
  all=$(ls -1d "$1" 2>/dev/null | sort) || return 0
  local total
  total=$(printf '%s\n' "$all" | grep -c . || true)
  [ "$total" -le "$KEEP" ] && return 0
  printf '%s\n' "$all" | awk -v n="$((total - KEEP))" 'NR<=n'
}

for d in $(list_trim "$FC/history/run_*"); do
  rm -rf "$d"; say "清理旧归档 $(basename "$d")"
done
CHANGED=0
for d in $(list_trim "$SITE/sources/runs/run_*"); do
  git -C "$SITE" rm -rq --cached "sources/runs/$(basename "$d")" 2>/dev/null && CHANGED=1
  rm -rf "$d"; say "清理仓库旧归档 $(basename "$d")"
done
if [ "$CHANGED" = "1" ]; then
  git -C "$SITE" add -A
  git -C "$SITE" -c user.name="kronos-bot" -c user.email="kronos-bot@users.noreply.github.com" \
      commit -m "chore: 清理超过 $KEEP 次的旧归档" >> "$LOG" 2>&1
  git -C "$SITE" pull --rebase --autostash -q >> "$LOG" 2>&1 || true
  git -C "$SITE" push >> "$LOG" 2>&1 && say "✓ 清理已推送"
fi

say "=== 完成 ==="
