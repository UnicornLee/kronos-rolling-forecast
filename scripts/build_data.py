#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 runs/*/all.json 与 actual/*.csv 汇总成前端用的 data/series.json。

目录约定（仓库根）：
  sources/runs/run<N>/all.json   每次预测的原始产物（Mac 上 forecast_compare.py 的 all.json）
  sources/actual/<SYM>_1D.csv    OKX 日K（列：ts,open,high,low,close,volume,...）
  data/series.json               生成物，前端直接 fetch

时间口径：CSV 的 ts 是 K 线【开盘】时间（UTC）；北京对齐的日线收盘发生在 ts+8h+1天。
"""
import json
import os
import re
from datetime import datetime, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_RUNS = os.path.join(ROOT, "sources", "runs")
SRC_ACT = os.path.join(ROOT, "sources", "actual")
OUT = os.path.join(ROOT, "data", "series.json")

SYMS = ["BTC", "ETH", "XAUT"]
LOOKBACK_DAYS = 45          # 图上保留的历史天数（用于画实际线）
FMT = "%Y-%m-%d %H:%M:%S"


def utc_open_to_bj_close(s):
    """K 线开盘 ts（UTC）→ 该 K 线收盘时刻（北京，UTC+8）。"""
    return datetime.strptime(s, FMT) + timedelta(hours=8, days=1)


def load_actual(sym):
    path = os.path.join(SRC_ACT, f"{sym}_1D.csv")
    rows = []
    with open(path, encoding="utf-8") as fh:
        next(fh)
        for line in fh:
            p = line.strip().split(",")
            if len(p) < 5:
                continue
            try:
                rows.append((utc_open_to_bj_close(p[0]), float(p[4])))
            except ValueError:
                continue
    rows.sort(key=lambda r: r[0])
    return rows


def pct(vals, q):
    """线性插值分位"""
    if not vals:
        return None
    v = sorted(vals)
    if len(v) == 1:
        return v[0]
    pos = q * (len(v) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(v) - 1)
    frac = pos - lo
    return v[lo] * (1 - frac) + v[hi] * frac


def band_from_paths(paths, n):
    p10, p50, p90 = [], [], []
    for k in range(n):
        col = [p[k] for p in paths if len(p) > k]
        p10.append(pct(col, 0.10))
        p50.append(pct(col, 0.50))
        p90.append(pct(col, 0.90))
    return p10, p50, p90


def pack_model(block, n):
    """把一个模型块（pretrained / finetuned）整理成前端要的形状"""
    paths = block.get("paths_close") or []
    if paths:
        p10, p50, p90 = band_from_paths(paths, n)
    else:
        p10 = block.get("p10_close") or []
        p50 = block.get("median_close") or []
        p90 = block.get("p90_close") or []

    tiers = {}
    for t in block.get("tiers") or []:
        tiers[t.get("tier")] = {
            "raw": t.get("raw"),
            "chg": t.get("raw_chg"),
            "cal": t.get("calibrated"),
            "cal_chg": t.get("cal_chg"),
        }
    return {
        "p10": p10,
        "p50": p50,
        "p90": p90,
        "end": block.get("end"),
        "chg": block.get("change_pct"),
        "band_pct": block.get("band_pct"),
        "prob_up": block.get("prob_up"),
        "cal": block.get("calibrated_end"),
        "cal_chg": block.get("calibrated_chg_pct"),
        "samples": block.get("samples"),
        "tiers": tiers,
        "bias_used": block.get("bias_used"),
    }


def run_sort_key(name):
    """目录名排序键：优先取 run_YYYYMMDD_HHMM 里的日期数字，回落到任意数字。"""
    m = re.search(r"(\d{8})", name)
    if m:
        return (0, m.group(1), name)
    m = re.search(r"(\d+)", name)
    return (1, "%08d" % int(m.group(1)) if m else "", name)


def main():
    run_dirs = []
    if os.path.isdir(SRC_RUNS):
        for d in sorted(os.listdir(SRC_RUNS), key=run_sort_key):
            p = os.path.join(SRC_RUNS, d)
            if os.path.isdir(p) and os.path.exists(os.path.join(p, "all.json")):
                run_dirs.append((d, p))

    # 同一个锚点（同一天数据）跑多次时只保留最新那份，避免图上出现两条重合的曲线
    by_anchor = {}
    for dname, dpath in run_dirs:
        try:
            head = json.load(open(os.path.join(dpath, "all.json"), encoding="utf-8"))
            key = next(iter(head.values())).get("history_to") or dname
        except Exception:
            key = dname
        by_anchor[key] = (dname, dpath)          # 后出现的（更新的目录名）覆盖前面的
    kept = [by_anchor[k] for k in sorted(by_anchor)]
    dropped = len(run_dirs) - len(kept)
    if dropped:
        print(f"  [dedupe] 跳过 {dropped} 个与已有批次同锚点的归档")
    run_dirs = [(i + 1, d, p) for i, (d, p) in enumerate(kept)]

    payload = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "timezone": "Asia/Shanghai (UTC+8)",
        "lookback_days": LOOKBACK_DAYS,
        "run_count": len(run_dirs),
        "symbols": {},
    }

    for sym in SYMS:
        actual = load_actual(sym)
        act_map = dict(actual)
        runs = []
        for idx, dname, dpath in run_dirs:
            alljson = json.load(open(os.path.join(dpath, "all.json"), encoding="utf-8"))
            if sym not in alljson:
                continue
            r = alljson[sym]
            n = int(r.get("pred_len") or 3)
            anchor = utc_open_to_bj_close(r["history_to"])
            dates = [anchor] + [anchor + timedelta(days=k + 1) for k in range(n)]
            last_close = r["last_close"]

            pre = pack_model(r["pretrained"], n)
            ft = pack_model(r["finetuned"], n) if r.get("finetuned") else None

            def with_anchor(m):
                return {
                    **m,
                    "p10": [last_close] + list(m["p10"]),
                    "p50": [last_close] + list(m["p50"]),
                    "p90": [last_close] + list(m["p90"]),
                }

            runs.append({
                "id": "run%d" % idx,
                "source": dname,
                "index": idx,
                "anchor": anchor.strftime(FMT),
                "anchor_date": anchor.strftime("%Y-%m-%d"),
                "last_close": last_close,
                "pred_len": n,
                "dates": [x.strftime(FMT) for x in dates],
                "history_to_utc": r.get("history_to"),
                "future_from_utc": r.get("future_from"),
                "future_to_utc": r.get("future_to"),
                "hist": r.get("hist"),
                "pretrained": with_anchor(pre),
                "finetuned": with_anchor(ft) if ft else None,
                # 已兑现的真实收盘（按日期对齐），前端画红点用
                "realized": [
                    {"date": x.strftime(FMT), "close": act_map[x]}
                    for x in dates[1:] if x in act_map
                ],
            })

        # 历史实际收盘：从最早锚点往前 LOOKBACK_DAYS 起，到最后一个已发生的收盘
        if runs:
            first_anchor = datetime.strptime(runs[0]["anchor"], FMT)
            start = first_anchor - timedelta(days=LOOKBACK_DAYS)
            end = max(datetime.strptime(x["dates"][-1], FMT) for x in runs)
            series = [[x.strftime(FMT), c] for x, c in actual if start <= x <= end]
        else:
            series = [[x.strftime(FMT), c] for x, c in actual[-LOOKBACK_DAYS:]]

        payload["symbols"][sym] = {
            "actual": series,
            "latest_close": series[-1][1] if series else None,
            "latest_date": series[-1][0] if series else None,
            "runs": runs,
        }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)

    size = os.path.getsize(OUT)
    print(f"wrote {OUT}  ({size/1024:.1f} KB)  runs={len(run_dirs)}")
    for sym in SYMS:
        d = payload["symbols"][sym]
        print(f"  {sym}: actual={len(d['actual'])} pts, runs={len(d['runs'])}, "
              f"latest={d['latest_close']} @ {d['latest_date']}")


if __name__ == "__main__":
    main()
