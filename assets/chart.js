/* Kronos 滚动预测图表引擎 —— 纯 SVG，无依赖
 *
 * 关键规则（与需求一致）：
 *   1. 每次预测一个颜色，3 色循环 —— 第 4 次预测用回第 1 次的颜色。
 *   2. P50 折线上的每个点、校准虚线的终点菱形、P10/P90 阴影带的每个顶点，都直接标价格；
 *      标注颜色 = 该次预测的颜色。
 *   3. X 轴刻度颜色跟随"覆盖该日的最新一次预测"，Y 轴跟随实际收盘色。
 */
(function (global) {
  'use strict';

  // 3 色循环：青绿 / 琥珀橙 / 紫罗兰（与截图方案一致，色相拉开）
  var PALETTE = [
    { line: '#00969E', text: '#00807F', light: '#5FC4C6', name: '青绿' },
    { line: '#E28010', text: '#B56400', light: '#F0AE5C', name: '琥珀橙' },
    { line: '#6C44C8', text: '#5734A8', light: '#A487E0', name: '紫罗兰' }
  ];
  var ACTUAL = '#20222A';

  var FS = 13;          // 标价字号
  var TICK_FS = 12.5;   // 坐标刻度字号

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function fmtPrice(v) {
    if (v == null || isNaN(v)) return '—';
    if (Math.abs(v) >= 1000) {
      return Math.round(v).toLocaleString('en-US');
    }
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
    // "2026-11-27 00:00:00" -> Date（当作本地时间，仅用于排序与插值）
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
    var html = '';
    html += '<span class="item"><span class="swatch" style="background:' + ACTUAL + '"></span>实际收盘</span>';
    html += '<span class="item"><span class="dot" style="background:' + ACTUAL + '"></span>实际收盘（历史）</span>';

    runs.forEach(function (r) {
      var c = r.color;
      html += '<span class="item"><span class="swatch" style="background:' + c.line + '"></span>' +
        esc(fmtMD(parseDate(r.anchor)) + ' 预测') +
        (r.isLatest ? ' <b style="color:' + c.text + '">最新</b>' : '') + '</span>';
    });

    html += '<span class="item"><span class="dot" style="background:#E63C32"></span>已兑现的真实收盘</span>';
    if (opts.showBand) {
      html += '<span class="item"><span class="band" style="background:rgba(120,130,150,.18)"></span>P10–P90 区间</span>';
    }
    if (opts.showCal) {
      html += '<span class="item" style="color:var(--text-3)">虚线菱形 = 校准终点</span>';
    }
    host.innerHTML = html;
  }

  /* ---------------- 主渲染 ---------------- */
  function render(svg, symData, opts) {
    var W = 1180, H = 620;
    var PAD_L = 78, PAD_R = 172, PAD_T = 26, PAD_B = 62;
    var pw = W - PAD_L - PAD_R;
    var ph = H - PAD_T - PAD_B;

    // 只画最近 N 次（默认 3），勾"显示全部"则全画
    var runs = symData.runs.slice();
    var visible = opts.showAll ? runs : runs.slice(-3);
    if (!visible.length) {
      svg.innerHTML = '<text x="20" y="40" font-size="14" fill="#8b93a3">还没有预测数据</text>';
      svg.setAttribute('viewBox', '0 0 600 120');
      return { runs: [] };
    }

    // 颜色：按"时间顺序的序号"取模 3 —— 第 4 次预测回到第 1 次的颜色
    // 序号用 run.index（1 起），这样即使只显示后 3 次，颜色也稳定不变
    var allSorted = runs.slice().sort(function (a, b) { return a.index - b.index; });
    allSorted.forEach(function (r, i) {
      r.color = PALETTE[i % PALETTE.length];
      r.colorSlot = i % PALETTE.length;
    });
    var latestIndex = allSorted[allSorted.length - 1].index;
    visible.forEach(function (r) { r.isLatest = (r.index === latestIndex); });

    // 实际收盘
    var actual = symData.actual.map(function (p) { return [parseDate(p[0]), p[1]]; });
    var actMap = {};
    actual.forEach(function (p) { actMap[p[0].getTime()] = p[1]; });

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
    out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" ' +
      'font-family="-apple-system,BlinkMacSystemFont,Segoe UI,PingFang SC,Microsoft YaHei,sans-serif" ' +
      'style="display:block;width:100%;height:auto">');

    // defs：每色一个渐变（带内更通透）
    out.push('<defs>');
    PALETTE.forEach(function (c, i) {
      out.push('<linearGradient id="g' + i + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="' + c.line + '" stop-opacity=".20"/>' +
        '<stop offset="100%" stop-color="' + c.line + '" stop-opacity=".10"/></linearGradient>');
    });
    out.push('</defs>');

    // ---- 网格 + Y 轴（价格轴 = 实际收盘色）----
    var gy = 5;
    for (var i = 0; i <= gy; i++) {
      var v = ymin + (ymax - ymin) * i / gy;
      var y = Y(v);
      out.push('<line x1="' + PAD_L + '" y1="' + y.toFixed(1) + '" x2="' + (W - PAD_R) +
        '" y2="' + y.toFixed(1) + '" stroke="currentColor" stroke-opacity=".10" stroke-width="1"/>');
      out.push('<text x="' + (PAD_L - 10) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" ' +
        'font-size="' + TICK_FS + '" fill="' + ACTUAL + '" fill-opacity=".72">' + fmtPriceShort(v) + '</text>');
    }

    // ---- X 轴刻度：颜色跟随覆盖该日的最新一次预测 ----
    function ownerColor(t) {
      var hit = ACTUAL;
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
      out.push('<text x="' + x.toFixed(1) + '" y="' + (H - PAD_B + 18) + '" text-anchor="middle" ' +
        'font-size="' + TICK_FS + '" fill="' + ownerColor(t) + '" fill-opacity=".8">' +
        fmtMDHM(dt) + '</text>');
    }

    // 轴下方色条：每次预测覆盖的日期段，同色
    visible.forEach(function (r) {
      var x1 = X(parseDate(r.anchor).getTime());
      var x2 = X(parseDate(r.dates[r.dates.length - 1]).getTime());
      out.push('<rect x="' + x1.toFixed(1) + '" y="' + (H - PAD_B + 25) + '" ' +
        'width="' + Math.max(1, x2 - x1).toFixed(1) + '" height="4" rx="2" fill="' + r.color.line + '"/>');
    });

    // 轴线
    out.push('<line x1="' + PAD_L + '" y1="' + (H - PAD_B) + '" x2="' + (W - PAD_R) + '" y2="' +
      (H - PAD_B) + '" stroke="currentColor" stroke-opacity=".22" stroke-width="1"/>');
    out.push('<line x1="' + PAD_L + '" y1="' + PAD_T + '" x2="' + PAD_L + '" y2="' + (H - PAD_B) +
      '" stroke="currentColor" stroke-opacity=".22" stroke-width="1"/>');

    // ---- 1) 所有阴影带先画（互不遮挡靠透明度）----
    if (opts.showBand) {
      visible.forEach(function (r) {
        var p90 = r.pretrained.p90, p10 = r.pretrained.p10, ds = r.dates;
        var up = [], dn = [];
        for (var k = 0; k < ds.length; k++) {
          up.push(X(parseDate(ds[k]).getTime()) + ',' + Y(p90[k]).toFixed(1));
          dn.push(X(parseDate(ds[k]).getTime()) + ',' + Y(p10[k]).toFixed(1));
        }
        out.push('<polygon points="' + up.concat(dn.reverse()).join(' ') +
          '" fill="url(#g' + r.colorSlot + ')" stroke="' + r.color.line +
          '" stroke-opacity=".28" stroke-width="1"/>');
      });
    }

    // ---- 2) 折线 + 点 + 虚线 + 菱形 ----
    var labels = [];   // {pri, x, y, text, color, anchor}

    visible.forEach(function (r) {
      var c = r.color, ds = r.dates, p50 = r.pretrained.p50;
      var pts = ds.map(function (s, k) {
        return [X(parseDate(s).getTime()), Y(p50[k])];
      });

      out.push('<polyline points="' + pts.map(function (p) {
        return p[0].toFixed(1) + ',' + p[1].toFixed(1);
      }).join(' ') + '" fill="none" stroke="' + c.line + '" stroke-width="2.6" ' +
        'stroke-linejoin="round" stroke-linecap="round"/>');

      // 锚点：空心圈（表示"这里就是当时最新收盘"）
      var ax = pts[0][0], ay = pts[0][1];
      out.push('<circle cx="' + ax.toFixed(1) + '" cy="' + ay.toFixed(1) + '" r="6" ' +
        'fill="#fff" stroke="' + c.line + '" stroke-width="2.2"/>');

      // 线上每个未来点：实心圆
      pts.slice(1).forEach(function (p) {
        out.push('<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.6" fill="' + c.line + '"/>');
      });

      // 校准虚线：从锚点到（最后一天, 校准值）
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
          'fill="#fff" stroke="' + c.line + '" stroke-width="2"/>');
      }

      // ---- 收集标签 ----
      if (opts.showLabels) {
        var pri = r.isLatest ? 1 : 3;
        // 走平段（极差 < 1%）只标首末，避免同一水平线堆满数字
        var fut = pts.slice(1).map(function (p, k) { return { p: p, v: p50[k + 1] }; });
        var vs = fut.map(function (o) { return o.v; });
        var flat = vs.length > 1 && (Math.max.apply(null, vs) - Math.min.apply(null, vs)) /
          (vs.reduce(function (a, b) { return a + b; }, 0) / vs.length) < 0.01;
        var keep = (!flat || fut.length <= 2) ? fut
          : [fut[0], fut[fut.length - 1]];

        keep.forEach(function (o) {
          labels.push({ pri: pri, x: o.p[0], y: o.p[1], text: fmtPrice(o.v), color: c.text, anchor: 'start' });
        });

        // 校准菱形：与折线末端几乎重合（<0.4%）就不重复标
        if (opts.showCal && r.pretrained.cal != null) {
          var endP50 = p50[p50.length - 1];
          if (Math.abs(r.pretrained.cal - endP50) / endP50 > 0.004) {
            var tx2 = X(parseDate(ds[ds.length - 1]).getTime());
            labels.push({ pri: 2, x: tx2, y: Y(r.pretrained.cal), text: fmtPrice(r.pretrained.cal),
              color: c.text, anchor: 'start' });
          }
        }

        // 带的上下沿顶点：全部日期都标
        if (opts.showBand) {
          var bandColor = r.isLatest ? c.text : c.light;
          for (var k2 = 1; k2 < ds.length; k2++) {
            var bx = X(parseDate(ds[k2]).getTime());
            labels.push({ pri: 5, x: bx, y: Y(r.pretrained.p90[k2]),
              text: fmtPrice(r.pretrained.p90[k2]), color: bandColor, anchor: 'start' });
            labels.push({ pri: 5, x: bx, y: Y(r.pretrained.p10[k2]),
              text: fmtPrice(r.pretrained.p10[k2]), color: bandColor, anchor: 'start' });
          }
        }
      }
    });

    // ---- 3) 实际收盘线 ----
    if (actShow.length > 1) {
      out.push('<polyline points="' + actShow.map(function (p) {
        return X(p[0].getTime()).toFixed(1) + ',' + Y(p[1]).toFixed(1);
      }).join(' ') + '" fill="none" stroke="' + ACTUAL + '" stroke-width="3" ' +
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
        out.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="5.4" fill="#E63C32" ' +
          'stroke="#fff" stroke-width="2"/>');
        if (opts.showLabels) {
          labels.push({ pri: 0, x: x, y: y, text: fmtPrice(z.close), color: '#C0392B', anchor: 'start' });
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
      if (b[1] < PAD_T + 1 || b[3] > H - PAD_B - 1) return false;
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
            'stroke="#fff" stroke-width="3" stroke-linejoin="round" paint-order="stroke" ' +
            'style="paint-order:stroke">' + esc(L.text) + '</text>');
          placed.push(box);
          break;
        }
      }
    });

    // ---- 6) 锚点数值（右上角提示本次锚点）----
    var latest = visible[visible.length - 1];
    out.push('</svg>');

    svg.innerHTML = out.join('');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    return {
      runs: visible,
      geom: { W: W, H: H, PAD_L: PAD_L, PAD_R: PAD_R, PAD_T: PAD_T, PAD_B: PAD_B,
              xmin: xmin, xmax: xmax, ymin: ymin, ymax: ymax, X: X, Y: Y }
    };
  }

  global.KChart = {
    render: render,
    renderLegend: renderLegend,
    PALETTE: PALETTE,
    fmtPrice: fmtPrice,
    fmtPct: fmtPct,
    parseDate: parseDate,
    fmtMD: fmtMD,
    fmtMDHM: fmtMDHM
  };
})(window);
