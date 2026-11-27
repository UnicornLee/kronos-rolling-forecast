# Kronos 滚动预测 · 三天视野叠加对比

**线上：<https://unicornlee.github.io/kronos-rolling-forecast/>**

把 **每天预测的未来 3 天** 画在同一张图上，连续 3 次预测各用一种颜色区分，**第 4 次预测自动回到第 1 次的颜色**。
每条折线的点、虚线端点、概率区间上下沿都直接标注价格，颜色与该次预测一致；X 轴刻度颜色也跟随覆盖该日期的那次预测。

数据来源：[Kronos](https://github.com/shiyu-coder/Kronos) 金融 K 线基础模型（`Kronos-base` 102M + 三个标的各自的微调权重），
在 Mac mini M4（MPS）上跑，lookback 500 根日 K，`pred_len=3`，每条路径 32 次采样取 P10/P50/P90。

---

## 页面结构

| 区块 | 内容 |
| --- | --- |
| 图表 | BTC / ETH / XAUT 切换；显示全部历史 / 价格标注 / 概率区间 / 校准目标 四个开关；下载 PNG |
| 结论 | 5 张 KPI 卡（最新收盘、预测终点、校准终点、已兑现平均误差、悲观·乐观档）+ 按数据现算的结论文案 |
| 逐日核对 | 只列**真实收盘已出**的预测日，逐条比模型 P50 / 校准 P50 / 真实值，标误差与方向命中 |
| 每次预测明细 | 批次、锚点、锚点收盘、预训练 P50、涨跌、校准 P50、悲观·中性·乐观三档、P10–P90、p_up |
| 怎么看这张图 | 5 条读图说明 |
| 不是投资建议 | 模型边界说明 |

---

## 目录

```
index.html              单页入口
assets/style.css        样式（含深色模式、移动端横向滑图）
assets/chart.js         纯 SVG 绘图，无第三方依赖（window.KChart）
assets/app.js           交互、KPI、表格、PNG 导出、深链
data/series.json        构建产物，页面唯一读取的数据文件
scripts/build_data.py   把 sources/ 下的原始数据编译成 series.json
sources/runs/runN/all.json      每次预测的原始输出（脚本直出）
sources/actual/{SYM}_1D.csv     日线收盘数据
```

---

## 时间口径（重要）

交易所日线的 `ts` 是 K 线**开盘时间**（UTC）。日线按北京时间 00:00 对齐时，**收盘价发生在 `ts + 8h + 1 天`**。

`scripts/build_data.py` 里的 `utc_open_to_bj_close()` 就干这件事：

```python
datetime.strptime(s, "%Y-%m-%d %H:%M:%S") + timedelta(hours=8, days=1)
```

漏掉这个 `+1 天`，图上所有日期都会早一天。

---

## 每日自动更新

已配置在 Mac 上用 **launchd** 每天 **北京时间 01:20** 跑（日线 00:00 收盘后留 80 分钟余量）：

```
~/Library/LaunchAgents/com.unicornlee.kronos-rolling-forecast.plist
  → /bin/bash /Volumes/ssd990pro1t/kronos/rolling-forecast-site/scripts/daily.sh
```

`daily.sh` 六步：

1. 用 `fetch_more.collect()` 刷新三标的已收盘日 K（`confirm == "1"`）；
2. **数据没推进就跳过重跑**（同一天手动触发多次不会白烧 2 分钟 GPU）；
3. 跑 `KRONOS_H=3 forecast_compare.py`，把 `out_compare/*.json` 归档到 `history/run_YYYYMMDD_HHMM/`；
4. 复制进站点的 `sources/runs/` 与 `sources/actual/`，重建 `series.json`；
5. `git pull --rebase` → `commit` → `push`，Pages 自动发布；
6. 只保留最近 40 次归档，更早的从本地和仓库一起清掉。

日志：`rolling-forecast-site/scripts/daily.log`。

### 手动触发

```bash
ssh mac 'bash /Volumes/ssd990pro1t/kronos/rolling-forecast-site/scripts/daily.sh'
```

### 卸载定时任务

```bash
launchctl unload ~/Library/LaunchAgents/com.unicornlee.kronos-rolling-forecast.plist
rm ~/Library/LaunchAgents/com.unicornlee.kronos-rolling-forecast.plist
```

### 为什么不用 GitHub Actions 定时（`.github/workflows/update.yml` 保留了但未启用）

GitHub 的 `cron` 跑在 GitHub 的机器上，那台机器连不到你家里 Mac 上的 `/Volumes/ssd990pro1t`。
要让它工作必须让 GitHub 反向 SSH 进你的 Mac，等于在公网开一个入口，还要把私钥放进仓库 Secrets。
launchd 在 Mac 本地跑，只往外推，简单且没有暴露面。workflow 文件留着当备用方案（需要 self-hosted runner 时可用）。


---

## 本地预览

```powershell
python -m http.server 5180
# 打开 http://127.0.0.1:5180/
```

`series.json` 是用 `fetch()` 读的，直接双击 `index.html` 会被浏览器的 `file://` 策略拦掉，必须起个静态服务。

---

## 设计要点

- **颜色 3 色循环**：`#00969E` 青绿 / `#E28010` 琥珀橙 / `#6C44C8` 紫罗兰，色相拉到最开，深浅模式下都区分得清。
  取色按 run 的**序号**取模（不是按"当前可见的第几个"），所以只显示最近 3 次时颜色不会跳，第 4 次自动复用第 1 次颜色。
- **校准值不扭曲原始路径**：模型给出的 P50 折线原样画，偏差校准后的终点单独画成一个**空心菱形 + 虚线**作为"目标标记"。
  按比例缩放或线性偏移都会把曲线形状拉歪（曾经踩过：按比例缩放会让首日从锚点掉下去出现断口）。
- **标签避让**：先按优先级排序（真实红点 > 最新批 P50 > 校准菱形 > 早批 P50 > 区间顶点），
  再对每个标签试 16 个候选位置，用 `canvas.measureText` 量宽、检查四边不出界且与已放标签留 2px 间隙；
  文字带白色描边（`paint-order: stroke`）保证压在线上也读得清。
- **走平段去重**：某次预测整段极差 < 1% 时，折线只标首末两点，避免同一水平线上堆满数字。
- 纯 SVG、纯静态、无框架无 CDN，单文件 16 KB 的 JS 就能画完。

---

## 边界

Kronos 只吃 OHLCV 历史，看不到宏观、消息面、资金费率、链上数据。
7 天视野下模型表现接近随机游走，3 天视野也常常被一次突发行情打穿。
这里的数字是**概率区间的可视化**，不是择时信号，不构成投资建议。
