/* Kronos 滚动预测图表引擎 —— 纯 SVG，无依赖
 *
 * 规则：
 *   1. 每次预测一个颜色，3 色循环 —— 第 4 次预测用回第 1 次的颜色。
 *   2. P50 折线上的每个点、校准虚线终点菱形，直接标价格，颜色 = 该次预测的颜色。
 *   3. P10/P90 阴影带的顶点默认不写字（太挤），鼠标放上去才显示 —— 输出 data-* 交给 app.js。
 *   4. 自动跟随浅色 / 深色主题：深色底上用浅色画实际收盘与坐标，避免糊成一片。
 */
(function (global) {
  'use strict';

  // 3 色循环：青绿 / 琥珀橙 / 紫罗兰（色相拉得够开）
  // line   = 浅色底用；lineDark = 深色底用（提亮一档，否则紫罗兰在深底上发黑）
  var PALETTE = [
    { line: '#00969E', lineDark: '#33BCC2', text: '#005B57', textDark: '#5AD8DE', name: '青绿' },
    { line: '#E28010', lineDark: '#F09A2C', text: '#8A4E06', textDark: '#F7B457', name: '琥珀橙' },
    { line: '#6C44C8', lineDark: '#9273EC', text: '#4C2A9C', textDark: '#B4A0F8', name: '紫罗兰' }
  ];

  var THEMES = {
    light: {
      dark: false, bg: '#FFFFFF',
      actual: '#20222A',          // 实际收盘线 / 价格刻度
      axis: 'rgba(32,34,42,.30)',
      tickOp: .88,
      labelStroke: '#FFFFFF',     // 标价文字的描边色 = 卡片底色
      realized: '#E63C32',
      realizedText: '#B32A20',
      bandOp: .20
    },
    dark: {
      dark: true, bg: '#141920',
      actual: '#E9EDF4',
      axis: 'rgba(233,237,244,.36)',
      tickOp: .96,
      labelStroke: '#141920',
      realized: '#FF6F61',
      realizedText: '#FFA096',
      bandOp: .24
    }
  };

  var FS = 13;          // 标价字号
  var TICK_FS = 13;     // 坐标刻度字号

  function theme(force) {
    if (force === 'light') return THEMES.light;
    if (force === 'dark') return THEMES.dark;
    if (force && typeof force === 'object') return force;
    var dark = !!(global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches);
    return dark ? THEMES.dark : THEMES.light;
  }

  function runColor(slot, T) {
    var p = PALETTE[slot % PALETTE.length];
    return {
      line: T.dark ? p.lineDark : p.line,
      text: T.dark ? p.textDark : p.text,
      name: p.name,
      slot: slot % PALETTE.length
    };
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function fmtPrice(v) {
    if (v == null || isNaN(v)) return '—';
    if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString('en-US');
    return v.toFixed(2);
  }

  function fmtPriceShort(v) {
    if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString('en-US');
    return v.toFixed(Math.abs(v) < 10 ? 3 : 2);
  }

  function fmtPct(v) {
    if (v == null || isNaN(v)) return '—';
    return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  }

  function parseDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s);
    if (!m) return new Date(s);
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  }

  function fmtMD(d) {
    return (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate();
  }

  function fmtMDHM(d) {
    var h = d.getHours();
    return fmtMD(d) + ' ' + (h < 10 ? '0' : '') + h + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }

  /* ---------------- 图例 ---------------- */
  function renderLegend(host, runs, opts) {
    var T = theme();
    var html = '';
    html += '<span class="item"><span class="swatch" style="background:' + T.actual + '"></span>实际收盘</span>';

    runs.forEach(function (r) {
      var c = r.color;
      html += '<span class="item"><span class="swatch" style="background:' + c.line + '"></span>' +
        esc(fmtMD(parseDate(r.anchor)) + ' 预测') +
        (r.isLatest ? ' <b style="color:' + c.text + '">最新</b>' : '') + '</span>';
    });

    html += '<span class="item"><span class="dot" style="background:' + T.realized + '"></span>已兑现的真实收盘</span>';
    if (opts.showBand) {
      html += '<span class="item"><span class="band" style="background:rgba(120,130,150,.20)"></span>' +
        'P10–P90 区间（顶点数值悬停查看）</span>';
    }
    if (opts.showCal) {
      html += '<span class="item" style="color:var(--text-3)">虚线菱形 = 校准终点</span>';
    }
    host.innerHTML = html;
  }

  /* ---------------- 主渲染 ---------------- */
  function render(svg, symData, opts) {
    opts = opts || {};
    var T = opts.themeForce ? theme(opts.themeForce) : theme();

    var W = 1180, H = 620;
    var PAD_L = 88, PAD_R = 176, PAD_T = 34, PAD_B = 62;
    var pw = W - PAD_L - PAD_R;
    var ph = H - PAD_T - PAD_B;

    var runs = symData.runs.slice();
    var visible = opts.showAll ? runs : runs.slice(-3);
    if (!visible.length) {
      svg.innerHTML = '<text x="20" y="40" font-size="14" fill="' + T.actual + '">还没有预测数据</text>';
      svg.setAttribute('viewBox', '0 0 600 120');
      return { runs: [] };
    }

    // 颜色：按时间顺序的序号取模 3 —— 第 4 次预测回到第 1 次的颜色
    var allSorted = runs.slice().sort(function (a, b) { return a.index - b.index; });
    allSorted.forEach(function (r, i) { r.color = runColor(i, T); });
    var latestIndex = allSorted[allSorted.length - 1].index;
    visible.forEach(function (r) { r.isLatest = (r.index === latestIndex); });

    // 实际收盘
    var actual = symData.actual.map(function (p) { return [parseDate(p[0]), p[1]]; });

    // 时间范围
    var firstAnchor = parseDate(visible[0].anchor);
    var lastDate = parseDate(visible[visible.length - 1].dates[visible[visible.length - 1].dates.length - 1]);
    var xmin = opts.showAll
      ? parseDate(allSorted[0].anchor)
      : new Date(firstAnchor.getTime() - 8 * 864e5);
    var xmax = lastDate;

    var actShow = actual.filter(function (p) { return p[0] >= xmin && p[0] <= xmax; });

    // Y 范围
    var ys = actShow.map(function (p) { return p[1]; });
    visible.forEach(function (r) {
      if (opts.showBand) {
        ys = ys.concat(r.pretrained.p10.slice(1), r.pretrained.p90.slice(1));
      } else {
        ys = ys.concat(r.pretrained.p50.slice(1));
      }
      if (opts.showCal) ys.push(r.pretrained.cal);
    });
    ys = ys.filter(function (v) { return v != null && !isNaN(v); });
    var ymin = Math.min.apply(null, ys), ymax = Math.max.apply(null, ys);
    var padY = (ymax - ymin) * 0.10 || ymax * 0.03;
    ymin -= padY; ymax += padY;

    var tmin = xmin.getTime(), tmax = xmax.getTime();
    function X(t) { return PAD_L + (t - tmin) / (tmax - tmin) * pw; }
    function Y(v) { return PAD_T + (ymax - v) / (ymax - ymin) * ph; }

    var out = [];

    // defs：每色一个渐变
    out.push('<defs>');
    PALETTE.forEach(function (c, i) {
      var base = T.dark ? c.lineDark : c.line;
      out.push('<linearGradient id="g' + i + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="' + base + '" stop-opacity="' + T.bandOp + '"/>' +
        '<stop offset="100%" stop-color="' + base + '" stop-opacity="' + (T.bandOp / 2) + '"/></linearGradient>');
    });
    out.push('</defs>');

    // ---- 网格 + Y 轴 ----
    var gy = 5;
    for (var i = 0; i <= gy; i++) {
      var v = ymin + (ymax - ymin) * i / gy;
      var y = Y(v);
      out.push('<line x1="' + PAD_L + '" y1="' + y.toFixed(1) + '" x2="' + (W - PAD_R) +
        '" y2="' + y.toFixed(1) + '" stroke="currentColor" stroke-opacity=".10" stroke-width="1"/>');
      out.push('<text x="' + (PAD_L - 12) + '" y="' + (y + 4.5).toFixed(1) + '" text-anchor="end" ' +
        'font-size="' + TICK_FS + '" font-weight="500" fill="' + T.actual + '" ' +
        'fill-opacity="' + T.tickOp + '">' + fmtPriceShort(v) + '</text>');
    }
    // Y 轴单位
    out.push('<text x="' + (PAD_L - 12) + '" y="' + (PAD_T - 12) + '" text-anchor="end" ' +
      'font-size="11.5" font-weight="600" fill="' + T.actual + '" fill-opacity=".62">价格（USDT）</text>');

    // ---- X 轴刻度：颜色跟随覆盖该日的最新一次预测 ----
    function ownerColor(t) {
      var hit = T.actual;
      visible.forEach(function (r) {
        var a = parseDate(r.anchor).getTime();
        var b = parseDate(r.dates[r.dates.length - 1]).getTime();
        if (t >= a && t <= b) hit = r.color.line;
      });
      return hit;
    }

    var dayMs = 864e5;
    var spanDays = Math.round((tmax - tmin) / dayMs);
    var stepD = Math.max(1, Math.ceil(spanDays / 8));
    for (var d = 0; d <= spanDays; d += stepD) {
      var t = tmin + d * dayMs;
      var dt = new Date(t);
      var x = X(t);
      if (x < PAD_L - 1 || x > W - PAD_R + 1) continue;
      out.push('<line x1="' + x.toFixed(1) + '" y1="' + PAD_T + '" x2="' + x.toFixed(1) +
        '" y2="' + (H - PAD_B) + '" stroke="currentColor" stroke-opacity=".055" stroke-width="1"/>');
      out.push('<text x="' + x.toFixed(1) + '" y="' + (H - PAD_B + 19) + '" text-anchor="middle" ' +
        'font-size="' + TICK_FS + '" font-weight="500" fill="' + ownerColor(t) + '" fill-opacity=".9">' +
        fmtMDHM(dt) + '</text>');
    }

    // 轴下方色条
    visible.forEach(function (r) {
      var x1 = X(parseDate(r.anchor).getTime());
      var x2 = X(parseDate(r.dates[r.dates.length - 1]).getTime());
      out.push('<rect x="' + x1.toFixed(1) + '" y="' + (H - PAD_B + 27) + '" ' +
        'width="' + Math.max(1, x2 - x1).toFixed(1) + '" height="4" rx="2" fill="' + r.color.line + '"/>');
    });

    // 轴线
    out.push('<line x1="' + PAD_L + '" y1="' + (H - PAD_B) + '" x2="' + (W - PAD_R) + '" y2="' +
      (H - PAD_B) + '" stroke="' + T.axis + '" stroke-width="1"/>');
    out.push('<line x1="' + PAD_L + '" y1="' + PAD_T + '" x2="' + PAD_L + '" y2="' + (H - PAD_B) +
      '" stroke="' + T.axis + '" stroke-width="1"/>');

    // ---- 1) 所有阴影带先画 ----
    if (opts.showBand) {
      visible.forEach(function (r) {
        var p90 = r.pretrained.p90, p10 = r.pretrained.p10, ds = r.dates;
        var up = [], dn = [];
        for (var k = 0; k < ds.length; k++) {
          up.push(X(parseDate(ds[k]).getTime()) + ',' + Y(p90[k]).toFixed(1));
          dn.push(X(parseDate(ds[k]).getTime()) + ',' + Y(p10[k]).toFixed(1));
        }
        out.push('<polygon points="' + up.concat(dn.reverse()).join(' ') +
          '" fill="url(#g' + r.color.slot + ')" stroke="' + r.color.line +
          '" stroke-opacity=".30" stroke-width="1"/>');
      });
    }

    // ---- 2) 折线 + 点 + 虚线 + 菱形 ----
    var labels = [];   // {pri, x, y, text, color}
    var hits = [];     // 带顶点的悬停热区

    visible.forEach(function (r) {
      var c = r.color, ds = r.dates, p50 = r.pretrained.p50;
      var pts = ds.map(function (s, k) { return [X(parseDate(s).getTime()), Y(p50[k])]; });

      out.push('<polyline points="' + pts.map(function (p) {
        return p[0].toFixed(1) + ',' + p[1].toFixed(1);
      }).join(' ') + '" fill="none" stroke="' + c.line + '" stroke-width="2.6" ' +
        'stroke-linejoin="round" stroke-linecap="round"/>');

      // 锚点：空心圈
      var ax = pts[0][0], ay = pts[0][1];
      out.push('<circle cx="' + ax.toFixed(1) + '" cy="' + ay.toFixed(1) + '" r="6" ' +
        'fill="' + T.bg + '" stroke="' + c.line + '" stroke-width="2.2"/>');

      // 未来点：实心圆
      pts.slice(1).forEach(function (p) {
        out.push('<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.6" fill="' + c.line + '"/>');
      });

      // 校准虚线
      if (opts.showCal && r.pretrained.cal != null) {
        var tx = X(parseDate(ds[ds.length - 1]).getTime());
        var ty = Y(r.pretrained.cal);
        out.push('<line x1="' + ax.toFixed(1) + '" y1="' + ay.toFixed(1) + '" x2="' + tx.toFixed(1) +
          '" y2="' + ty.toFixed(1) + '" stroke="' + c.line + '" stroke-width="1.8" ' +
          'stroke-dasharray="7 5" stroke-opacity=".9"/>');
        var rr = 7;
        out.push('<polygon points="' + tx.toFixed(1) + ',' + (ty - rr).toFixed(1) + ' ' +
          (tx + rr).toFixed(1) + ',' + ty.toFixed(1) + ' ' +
          tx.toFixed(1) + ',' + (ty + rr).toFixed(1) + ' ' +
          (tx - rr).toFixed(1) + ',' + ty.toFixed(1) + '" ' +
          'fill="' + T.bg + '" stroke="' + c.line + '" stroke-width="2"/>');
      }

      // ---- 收集标签 ----
      if (opts.showLabels) {
        var pri = r.isLatest ? 1 : 3;
        var fut = pts.slice(1).map(function (p, k) { return { p: p, v: p50[k + 1] }; });
        var vs = fut.map(function (o) { return o.v; });
        var flat = vs.length > 1 && (Math.max.apply(null, vs) - Math.min.apply(null, vs)) /
          (vs.reduce(function (a, b) { return a + b; }, 0) / vs.length) < 0.01;
        var keep = (!flat || fut.length <= 2) ? fut : [fut[0], fut[fut.length - 1]];

        keep.forEach(function (o) {
          labels.push({ pri: pri, x: o.p[0], y: o.p[1], text: fmtPrice(o.v), color: c.text });
        });

        if (opts.showCal && r.pretrained.cal != null) {
          var endP50 = p50[p50.length - 1];
          if (Math.abs(r.pretrained.cal - endP50) / endP50 > 0.004) {
            var tx2 = X(parseDate(ds[ds.length - 1]).getTime());
            labels.push({ pri: 2, x: tx2, y: Y(r.pretrained.cal), text: fmtPrice(r.pretrained.cal), color: c.text });
          }
        }
      }

      // ---- 带顶点：不写字，生成悬停热区 ----
      if (opts.showBand) {
        for (var k2 = 1; k2 < ds.length; k2++) {
          var bx = X(parseDate(ds[k2]).getTime());
          hits.push({ x: bx, y: Y(r.pretrained.p90[k2]), v: r.pretrained.p90[k2],
            edge: 'p90', date: ds[k2], run: r.id, color: c.line });
          hits.push({ x: bx, y: Y(r.pretrained.p10[k2]), v: r.pretrained.p10[k2],
            edge: 'p10', date: ds[k2], run: r.id, color: c.line });
        }
      }
    });

    // ---- 3) 实际收盘线 ----
    if (actShow.length > 1) {
      out.push('<polyline points="' + actShow.map(function (p) {
        return X(p[0].getTime()).toFixed(1) + ',' + Y(p[1]).toFixed(1);
      }).join(' ') + '" fill="none" stroke="' + T.actual + '" stroke-width="3" ' +
        'stroke-linejoin="round" stroke-linecap="round"/>');
    }

    // ---- 4) 已兑现的真实收盘红点 ----
    var seen = {};
    visible.forEach(function (r) {
      r.realized.forEach(function (z) {
        var t = parseDate(z.date).getTime();
        if (seen[t]) return;
        seen[t] = 1;
        var x = X(t), y = Y(z.close);
        out.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="5.4" fill="' + T.realized + '" ' +
          'stroke="' + T.bg + '" stroke-width="2"/>');
        if (opts.showLabels) {
          labels.push({ pri: 0, x: x, y: y, text: fmtPrice(z.close), color: T.realizedText });
        }
      });
    });

    // ---- 5) 标签避让放置 ----
    var placed = [];
    var measure = (function () {
      var cv = document.createElement('canvas').getContext('2d');
      return function (txt, size) {
        cv.font = '600 ' + size + 'px -apple-system,Segoe UI,PingFang SC,Microsoft YaHei,sans-serif';
        return cv.measureText(txt).width;
      };
    })();

    function fits(b) {
      if (b[0] < PAD_L + 1 || b[2] > W - PAD_R - 2) return false;
      if (b[1] < PAD_T - 12 || b[3] > H - PAD_B - 1) return false;
      for (var i2 = 0; i2 < placed.length; i2++) {
        var q = placed[i2];
        if (!(b[2] + 2 < q[0] || b[0] > q[2] + 2 || b[3] + 2 < q[1] || b[1] > q[3] + 2)) return false;
      }
      return true;
    }

    labels.sort(function (a, b) { return a.pri - b.pri; });

    labels.forEach(function (L) {
      var tw = measure(L.text, FS);
      var th = FS + 2;
      var cands = [
        [7, -7], [7, 5], [-7 - tw, -7], [-7 - tw, 5],
        [0, -20], [0, 12], [-tw / 2, -20], [-tw / 2, 12],
        [7, -20], [-7 - tw, -20], [7, 14], [-7 - tw, 14],
        [7, -33], [-7 - tw, -33], [7, 24], [-7 - tw, 24]
      ];
      for (var ci = 0; ci < cands.length; ci++) {
        var dx = cands[ci][0], dy = cands[ci][1];
        var box = [L.x + dx, L.y + dy, L.x + dx + tw, L.y + dy + th];
        if (fits(box)) {
          out.push('<text x="' + (L.x + dx).toFixed(1) + '" y="' + (L.y + dy + FS - 1).toFixed(1) + '" ' +
            'font-size="' + FS + '" font-weight="600" fill="' + L.color + '" ' +
            'stroke="' + T.labelStroke + '" stroke-width="3" stroke-linejoin="round" ' +
            'style="paint-order:stroke">' + esc(L.text) + '</text>');
          placed.push(box);
          break;
        }
      }
    });

    // ---- 6) 带顶点悬停热区（透明，放最后保证最容易命中）----
    hits.forEach(function (h) {
      out.push('<circle class="bandpt" cx="' + h.x.toFixed(1) + '" cy="' + h.y.toFixed(1) + '" ' +
        'r="8" fill="transparent" pointer-events="all" style="cursor:crosshair" ' +
        'data-run="' + h.run + '" data-edge="' + h.edge + '" data-date="' + h.date + '" ' +
        'data-v="' + h.v + '" data-color="' + h.color + '"/>');
    });
    // 悬停高亮环（app.js 控制半径）
    out.push('<circle id="hoverRing" cx="0" cy="0" r="0" fill="none" stroke-width="2.4" pointer-events="none"/>');

    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('font-family', '-apple-system,BlinkMacSystemFont,Segoe UI,PingFang SC,Microsoft YaHei,sans-serif');
    svg.innerHTML = out.join('');

    return {
      runs: visible,
      theme: T,
      geom: { W: W, H: H, PAD_L: PAD_L, PAD_R: PAD_R, PAD_T: PAD_T, PAD_B: PAD_B,
              xmin: xmin, xmax: xmax, ymin: ymin, ymax: ymax, X: X, Y: Y }
    };
  }

  global.KChart = {
    render: render,
    renderLegend: renderLegend,
    theme: theme,
    PALETTE: PALETTE,
    fmtPrice: fmtPrice,
    fmtPct: fmtPct,
    parseDate: parseDate,
    fmtMD: fmtMD,
    fmtMDHM: fmtMDHM
  };
})(window);
