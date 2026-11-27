#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""刷新 8 个代理变量的原始数据到 sources/proxy/。

全部免费、日频、无需 API key：
  FRED     https://fred.stlouisfed.org/graph/fredgraph.csv?id=<ID>
  FGI      https://api.alternative.me/fng/?limit=0
  NDX      https://query1.finance.yahoo.com/v8/finance/chart/%5ENDX?range=10y&interval=1d

为什么用 curl 而不是 urllib（踩过的坑）：
  urllib 走 127.0.0.1:7897 时 FRED 全部 read timeout，Yahoo 返回 403；
  同一个 URL 用 curl -x 代理却都正常。所以直接 shell 出去调 curl，不加自己的 HTTP 栈。

任一源失败不中断其它源，最后打印汇总。超过半数失败返回 1（说明代理没开）。
"""
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "sources", "proxy")

PROXY = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or "http://127.0.0.1:7897"
CAFILE = "/etc/ssl/cert.pem"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")

FRED_IDS = ["DGS2", "DGS10", "DFII10", "T10Y2Y", "DTWEXBGS", "VIXCLS"]

CURL = shutil.which("curl") or shutil.which("curl.exe") or "curl"


def curl_get(url, path, min_bytes=500, ua=None):
    tmp = path + ".part"
    cmd = [CURL, "-sS", "--compressed", "--max-time", "90", "--retry", "2",
           "--retry-delay", "2", "-o", tmp, "-w", "%{http_code}"]
    if PROXY:
        cmd += ["-x", PROXY]
    if os.path.exists(CAFILE):
        cmd += ["--cacert", CAFILE]
    if ua:
        cmd += ["-H", "User-Agent: " + ua]
    cmd.append(url)
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        code = (r.stdout or "").strip()[-3:]
    except Exception as e:
        print(f"  ✗ {os.path.basename(path)}: {type(e).__name__}: {e}")
        _cleanup(tmp)
        return False
    if code != "200" or not os.path.exists(tmp) or os.path.getsize(tmp) < min_bytes:
        size = os.path.getsize(tmp) if os.path.exists(tmp) else 0
        print(f"  ✗ {os.path.basename(path)}: HTTP {code}，{size} 字节")
        _cleanup(tmp)
        return False
    os.replace(tmp, path)
    print(f"  ✓ {os.path.basename(path)} {os.path.getsize(path)} 字节")
    return True


def _cleanup(p):
    try:
        os.remove(p)
    except OSError:
        pass


def main():
    os.makedirs(OUT, exist_ok=True)
    ok, fail = 0, 0

    print("[FRED] 六个利率/汇率序列")
    for fid in FRED_IDS:
        if curl_get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={fid}",
                    os.path.join(OUT, fid + ".csv"), min_bytes=500):
            ok += 1
        else:
            fail += 1

    print("[FGI] Crypto Fear & Greed 全历史")
    if curl_get("https://api.alternative.me/fng/?limit=0&format=json",
                os.path.join(OUT, "FNG_full.json"), min_bytes=10000):
        ok += 1
    else:
        fail += 1

    print("[NDX] 纳斯达克 100 十年日线（Yahoo 必须带 UA，否则 403）")
    if curl_get("https://query1.finance.yahoo.com/v8/finance/chart/%5ENDX?range=10y&interval=1d",
                os.path.join(OUT, "NDX.json"), min_bytes=10000, ua=UA):
        ok += 1
    else:
        fail += 1

    print(f"[done] 成功 {ok} 个，失败 {fail} 个 → {OUT}")
    if fail >= 4:
        print("[warn] 超过半数源失败，可能是代理未开或网络不通")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
