# 从 Mac 拉取最新预测归档与日线数据，重建 series.json
#
# 用法（在仓库根目录）：
#   powershell -ExecutionPolicy Bypass -File .\scripts\sync.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\sync.ps1 -NoPull
#
# 前置：SSH 已配好免密登录 Mac（ssh mac 可直接进），Mac 上有：
#   /Volumes/ssd990pro1t/kronos/forecast/history/run_*/all.json
#   /Volumes/ssd990pro1t/kronos/forecast/data/<SYM>_1D.csv
param(
    [string]$MacHost = "mac",
    [string]$RemoteBase = "/Volumes/ssd990pro1t/kronos/forecast",
    [switch]$NoPull,
    [switch]$NoBuild
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$SrcRuns = Join-Path $Root "sources\runs"
$SrcAct = Join-Path $Root "sources\actual"
$Py = "C:\Users\unico\.venv\Scripts\python.exe"

function Say($msg) { Write-Host "  $msg" -ForegroundColor DarkGray }
function Ok($msg) { Write-Host "  $msg" -ForegroundColor Green }
function Bad($msg) { Write-Host "  $msg" -ForegroundColor Red }

# ---------- 0. 连通性 ----------
if (-not $NoPull) {
    Write-Host "`n[0/4] 检查 SSH 连通 ($MacHost)" -ForegroundColor Cyan
    $probe = ssh -o ConnectTimeout=12 -o BatchMode=yes $MacHost "echo ok" 2>&1
    if ($probe -notmatch "ok") {
        Bad "连不上 $MacHost，跳过拉取（如需只重建本地数据可加 -NoPull）"
        Write-Host "    $probe"
        exit 1
    }
    Ok "SSH 正常"
}

# ---------- 1. 拉归档目录 ----------
if (-not $NoPull) {
    Write-Host "`n[1/4] 拉取 history/ 归档" -ForegroundColor Cyan
    $list = ssh $MacHost "ls -1 $RemoteBase/history 2>/dev/null"
    if (-not $list) {
        Bad "Mac 上没有 $RemoteBase/history，先跑一次预测归档"
        exit 1
    }
    New-Item -ItemType Directory -Force -Path $SrcRuns | Out-Null
    foreach ($d in ($list -split "`n" | Where-Object { $_ -match '^run_' })) {
        $d = $d.Trim()
        $local = Join-Path $SrcRuns $d
        if (Test-Path (Join-Path $local "all.json")) { Say "$d 已存在，跳过"; continue }
        New-Item -ItemType Directory -Force -Path $local | Out-Null
        scp -q "${MacHost}:${RemoteBase}/history/${d}/all.json" (Join-Path $local "all.json")
        if (Test-Path (Join-Path $local "all.json")) { Ok "$d" } else { Bad "$d 拉取失败" }
    }
}

# ---------- 2. 拉日线 CSV ----------
if (-not $NoPull) {
    Write-Host "`n[2/4] 拉取日线 CSV" -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $SrcAct | Out-Null
    foreach ($sym in @("BTC", "ETH", "XAUT")) {
        $f = "${sym}_1D.csv"
        scp -q "${MacHost}:${RemoteBase}/data/${f}" (Join-Path $SrcAct $f)
        if (Test-Path (Join-Path $SrcAct $f)) {
            $n = (Get-Content (Join-Path $SrcAct $f) | Measure-Object -Line).Lines
            Ok "$f  ($n 行)"
        } else {
            Bad "$f 拉取失败"
        }
    }
}

# ---------- 3. 重建 ----------
if (-not $NoBuild) {
    Write-Host "`n[3/4] 重建 data/series.json" -ForegroundColor Cyan
    if (-not (Test-Path $Py)) { $Py = "python" }
    & $Py (Join-Path $Root "scripts\build_data.py")
    if ($LASTEXITCODE -ne 0) { Bad "build_data.py 失败"; exit 1 }
}

# ---------- 4. 提交提示 ----------
Write-Host "`n[4/4] 收尾" -ForegroundColor Cyan
Push-Location $Root
$dirty = git status --porcelain
Pop-Location
if ($dirty) {
    Ok "有改动，提交并推送："
    Write-Host "    cd `"$Root`""
    Write-Host "    git add -A; git commit -m `"data: $(Get-Date -Format 'yyyy-MM-dd HH:mm') 预测更新`"; git push"
} else {
    Ok "工作区干净，无需提交"
}
