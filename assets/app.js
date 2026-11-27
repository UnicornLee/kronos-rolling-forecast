/* 页面逻辑：切换标的、控件、KPI、表格、PNG 导出 */
(function () {
  'use strict';

  var K = window.KChart;
  var state = {
    data: null,
    sym: 'BTC',
    showAll: false,
    showLabels: true,
    showBand: true,
    showCal: true
  };

  var el = {
    meta: document.getElementById('meta'),
    tabs: document.getElementById('symTabs'),
    legend: document.getElementById('legend'),
    svg: document.getElementById('chart'),
    tip: document.getElementById('tip'),
    chartHint: document.getElementById('chartHint'),
    kpis: document.getElementById('kpis'),
    latestNote: document.getElementById('latestNote'),
    score: document.getElementById('scoreTable'),
    runTable: document.getElementById('runTable'),
    footer: document.getElementById('footerMeta')
  };

  function fmtPct(v) {
    if (v == null || isNaN(v)) return '—';
    return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  }

  function cls(v) {
    if (v == null || isNaN(v) || Math.abs(v) < 0.005) return 'flat';
    return v > 0 ? 'up' : 'down';
  }

  function pctChange(from, to) {
    if (!from) return null;
    return (to / from - 1) * 100;
  }

  /* ---------- 逐日核对：把每次预测的每一天与真实收盘比对 ---------- */
  function buildScore(symData) {
    var actMap = {};
    symData.actual.forEach(function (p) { actMap[p[0]] = p[1]; });

    var rows = [];
    symData.runs.forEach(function (r) {
      var n = r.pred_len;
      var raw = r.pretrained.p50.slice(1);
      var calEnd = r.pretrained.cal;
      var rawEnd = raw[raw.length - 1];
      for (var k = 0; k < n; k++) {
        var date = r.dates[k + 1];
        if (!(date in actMap)) continue;
        var real = actMap[date];
        var rawV = raw[k];
        var calV = rawV + (calEnd - rawEnd) * (k + 1) / n;

        var rawErr = (rawV / real - 1) * 100;
        var calErr = (calV / real - 1) * 100;
        var rawDir = (rawV - r.last_close) === 0 ? 0 : (rawV > r.last_close ? 1 : -1);
        var realDir = (real - r.last_close) === 0 ? 0 : (real > r.last_close ? 1 : -1);

        rows.push({
          sym: symData === null ? '' : '',
          run: r.id,
          anchor: r.anchor_date,
          date: date,
          lastClose: r.last_close,
          raw: rawV,
          cal: calV,
          real: real,
          rawErr: rawErr,
          calErr: calErr,
          dirHit: rawDir === realDir
        });
      }
    });
    rows.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    return rows;
  }

  function renderScore(symData) {
    var rows = buildScore(symData);
    var h = '<thead><tr>' +
      '<th>标的</th><th>批次</th><th>锚点</th><th>预测日</th>' +
      '<th>模型 P50</th><th>校准 P50</th><th>真实收盘</th>' +
      '<th>模型误差</th><th>校准误差</th><th>方向</th></tr></thead><tbody>';

    if (!rows.length) {
      h += '<tr><td colspan="10" style="text-align:center;color:var(--text-3)">' +
        '还没有已兑现的预测日（预测区间都还在未来）</td></tr>';
    } else {
      rows.forEach(function (x) {
        h += '<tr>' +
          '<td class="sym">' + state.sym + '</td>' +
          '<td>' + x.run.replace('run', 'run') + '</td>' +
          '<td>' + x.anchor + '</td>' +
          '<td>' + x.date.slice(0, 16) + '</td>' +
          '<td>' + K.fmtPrice(x.raw) + '</td>' +
          '<td>' + K.fmtPrice(x.cal) + '</td>' +
          '<td>' + K.fmtPrice(x.real) + '</td>' +
          '<td class="' + cls(x.rawErr) + '">' + fmtPct(x.rawErr) + '</td>' +
          '<td class="' + cls(x.calErr) + '">' + fmtPct(x.calErr) + '</td>' +
          '<td class="' + (x.dirHit ? 'hit' : 'miss') + '">' + (x.dirHit ? '✓' : '✗') + '</td>' +
          '</tr>';
      });
    }
    h += '</tbody>';
    el.score.innerHTML = h;

    // 汇总写进 hint 区（借用 chartHint 不合适，直接放到表格下方说明已有）
    return rows;
  }

  /* ---------- 每次预测明细表 ---------- */
  function renderRunTable(symData) {
    var runs = symData.runs.slice().sort(function (a, b) { return b.index - a.index; });
    var h = '<thead><tr>' +
      '<th>批次</th><th>锚点（北京）</th><th>锚点收盘</th>' +
      '<th>预训练 P50</th><th>涨跌</th><th>校准 P50</th>' +
      '<th>悲观 P10</th><th>中性 P50</th><th>乐观 P90</th>' +
      '<th>P10–P90</th><th>p_up</th></tr></thead><tbody>';

    runs.forEach(function (r) {
      var p = r.pretrained;
      var t = p.tiers || {};
      var be = t.bearish ? t.bearish.cal : null;
      var ba = t.base ? t.base.cal : null;
      var bu = t.bullish ? t.bullish.cal : null;
      var band = p.band_pct ? '[' + fmtPct(p.band_pct[0]) + ', ' + fmtPct(p.band_pct[1]) + ']' : '—';

      h += '<tr>' +
        '<td class="sym">' + r.id + '</td>' +
        '<td>' + r.anchor.slice(0, 16) + '</td>' +
        '<td>' + K.fmtPrice(r.last_close) + '</td>' +
        '<td>' + K.fmtPrice(p.end) + '</td>' +
        '<td class="' + cls(p.chg) + '">' + fmtPct(p.chg) + '</td>' +
        '<td>' + K.fmtPrice(p.cal) + '</td>' +
        '<td>' + (be != null ? K.fmtPrice(be) : '—') + '</td>' +
        '<td>' + (ba != null ? K.fmtPrice(ba) : '—') + '</td>' +
        '<td>' + (bu != null ? K.fmtPrice(bu) : '—') + '</td>' +
        '<td>' + band + '</td>' +
        '<td>' + (p.prob_up != null ? p.prob_up.toFixed(3) : '—') + '</td>' +
        '</tr>';
    });
    h += '</tbody>';
    el.runTable.innerHTML = h;
  }

  /* ---------- KPI ---------- */
  function renderKpis(symData, scoreRows) {
    var runs = symData.runs;
    if (!runs.length) { el.kpis.innerHTML = ''; return; }
    var latest = runs[runs.length - 1];
    var p = latest.pretrained;

    var cards = [];
    cards.push({
      k: '最新收盘（' + latest.anchor.slice(0, 10) + ' 北京）',
      v: K.fmtPrice(latest.last_close),
      d: state.sym,
      c: ''
    });
    cards.push({
      k: '最新一次预测终点（' + latest.dates[latest.dates.length - 1].slice(5, 10) + '）',
      v: K.fmtPrice(p.end),
      d: '原始 ' + fmtPct(p.chg),
      c: cls(p.chg)
    });
    cards.push({
      k: '校准后终点',
      v: K.fmtPrice(p.cal),
      d: fmtPct(p.cal_chg),
      c: cls(p.cal_chg)
    });

    if (scoreRows.length) {
      var rawMae = scoreRows.reduce(function (a, b) { return a + Math.abs(b.rawErr); }, 0) / scoreRows.length;
      var calMae = scoreRows.reduce(function (a, b) { return a + Math.abs(b.calErr); }, 0) / scoreRows.length;
      var hits = scoreRows.filter(function (x) { return x.dirHit; }).length;
      cards.push({
        k: '已兑现 ' + scoreRows.length + ' 个日点 · 平均绝对误差',
        v: rawMae.toFixed(2) + '%',
        d: '校准后 ' + calMae.toFixed(2) + '%　方向 ' + hits + '/' + scoreRows.length,
        c: calMae < rawMae ? 'up' : 'down'
      });
    }

    var t = p.tiers || {};
    if (t.bearish && t.bullish) {
      cards.push({
        k: '悲观 P10 ｜ 乐观 P90',
        v: K.fmtPrice(t.bearish.cal) + ' ｜ ' + K.fmtPrice(t.bullish.cal),
        d: fmtPct(t.bearish.cal_chg) + ' ｜ ' + fmtPct(t.bullish.cal_chg),
        c: ''
      });
    }

    el.kpis.innerHTML = cards.map(function (c) {
      return '<div class="kpi"><div class="k">' + c.k + '</div>' +
        '<div class="v ' + c.c + '">' + c.v + '</div>' +
        '<div class="d">' + c.d + '</div></div>';
    }).join('');
  }

  /* ---------- 结论文案（按数据算，不写死） ---------- */
  function renderNote(symData, scoreRows) {
    var runs = symData.runs;
    if (!runs.length) { el.latestNote.innerHTML = ''; return; }

    var msgs = [];
    var upRuns = runs.filter(function (r) { return r.pretrained.chg > 0; }).length;
    msgs.push('最近 ' + runs.length + ' 次预测里，有 <b>' + upRuns + ' 次</b>的原始中位预测指向上涨。' +
      (upRuns === runs.length ? '全部偏多——这是模型在下跌/震荡段里最典型的表现。' : ''));

    if (scoreRows.length) {
      var rawMae = scoreRows.reduce(function (a, b) { return a + Math.abs(b.rawErr); }, 0) / scoreRows.length;
      var calMae = scoreRows.reduce(function (a, b) { return a + Math.abs(b.calErr); }, 0) / scoreRows.length;
      var hits = scoreRows.filter(function (x) { return x.dirHit; }).length;
      msgs.push('已兑现 ' + scoreRows.length + ' 个日点：模型平均绝对误差 <b>' + rawMae.toFixed(2) + '%</b>，' +
        '校准后 <b>' + calMae.toFixed(2) + '%</b>（' +
        (calMae < rawMae ? '校准有效' : '校准反而更差，因为把本来打准的那次压过头了') + '），' +
        '方向命中 <b>' + hits + '/' + scoreRows.length + '</b>。');

      var worst = scoreRows.slice().sort(function (a, b) {
        return Math.abs(b.rawErr) - Math.abs(a.rawErr);
      })[0];
      if (worst) {
        msgs.push('错得最狠的一次是 <b>' + worst.date.slice(0, 16) + '</b>：模型 ' +
          K.fmtPrice(worst.raw) + '，真实 ' + K.fmtPrice(worst.real) + '，偏 ' +
          fmtPct(worst.rawErr) + '。这种级别的偏差通常来自行情结构突变，K 线本身看不到原因。');
      }
    } else {
      msgs.push('目前还没有已兑现的预测日，等第一个预测日的收盘出来后这里会显示误差。');
    }

    msgs.push('用法提醒：预测是<b>概率区间</b>，看 P10–P90 的宽度和方向是否左偏，比盯单一中位数字更有意义。');
    el.latestNote.innerHTML = msgs.map(function (m) { return '<p>' + m + '</p>'; }).join('');
  }

  /* ---------- 主绘制 ---------- */
  function draw() {
    var symData = state.data.symbols[state.sym];
    var opts = {
      showAll: state.showAll,
      showLabels: state.showLabels,
      showBand: state.showBand,
      showCal: state.showCal
    };

    var res = K.render(el.svg, symData, opts);
    K.renderLegend(el.legend, res.runs || [], opts);

    lastGeom = res.geom;
    lastShown = res.runs || [];

    var scoreRows = renderScore(symData);
    renderRunTable(symData);
    renderKpis(symData, scoreRows);
    renderNote(symData, scoreRows);

    var shown = (res.runs || []).length;
    var total = symData.runs.length;
    el.chartHint.textContent = total > 3 && !state.showAll
      ? '当前只显示最近 3 次预测（共 ' + total + ' 次）。配色 3 色循环 —— 第 4 次预测会回到第 1 次的颜色，勾「显示全部历史」可以看到它们重复出现。'
      : '每次预测的线、点、带、标注、X 轴刻度都是同一个颜色；X 轴下方色条标出各次预测覆盖的日期段。';

    paramsToUrl();
  }

  /* ---------- 深链 ---------- */
  function paramsToUrl() {
    var q = [];
    if (state.sym !== 'BTC') q.push('sym=' + state.sym);
    if (state.showAll) q.push('all=1');
    if (!state.showLabels) q.push('labels=0');
    if (!state.showBand) q.push('band=0');
    if (!state.showCal) q.push('cal=0');
    var url = location.pathname + (q.length ? '?' + q.join('&') : '');
    history.replaceState(null, '', url);
  }

  function readUrl() {
    var p = new URLSearchParams(location.search);
    if (p.get('sym') && state.data.symbols[p.get('sym')]) state.sym = p.get('sym');
    state.showAll = p.get('all') === '1';
    state.showLabels = p.get('labels') !== '0';
    state.showBand = p.get('band') !== '0';
    state.showCal = p.get('cal') !== '0';
  }

  /* ---------- 标签页 ---------- */
  function renderTabs() {
    var syms = Object.keys(state.data.symbols);
    el.tabs.innerHTML = syms.map(function (s) {
      return '<button role="tab" data-sym="' + s + '" aria-selected="' +
        (s === state.sym) + '">' + s + '</button>';
    }).join('');
    Array.prototype.forEach.call(el.tabs.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        state.sym = b.dataset.sym;
        Array.prototype.forEach.call(el.tabs.querySelectorAll('button'), function (x) {
          x.setAttribute('aria-selected', String(x.dataset.sym === state.sym));
        });
        draw();
      });
    });
  }

  /* ---------- 悬停提示 ---------- */
  var lastGeom = null;
  var lastShown = [];

  function bindTip() {
    el.svg.addEventListener('mousemove', function (ev) {
      if (!lastGeom) { el.tip.hidden = true; return; }
      var symData = state.data.symbols[state.sym];
      var rect = el.svg.getBoundingClientRect();
      var svgX = (ev.clientX - rect.left) / rect.width * lastGeom.W;
      var svgY = (ev.clientY - rect.top) / rect.height * lastGeom.H;

      var fx = (svgX - lastGeom.PAD_L) / (lastGeom.W - lastGeom.PAD_L - lastGeom.PAD_R);
      var fy = (svgY - lastGeom.PAD_T) / (lastGeom.H - lastGeom.PAD_T - lastGeom.PAD_B);
      if (fx < -0.02 || fx > 1.02 || fy < -0.02 || fy > 1.02) { el.tip.hidden = true; return; }

      var t = lastGeom.xmin.getTime() + fx * (lastGeom.xmax.getTime() - lastGeom.xmin.getTime());
      var v = lastGeom.ymax - fy * (lastGeom.ymax - lastGeom.ymin);

      // 找最近的一次预测点（同一时间轴）
      var best = null, bestD = 1e18;
      (lastShown || []).forEach(function (r) {
        r.dates.forEach(function (s, k) {
          var pt = K.parseDate(s).getTime();
          var dx = lastGeom.X(pt) - svgX;
          var dy = lastGeom.Y(r.pretrained.p50[k]) - svgY;
          var d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = { run: r, k: k, date: s, p50: r.pretrained.p50[k] };
          }
        });
      });

      var actMap = {};
      symData.actual.forEach(function (p) { actMap[p[0]] = p[1]; });

      var lines = [
        '<b>' + K.fmtMDHM(new Date(t)) + '</b>',
        '坐标 ≈ ' + K.fmtPrice(v)
      ];
      if (best && bestD < 26 * 26) {
        lines.push('run' + best.run.index + ' P50 = ' + K.fmtPrice(best.p50));
      }
      // 当天真实收盘
      var keys = Object.keys(actMap);
      var near = keys.reduce(function (a, k2) {
        var d2 = Math.abs(K.parseDate(k2).getTime() - t);
        return d2 < a.d ? { d: d2, k: k2 } : a;
      }, { d: Infinity, k: null });
      if (near.k && near.d < 6 * 3600 * 1000) {
        lines.push('真实收盘 = <b>' + K.fmtPrice(actMap[near.k]) + '</b>');
      }

      el.tip.innerHTML = lines.join('<br>');
      el.tip.style.left = (ev.clientX - rect.left) + 'px';
      el.tip.style.top = (ev.clientY - rect.top) + 'px';
      el.tip.hidden = false;
    });
    el.svg.addEventListener('mouseleave', function () { el.tip.hidden = true; });
  }

  /* ---------- PNG 导出 ---------- */
  function exportPng() {
    var clone = el.svg.cloneNode(true);
    // 画布需要显式底色
    var bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', 0); bg.setAttribute('y', 0);
    bg.setAttribute('width', 1180); bg.setAttribute('height', 620);
    bg.setAttribute('fill', '#ffffff');
    clone.insertBefore(bg, clone.firstChild);

    // 描边色用了 #fff，深色模式下导出的白描边正好
    var xml = new XMLSerializer().serializeToString(clone);
    var svg64 = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);

    var img = new Image();
    img.onload = function () {
      var scale = 2;
      var cv = document.createElement('canvas');
      cv.width = 1180 * scale;
      cv.height = 620 * scale;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);

      cv.toBlob(function (blob) {
        var a = document.createElement('a');
        var latest = state.data.symbols[state.sym].runs.slice(-1)[0];
        a.download = 'kronos-' + state.sym + '-' +
          (latest ? latest.anchor_date : 'chart') + '.png';
        a.href = URL.createObjectURL(blob);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      }, 'image/png');
    };
    img.onerror = function () { alert('导出失败：浏览器无法把 SVG 转成图片'); };
    img.src = svg64;
  }

  /* ---------- 启动 ---------- */
  function boot() {
    fetch('data/series.json?t=' + Date.now())
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (d) {
        state.data = d;
        readUrl();
        var totalRuns = Math.max.apply(null, Object.keys(d.symbols).map(function (s) {
          return d.symbols[s].runs.length;
        }));
        el.meta.textContent = '共 ' + totalRuns + ' 次预测 · 时间口径 ' + d.timezone +
          ' · 数据更新于 ' + d.generated_at;
        el.footer.textContent = 'Kronos-base + 各自微调模型 · lookback 500 日K · pred_len 3 · 32 条采样路径 · ' +
          '生成于 ' + d.generated_at + '（' + d.timezone + '）';

        renderTabs();
        document.getElementById('showAll').checked = state.showAll;
        document.getElementById('showLabels').checked = state.showLabels;
        document.getElementById('showBand').checked = state.showBand;
        document.getElementById('showCal').checked = state.showCal;
        draw();
        bindTip();
      })
      .catch(function (e) {
        el.meta.textContent = '加载数据失败：' + e.message;
      });

    document.getElementById('showAll').addEventListener('change', function (e) {
      state.showAll = e.target.checked; draw();
    });
    document.getElementById('showLabels').addEventListener('change', function (e) {
      state.showLabels = e.target.checked; draw();
    });
    document.getElementById('showBand').addEventListener('change', function (e) {
      state.showBand = e.target.checked; draw();
    });
    document.getElementById('showCal').addEventListener('change', function (e) {
      state.showCal = e.target.checked; draw();
    });
    document.getElementById('dlPng').addEventListener('click', exportPng);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
