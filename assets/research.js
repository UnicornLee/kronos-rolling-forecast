/* research.html 的渲染逻辑：读 data/proxy.json，生成表格 + 走势对照图。
   纯原生 JS，无依赖。图表为手写 SVG，主题跟随系统深浅色。 */
(function () {
  'use strict';

  var state = { data: null, sym: 'XAUT', norm: true };
  var SYMS = ['BTC', 'ETH', 'XAUT'];
  var PROXIES = ['DGS2', 'DGS10', 'DFII10', 'T10Y2Y', 'DTWEXBGS', 'VIXCLS', 'FNG', 'NDX'];

  var ACTUAL_COLOR = { light: '#20222A', dark: '#E9EDF4' };
  var PROXY_COLORS = {
    DGS2: ['#00969E', '#33BCC2'],
    DGS10: ['#1E6FD9', '#6AA6FF'],
    DFII10: ['#E28010', '#F09A2C'],
    T10Y2Y: ['#6C44C8', '#9273EC'],
    DTWEXBGS: ['#C0392B', '#F08A7D'],
    VIXCLS: ['#8A6D00', '#D0A93A'],
    FNG: ['#137A62', '#4FD1B0'],
    NDX: ['#7A3E9D', '#B183D6']
  };

  function isDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function pc(k) { return PROXY_COLORS[k][isDark() ? 1 : 0]; }
  function fmtPrice(v) {
    if (v == null) return '—';
    var a = Math.abs(v);
    if (a >= 10000) return v.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (a >= 100) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    return v.toFixed(3);
  }
  function fmtCorr(v) {
    if (v == null) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(2);
  }
  function corrClass(v) {
    if (v == null) return '';
    var a = Math.abs(v);
    if (a >= 0.6) return 'corr-hi';
    if (a >= 0.35) return 'corr-mid';
    if (a >= 0.15) return 'corr-lo';
    return 'corr-none';
  }
  function corrBg(v) {
    if (v == null) return 'transparent';
    var a = Math.min(Math.abs(v), 1);
    var alpha = (a * 0.55).toFixed(3);
    var dark = isDark();
    if (a < 0.15) return 'transparent';
    return v < 0
      ? 'rgba(' + (dark ? '240,138,125' : '192,57,43') + ',' + alpha + ')'
      : 'rgba(' + (dark ? '79,209,176' : '19,122,98') + ',' + alpha + ')';
  }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  /* ---------- 结论区 ---------- */
  function renderVerdict(d) {
    var best = d.gate.XAUT;
    var box = document.getElementById('verdict');
    box.innerHTML =
      '<p><b>加数据本身不会提高准头。</b>把利率、美元、VIX、情绪指数这些变量直接拿去预测未来 3 天涨跌，' +
      '相关性全部落在 |r| &lt; 0.3，多数不到 0.1——它们不告诉你明天涨还是跌。</p>' +
      '<p><b>但它们能告诉你"模型此刻可不可信"。</b>同一批变量与 Kronos 的末值误差相关，' +
      'XAUT 的 2 年期美债收益率相关性高达 <b>' + fmtCorr(d.win_corr.XAUT.DGS2) +
      '</b>，比成交量特征（+0.55）还强。这才是它们的正确用法：<b>做闸门，不做特征</b>。</p>' +
      '<p><b>先改问题定义，再加数据。</b>12 个窗口里 flat（价格不变）在三个标的上全部赢过模型，' +
      '说明 7 天视野太长、点预测太脆。缩短视野、输出区间，收益比堆数据大得多。</p>';

    var k = document.getElementById('kpis');
    k.innerHTML = '';
    var cards = [
      { k: '预测涨跌最好情况', v: '|r| < 0.28', d: '所有代理 × 所有标的' },
      { k: 'XAUT 误差相关性', v: fmtCorr(d.win_corr.XAUT.DGS2), d: 'DGS2（2 年期美债）' },
      { k: 'gate 后 XAUT MAPE', v: best.best.mape.toFixed(2) + '%', d: 'flat ' + best.flat.toFixed(2) + '% / 模型 ' + best.raw.toFixed(2) + '%' },
      { k: 'flat 全胜', v: '3 / 3', d: 'BTC · ETH · XAUT 十二窗口' }
    ];
    cards.forEach(function (c) {
      var box2 = el('div', 'kpi');
      box2.appendChild(el('div', 'k', c.k));
      box2.appendChild(el('div', 'v', c.v));
      box2.appendChild(el('div', 'd', c.d));
      k.appendChild(box2);
    });
  }

  /* ---------- 代理变量表 ---------- */
  function renderProxyTable(d) {
    var t = document.getElementById('proxyTable');
    var head = '<thead><tr><th>变量</th><th>最新值</th><th>日期</th><th>当前分位</th><th>为什么值得看</th></tr></thead>';
    var rows = PROXIES.map(function (k) {
      var m = d.meta[k] || {};
      var lt = d.latest[k] || {};
      var s = d.series[k] || [];
      var vals = s.map(function (p) { return p[1]; });
      var q = '—';
      if (vals.length > 30 && lt.value != null) {
        var hist = vals.slice(-250);
        var below = hist.filter(function (v) { return v <= lt.value; }).length;
        q = (below / hist.length * 100).toFixed(0) + '%';
      }
      return '<tr><td class="sym">' + (m.name || k) +
        ' <span class="dim">' + k + '</span></td>' +
        '<td>' + fmtPrice(lt.value) + (m.unit || '') + '</td>' +
        '<td>' + (lt.date || '—') + '</td>' +
        '<td>' + q + '</td>' +
        '<td class="tdnote">' + (m.why || '') + '</td></tr>';
    }).join('');
    t.innerHTML = head + '<tbody>' + rows + '</tbody>';
  }

  /* ---------- 相关性表（用途一） ---------- */
  function renderCorrTable(d) {
    var t = document.getElementById('corrTable');
    var head = '<thead><tr><th>变量</th>' +
      SYMS.map(function (s) { return '<th colspan="2">' + s + '</th>'; }).join('') +
      '</tr><tr class="sub2"><th></th>' +
      SYMS.map(function () { return '<th>水平</th><th>变化量</th>'; }).join('') +
      '</tr></thead>';
    var rows = PROXIES.map(function (k) {
      var m = d.meta[k] || {};
      var cells = SYMS.map(function (s) {
        var lv = (d.corr_level[s] || {})[k];
        var df = (d.corr_diff[s] || {})[k];
        return '<td class="' + corrClass(lv) + '" style="background:' + corrBg(lv) + '">' + fmtCorr(lv) + '</td>' +
               '<td class="' + corrClass(df) + '" style="background:' + corrBg(df) + '">' + fmtCorr(df) + '</td>';
      }).join('');
      return '<tr><td class="sym">' + (m.name || k) + '</td>' + cells + '</tr>';
    }).join('');
    t.innerHTML = head + '<tbody>' + rows + '</tbody>';
  }

  /* ---------- 误差相关性表（用途二） ---------- */
  function renderWinCorrTable(d) {
    document.getElementById('lagTxt').textContent = d.lag_days;
    var t = document.getElementById('winCorrTable');
    var head = '<thead><tr><th>变量</th>' +
      SYMS.map(function (s) { return '<th>' + s + '</th>'; }).join('') +
      '<th>最强</th></tr></thead>';
    var rows = PROXIES.map(function (k) {
      var m = d.meta[k] || {};
      var vals = SYMS.map(function (s) { return (d.win_corr[s] || {})[k]; });
      var abs = vals.map(function (v) { return v == null ? 0 : Math.abs(v); });
      var mi = abs.indexOf(Math.max.apply(null, abs));
      var cells = vals.map(function (v) {
        return '<td class="' + corrClass(v) + '" style="background:' + corrBg(v) + '">' + fmtCorr(v) + '</td>';
      }).join('');
      return '<tr><td class="sym">' + (m.name || k) + '</td>' + cells +
        '<td class="dim">' + (Math.max.apply(null, abs) > 0 ? SYMS[mi] : '—') + '</td></tr>';
    }).join('');
    t.innerHTML = head + '<tbody>' + rows + '</tbody>';
  }

  /* ---------- gate 表 ---------- */
  function renderGateTable(d) {
    var t = document.getElementById('gateTable');
    var head = '<thead><tr><th>标的</th><th>直接用模型</th><th>永远 flat</th>' +
      '<th>最优闸门</th><th>闸门后 MAPE</th><th>比模型改善</th><th>比 flat 改善</th><th>信模型占比</th></tr></thead>';
    var rows = SYMS.map(function (s) {
      var g = d.gate[s];
      var b = g.best;
      var feat = b ? (d.meta[b.feature] || {}).name || b.feature : '—';
      var rule = b ? feat + ' 分位 ' + (b.dir > 0 ? '>' : '<') + ' ' + b.q + ' → 信模型' : '—';
      var impR = g.impr_vs_raw > 0
        ? '<span class="hit">−' + g.impr_vs_raw.toFixed(2) + 'pp</span>'
        : '<span class="miss">+' + Math.abs(g.impr_vs_raw).toFixed(2) + 'pp</span>';
      var impF = g.impr_vs_flat > 0.005
        ? '<span class="hit">−' + g.impr_vs_flat.toFixed(2) + 'pp</span>'
        : '<span class="flat">≈ 0</span>';
      return '<tr><td class="sym">' + s + '</td>' +
        '<td>' + g.raw.toFixed(2) + '%</td>' +
        '<td>' + g.flat.toFixed(2) + '%</td>' +
        '<td class="tdnote">' + rule + '</td>' +
        '<td><b>' + (b ? b.mape.toFixed(2) + '%' : '—') + '</b></td>' +
        '<td>' + impR + '</td><td>' + impF + '</td>' +
        '<td>' + (b ? (b.model_share * 100).toFixed(0) + '%' : '—') + '</td></tr>';
    }).join('');
    t.innerHTML = head + '<tbody>' + rows + '</tbody>';
  }

  /* ---------- 走势图（手写 SVG） ---------- */
  var W = 1120, H = 420, PL = 62, PR = 26, PT = 20, PB = 48;

  function toNum(ds) { return Date.parse(ds + 'T00:00:00Z') / 86400000; }

  function draw() {
    var d = state.data;
    if (!d) return;
    var svg = document.getElementById('chart');
    var sym = state.sym;
    var dark = isDark();
    var bg = dark ? '#141920' : '#FFFFFF';
    var gridC = dark ? 'rgba(233,237,244,.14)' : 'rgba(32,34,42,.10)';
    var tickC = dark ? 'rgba(233,237,244,.80)' : 'rgba(32,34,42,.72)';
    var actC = dark ? ACTUAL_COLOR.dark : ACTUAL_COLOR.light;

    // 取序列：实际价格 + 三个代表性代理变量
    var rep = { XAUT: ['DFII10', 'DTWEXBGS', 'VIXCLS'], BTC: ['NDX', 'VIXCLS', 'DTWEXBGS'], ETH: ['NDX', 'VIXCLS', 'DTWEXBGS'] }[sym];
    var act = d.actual[sym] || [];
    if (!act.length) return;

    var series = [];
    series.push({ key: 'PRICE', name: sym + ' 收盘', color: actC, pts: act, dash: false, width: 2.8 });

    rep.forEach(function (k) {
      var raw = d.series[k] || [];
      if (!raw.length) return;
      // 把代理序列限制在实际序列的时间范围内
      var d0 = act[0][0], d1 = act[act.length - 1][0];
      var clipped = raw.filter(function (p) { return p[0] >= d0 && p[0] <= d1; });
      if (clipped.length < 10) clipped = raw;
      series.push({
        key: k,
        name: (d.meta[k] || {}).name || k,
        color: pc(k),
        pts: clipped,
        dash: true,
        smooth: true,
        width: 1.9
      });
    });

    // 代理变量做 20 点滑动平均，压掉日度噪声（VIX / 纳指尤其剧烈）
    series.forEach(function (s) {
      if (!s.smooth) return;
      var out2 = [], win = 20;
      for (var i = 0; i < s.pts.length; i++) {
        var a = Math.max(0, i - win + 1);
        var seg = s.pts.slice(a, i + 1);
        var sum = seg.reduce(function (t, p) { return t + p[1]; }, 0);
        out2.push([s.pts[i][0], sum / seg.length]);
      }
      s.pts = out2;
    });

    // 归一化：以开头 5 个有效点的均值作基准（避免首点异常值把后面放大）
    if (state.norm) {
      series.forEach(function (s) {
        var head = s.pts.slice(0, 5).map(function (p) { return p[1]; }).filter(function (v) { return v; });
        var base = head.reduce(function (a, b) { return a + b; }, 0) / (head.length || 1);
        if (!base) return;
        s.pts = s.pts.map(function (p) { return [p[0], p[1] / base * 100]; });
      });
    }

    // 时间轴用「日序号」避免非交易日塌缩
    var allT = [];
    series.forEach(function (s) { s.pts.forEach(function (p) { allT.push(toNum(p[0])); }); });
    var tmin = Math.min.apply(null, allT), tmax = Math.max.apply(null, allT);
    var allV = [];
    series.forEach(function (s) { s.pts.forEach(function (p) { allV.push(p[1]); }); });
    // 用 1%/99% 分位裁剪，避免单个异常尖峰把整张图压平
    allV.sort(function (a, b) { return a - b; });
    var lo = allV[Math.floor(allV.length * 0.01)];
    var hi = allV[Math.floor(allV.length * 0.99)];
    var vmin = lo, vmax = hi;
    var pad = (vmax - vmin) * 0.10 || 1;
    vmin -= pad; vmax += pad;

    var X = function (t) { return PL + (t - tmin) / (tmax - tmin) * (W - PL - PR); };
    var Y = function (v) { return PT + (vmax - v) / (vmax - vmin) * (H - PT - PB); };

    var out = [];
    out.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + bg + '"/>');

    // Y 轴网格 + 刻度
    var ticks = 5;
    for (var i = 0; i <= ticks; i++) {
      var v = vmin + (vmax - vmin) * i / ticks;
      var y = Y(v);
      out.push('<line x1="' + PL + '" y1="' + y.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + y.toFixed(1) + '" stroke="' + gridC + '" stroke-width="1"/>');
      out.push('<text x="' + (PL - 10) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="13" font-weight="500" fill="' + tickC + '">' + v.toFixed(state.norm ? 0 : 2) + '</text>');
    }
    out.push('<text x="' + (W - PR) + '" y="' + (PT - 8) + '" text-anchor="end" font-size="12" fill="' + tickC + '" fill-opacity=".55">' + (state.norm ? '归一化：起点 = 100' : '原始数值') + '</text>');

    // X 轴刻度（按月）
    var months = [];
    var cur = new Date(tmin * 86400000);
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    while (cur.getTime() / 86400000 < tmax) {
      months.push(cur.getTime() / 86400000);
      cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 3, 1));
    }
    var lastLbl = -999;
    months.forEach(function (t) {
      var x = X(t);
      if (x - lastLbl < 58) return;
      lastLbl = x;
      var dt = new Date(t * 86400000);
      out.push('<line x1="' + x.toFixed(1) + '" y1="' + PT + '" x2="' + x.toFixed(1) + '" y2="' + (H - PB) + '" stroke="' + gridC + '" stroke-width="1"/>');
      out.push('<text x="' + x.toFixed(1) + '" y="' + (H - PB + 20) + '" text-anchor="middle" font-size="13" fill="' + tickC + '">' +
        dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '</text>');
    });

    // 折线（超出裁剪范围的点直接跳过，避免画出图外）
    series.forEach(function (s) {
      var segs = [], cur = [];
      s.pts.forEach(function (p) {
        var v = p[1];
        if (v < vmin || v > vmax) {
          if (cur.length > 1) segs.push(cur);
          cur = [];
          return;
        }
        cur.push([X(toNum(p[0])), Y(v)]);
      });
      if (cur.length > 1) segs.push(cur);
      segs.forEach(function (sg) {
        var dstr = sg.map(function (q, idx) {
          return (idx ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1);
        }).join(' ');
        out.push('<path d="' + dstr + '" fill="none" stroke="' + s.color + '" stroke-width="' + s.width +
          '" stroke-linejoin="round" stroke-linecap="round"' +
          (s.dash ? ' stroke-dasharray="5 4"' : '') + '/>');
      });
    });

    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.innerHTML = out.join('');

    // 图例
    var lg = document.getElementById('legend');
    lg.innerHTML = series.map(function (s) {
      return '<span class="item"><span class="swatch" style="background:' + s.color +
        (s.dash ? ';background:repeating-linear-gradient(90deg,' + s.color + ' 0 5px,transparent 5px 9px)' : '') +
        '"></span>' + s.name + '</span>';
    }).join('');

    var hint = document.getElementById('chartHint');
    hint.textContent = (state.norm
      ? '每条序列都除以自己开头 5 天的均值 ×100，只能比「相对涨跌幅度」，不能比绝对水平。'
      : '原始数值并列：价格与利率/指数刻度差异很大，对比形态时建议勾选归一化。')
      + ' 代理变量已做 20 日滑动平均。';

    lastSeries = series;
  }

  var lastSeries = [];

  function renderTabs() {
    var box = document.getElementById('proxyTabs');
    box.innerHTML = '';
    SYMS.forEach(function (s) {
      var b = el('button', null, s);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', state.sym === s ? 'true' : 'false');
      b.addEventListener('click', function () {
        state.sym = s;
        renderTabs();
        draw();
      });
      box.appendChild(b);
    });
  }

  function bindTip() {
    var svg = document.getElementById('chart');
    var tip = document.getElementById('tip');
    var box = document.getElementById('chartbox');
    svg.addEventListener('mousemove', function (ev) {
      if (!lastSeries.length) return;
      var r = svg.getBoundingClientRect();
      var sx = (ev.clientX - r.left) / r.width * W;
      var t = tminG + (sx - PL) / (W - PL - PR) * (tmaxG - tminG);
      if (t < tminG || t > tmaxG) { tip.hidden = true; return; }
      var lines = [];
      lastSeries.forEach(function (s) {
        var bestp = null, bd = 1e18;
        s.pts.forEach(function (p) {
          var dd = Math.abs(toNum(p[0]) - t);
          if (dd < bd) { bd = dd; bestp = p; }
        });
        if (bestp && bd < 6) {
          lines.push('<span style="color:' + s.color + '">●</span> ' + s.name + ' <b>' +
            (state.norm ? bestp[1].toFixed(1) : fmtPrice(bestp[1])) + '</b> <span style="opacity:.7">' + bestp[0] + '</span>');
        }
      });
      if (!lines.length) { tip.hidden = true; return; }
      tip.innerHTML = lines.join('<br>');
      tip.hidden = false;
      var px = ev.clientX - box.getBoundingClientRect().left;
      var py = ev.clientY - box.getBoundingClientRect().top;
      tip.style.left = px + 'px';
      tip.style.top = py + 'px';
    });
    svg.addEventListener('mouseleave', function () { tip.hidden = true; });
  }

  var tminG = 0, tmaxG = 1;
  function stashRange() {
    var allT = [];
    lastSeries.forEach(function (s) { s.pts.forEach(function (p) { allT.push(Date.parse(p[0] + 'T00:00:00Z') / 86400000); }); });
    if (allT.length) { tminG = Math.min.apply(null, allT); tmaxG = Math.max.apply(null, allT); }
  }

  function boot() {
    fetch('data/proxy.json', { cache: 'no-cache' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        state.data = d;
        document.getElementById('meta').textContent =
          '区间 ' + d.start + ' → ' + d.end + ' ｜ 提前 ' + d.lag_days +
          ' 天对齐 ｜ ' + d.generated_at + '（' + d.timezone + '）';
        document.getElementById('footerMeta').textContent =
          '数据源：FRED 六个利率/汇率序列 · alternative.me 情绪指数 · Yahoo 纳指｜回测：Kronos-base 12 窗口｜生成于 ' + d.generated_at;

        renderVerdict(d);
        renderProxyTable(d);
        renderCorrTable(d);
        renderWinCorrTable(d);
        renderGateTable(d);
        renderTabs();
        draw();
        stashRange();
        bindTip();

        document.getElementById('norm').addEventListener('change', function (e) {
          state.norm = e.target.checked;
          draw();
          stashRange();
        });
        if (window.matchMedia) {
          var mq = window.matchMedia('(prefers-color-scheme: dark)');
          (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(function () {
            draw(); stashRange();
            renderCorrTable(d); renderWinCorrTable(d);
          });
        }
      })
      .catch(function (err) {
        document.getElementById('meta').textContent = '数据加载失败：' + err.message;
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
