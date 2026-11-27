#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把市场代理变量 + 回测结果整理成 data/proxy.json，供 research.html 使用。

数据来源（全部免费、日频）：
  sources/proxy/DGS2.csv       2 年期美债收益率（FRED）
  sources/proxy/DGS10.csv      10 年期美债收益率（FRED）
  sources/proxy/DFII10.csv     10 年期 TIPS 实际利率（FRED）
  sources/proxy/T10Y2Y.csv     10Y-2Y 期限利差（FRED）
  sources/proxy/DTWEXBGS.csv   美元指数（FRED，广义）
  sources/proxy/VIXCLS.csv     VIX 恐慌指数（FRED）
  sources/proxy/FNG_full.json  Crypto Fear & Greed Index（alternative.me，2018-02 起）
  sources/proxy/NDX.json       纳斯达克 100（Yahoo Finance，10 年）
  sources/actual/*.csv         三标的日收盘（与图上同一份）
  sources/bt/backtest2_all.json  12 窗口走查明细

时间对齐规则（关键，防前视偏差）：
  K 线 ts 是「开盘时间」，北京对齐的收盘时刻 = ts + 8h + 1 天。
  FRED 的日期 D 表示美东 D 日收盘值，美东收盘 16:00 = 北京次日 04:00/05:00。
  所以北京 D+1 日 00:00 的收盘 K 线，只能用 FRED 日期 <= D 的值 —— 即
  代理变量日期 <= 锚点日期 - 1 天。为稳妥统一取 **锚点日期 - 2 天**。
"""
import json
import os
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_PROXY = os.path.join(ROOT, "sources", "proxy")
SRC_ACT = os.path.join(ROOT, "sources", "actual")
SRC_BT = os.path.join(ROOT, "sources", "bt")
OUT = os.path.join(ROOT, "data", "proxy.json")

SYMS = ["BTC", "ETH", "XAUT"]
LAG_DAYS = 2  # 代理变量相对锚点的最小提前量

# 每个代理变量的中文说明，写进页面
META = {
    "DGS2": {"name": "2 年期美债收益率", "unit": "%", "why": "对联储政策最敏感，加息/降息预期的直接定价"},
    "DGS10": {"name": "10 年期美债收益率", "unit": "%", "why": "长端利率，风险资产估值的贴现率"},
    "DFII10": {"name": "10 年期 TIPS 实际利率", "unit": "%", "why": "黄金的真正驱动：实际利率↑ → 金价↓"},
    "T10Y2Y": {"name": "10Y–2Y 期限利差", "unit": "%", "why": "倒挂/陡峭化 = 经济周期 regime 信号"},
    "DTWEXBGS": {"name": "美元指数（广义）", "unit": "", "why": "美元走强通常压制以美元计价的资产"},
    "VIXCLS": {"name": "VIX 恐慌指数", "unit": "", "why": "风险偏好与避险情绪的即时读数"},
    "FNG": {"name": "Crypto Fear & Greed", "unit": "", "why": "加密市场复合情绪，极端值有反向含义"},
    "NDX": {"name": "纳斯达克 100", "unit": "", "why": "风险资产代表，与加密的相关性时变"},
}


def load_fred(fid):
    p = os.path.join(SRC_PROXY, fid + ".csv")
    if not os.path.exists(p):
        return None
    df = pd.read_csv(p)
    df.columns = ["date", "v"]
    df["v"] = pd.to_numeric(df["v"], errors="coerce")
    df["date"] = pd.to_datetime(df["date"])
    return df.dropna().set_index("date")["v"].sort_index()


def load_fng():
    p = os.path.join(SRC_PROXY, "FNG_full.json")
    if not os.path.exists(p):
        return None
    j = json.load(open(p, encoding="utf-8"))
    rows = []
    for it in j["data"]:
        rows.append((pd.Timestamp(int(it["timestamp"]), unit="s").normalize(),
                     float(it["value"])))
    s = pd.Series(dict(rows)).sort_index()
    return s[~s.index.duplicated(keep="last")]


def load_ndx():
    p = os.path.join(SRC_PROXY, "NDX.json")
    if not os.path.exists(p):
        return None
    j = json.load(open(p, encoding="utf-8"))
    r = j["chart"]["result"][0]
    ts = r["timestamp"]
    close = r["indicators"]["quote"][0]["close"]
    rows = []
    for t, c in zip(ts, close):
        if c is None:
            continue
        rows.append((pd.Timestamp(t, unit="s").normalize(), float(c)))
    s = pd.Series(dict(rows))
    return s[~s.index.duplicated(keep="last")].sort_index()


def load_actual(sym):
    p = os.path.join(SRC_ACT, sym + "_1D.csv")
    d = pd.read_csv(p)
    d["ts"] = pd.to_datetime(d["timestamps"]) + timedelta(hours=8, days=1)
    return d.set_index("ts")["close"].sort_index()


def series_to_points(s, start, end, step=1, nd=3):
    """把 Series 裁到 [start, end] 并降采样成 [[YYYY-MM-DD, value], ...]"""
    if s is None:
        return []
    s = s[(s.index >= start) & (s.index <= end)]
    if s.empty:
        return []
    out = []
    for i, (k, v) in enumerate(s.items()):
        if i % step:
            continue
        v = float(v)
        if nd == 0:
            out.append([k.strftime("%Y-%m-%d"), round(v)])
        else:
            out.append([k.strftime("%Y-%m-%d"), round(v, nd)])
    return out


def pctile_rank(hist, v):
    if hist is None or len(hist) < 20:
        return None
    return float((hist <= v).mean() * 100)


def main():
    proxies = {k: load_fred(k) for k in
               ["DGS2", "DGS10", "DFII10", "T10Y2Y", "DTWEXBGS", "VIXCLS"]}
    proxies["FNG"] = load_fng()
    proxies["NDX"] = load_ndx()

    proxies = {k: v for k, v in proxies.items() if v is not None and len(v) > 100}
    print("[load] 代理变量: " + ", ".join(f"{k}({len(v)}行)" for k, v in proxies.items()))

    bt = json.load(open(os.path.join(SRC_BT, "backtest2_all.json"), encoding="utf-8"))

    actual = {s: load_actual(s) for s in SYMS}
    for s, v in actual.items():
        print(f"[load] {s} 收盘 {len(v)} 行，末行 {v.index[-1]:%Y-%m-%d %H:%M} = {v.iloc[-1]}")

    # 图表时间范围：从最早锚点前一年到最新锚点后 5 天
    anchors = []
    for sym in SYMS:
        for w in bt[sym + "_1D"]["detail"]:
            anchors.append(pd.Timestamp(w["window_end"]))
    amin, amax = min(anchors), max(anchors)
    start = amin - timedelta(days=365 * 3)
    end = amax + timedelta(days=5)
    print(f"[range] {start:%Y-%m-%d} → {end:%Y-%m-%d}")

    # ---- 每个标的：算代理变量 vs 未来3日收益、vs 模型误差 ----
    per_sym = {}
    for sym in SYMS:
        c = actual[sym]
        fwd = (c.shift(-3) / c - 1) * 100
        corr_level, corr_diff = {}, {}
        for k, v in proxies.items():
            j = pd.concat([v, fwd], axis=1, keys=["x", "y"], sort=True).dropna()
            corr_level[k] = round(float(j["x"].corr(j["y"])), 3) if len(j) > 200 else None
            if k == "FNG":
                j2 = pd.concat([v, fwd], axis=1, keys=["x", "y"], sort=True).dropna()
                corr_diff[k] = round(float(j2["x"].corr(j2["y"])), 3) if len(j2) > 200 else None
                continue
            vd = v.diff()
            j2 = pd.concat([vd, fwd], axis=1, keys=["x", "y"], sort=True).dropna()
            corr_diff[k] = round(float(j2["x"].corr(j2["y"])), 3) if len(j2) > 200 else None
        per_sym[sym] = {"corr_level": corr_level, "corr_diff": corr_diff}

    # ---- 12 窗口：代理变量状态 vs 模型误差（严格 LAG_DAYS 提前）----
    win_corr = {}
    for sym in SYMS:
        det = bt[sym + "_1D"]["detail"]
        recs = []
        for w in det:
            anchor = pd.Timestamp(w["window_end"])
            cutoff = anchor - timedelta(days=LAG_DAYS)
            r = {"err": w["model_T1_mape_pct"], "flat": w["flat_mape_pct"]}
            for k, v in proxies.items():
                s = v[v.index <= cutoff]
                if len(s) == 0:
                    continue
                r[k] = float(s.iloc[-1])
            recs.append(r)
        cols = list(proxies.keys())
        out = {}
        for k in cols:
            vals = [(r.get(k), r["err"]) for r in recs]
            vals = [(a, b) for a, b in vals if a is not None]
            if len(vals) >= 8:
                a = np.array([x[0] for x in vals])
                b = np.array([x[1] for x in vals])
                if a.std() > 0:
                    out[k] = round(float(np.corrcoef(a, b)[0, 1]), 3)
        win_corr[sym] = out

    # ---- LOO gate：用代理变量的历史分位决定「信模型 or flat」----
    gate = {}
    for sym in SYMS:
        det = bt[sym + "_1D"]["detail"]
        recs = []
        for w in det:
            anchor = pd.Timestamp(w["window_end"])
            cutoff = anchor - timedelta(days=LAG_DAYS)
            r = {"err": w["model_T1_mape_pct"], "flat": w["flat_mape_pct"]}
            for k, v in proxies.items():
                s = v[v.index <= cutoff]
                if len(s) == 0:
                    continue
                hist = s.iloc[-250:] if len(s) > 250 else s
                r[k + "_p"] = float((hist <= s.iloc[-1]).mean() * 100)
            recs.append(r)
        df = pd.DataFrame(recs)
        raw = float(df["err"].mean())
        fl = float(df["flat"].mean())
        best = None
        for k in proxies.keys():
            col = k + "_p"
            if col not in df or df[col].nunique() < 6:
                continue
            for q in [20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80]:
                for sgn in [1, -1]:
                    use = ((df[col] - q) * sgn > 0)
                    m = float(np.mean(np.where(use, df["err"], df["flat"])))
                    if best is None or m < best["mape"]:
                        best = {"feature": k, "q": q, "dir": sgn,
                                "mape": round(m, 3),
                                "model_share": round(float(use.mean()), 2)}
        gate[sym] = {
            "raw": round(raw, 3), "flat": round(fl, 3),
            "best": best,
            "impr_vs_raw": round(raw - best["mape"], 3) if best else None,
            "impr_vs_flat": round(fl - best["mape"], 3) if best else None,
        }

    # ---- 每次预测的锚点值（给图上的竖线标注）----
    marks = []
    for sym in SYMS:
        for w in bt[sym + "_1D"]["detail"]:
            marks.append({"sym": sym, "date": w["window_end"][:10],
                          "err": w["model_T1_mape_pct"]})

    payload = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "timezone": "Asia/Shanghai (UTC+8)",
        "lag_days": LAG_DAYS,
        "start": start.strftime("%Y-%m-%d"),
        "end": end.strftime("%Y-%m-%d"),
        "anchor_min": amin.strftime("%Y-%m-%d"),
        "anchor_max": amax.strftime("%Y-%m-%d"),
        "meta": META,
        "series": {k: series_to_points(v, start, end, step=1,
                                       nd=0 if k in ("FNG", "NDX", "VIXCLS", "DTWEXBGS") else 3)
                   for k, v in proxies.items()},
        "latest": {k: {"date": v.index[-1].strftime("%Y-%m-%d"), "value": round(float(v.iloc[-1]), 3)}
                   for k, v in proxies.items()},
        "actual": {s: series_to_points(actual[s], start, end, step=1, nd=2) for s in SYMS},
        "corr_level": {s: per_sym[s]["corr_level"] for s in SYMS},
        "corr_diff": {s: per_sym[s]["corr_diff"] for s in SYMS},
        "win_corr": win_corr,
        "gate": gate,
        "backtest": {s: {
            "mean_mape_pct": bt[s + "_1D"]["T1.0"]["mean_mape_pct"],
            "flat_mape_pct": bt[s + "_1D"].get("flat_baseline_mean_mape_pct"),
            "direction_hit_rate": bt[s + "_1D"]["T1.0"]["direction_hit_rate"],
            "windows": bt[s + "_1D"]["windows"],
        } for s in SYMS},
        "anchors": marks[-12:] if len(marks) > 12 else marks,
    }

    # 幂等：内容没变就保留原 generated_at
    old = None
    if os.path.exists(OUT):
        try:
            old = json.load(open(OUT, encoding="utf-8"))
        except Exception:
            old = None
    if old:
        a = dict(payload); b = dict(old)
        a.pop("generated_at", None); b.pop("generated_at", None)
        if a == b:
            payload["generated_at"] = old.get("generated_at", payload["generated_at"])
            print("[nochange] 数据没有变化，保留原 generated_at")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"[write] {OUT} ({os.path.getsize(OUT)} bytes)")

    print("\n=== 与模型误差的相关性（12 窗口，代理变量已提前 %d 天）===" % LAG_DAYS)
    for s in SYMS:
        items = sorted(win_corr[s].items(), key=lambda kv: -abs(kv[1]))
        print(f"{s:5s} " + "  ".join(f"{k} {v:+.2f}" for k, v in items[:5]))

    print("\n=== LOO gate（信模型 vs flat，末值 MAPE）===")
    for s in SYMS:
        g = gate[s]
        b = g["best"]
        print(f"{s:5s} raw {g['raw']:.2f}%  flat {g['flat']:.2f}%  →  "
              f"{b['feature']} 分位{b['q']}{'高' if b['dir'] > 0 else '低'}→信模型 "
              f"{b['mape']:.2f}%  (模型占比 {b['model_share']:.0%})")


if __name__ == "__main__":
    main()
