/* 宏观数据月历
 * 日期一律按北京时间 YYYY-MM-DD。美国数据官方用美东时间，跨天的数据已换算到北京日期。
 * 数据来自 data/macro.json（每日定时抓取）；加载失败时回退到内嵌 mock，保证页面始终可用。
 */
(function () {
  'use strict';

  // 北京时间"今天"（UTC+8），随真实日期滚动
  var TODAY = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);

  // 指标配色（分类）—— label 同时用于图例和格子上圆点上方的短标签
  var KIND = {
    FOMC:  { label: '利率',     color: '#6C44C8' },
    NFP:   { label: '非农',     color: '#00969E' },
    CPI:   { label: 'CPI',      color: '#C0392B' },
    PPI:   { label: 'PPI',      color: '#D9822B' },
    PCE:   { label: 'PCE',      color: '#E28010' },
    GDP:   { label: 'GDP',      color: '#1E6FD9' },
    ISM:   { label: 'ISM',      color: '#3F6FD0' },
    RETAIL:{ label: '零售',     color: '#5A7FD0' },
    CLAIM: { label: '失业金',   color: '#137A62' },
    MICH:  { label: '情绪',     color: '#7A3E9D' }
  };

  // —— mock 事件（设计稿用，接数据后由 data/macro.json 覆盖）——
  var MOCK = [
    { date:'2026-11-06', code:'NFP', name:'美国 10月非农就业', time_bj:'20:30', time_et:'08:30 ET', status:'released',
      actual:'+12.8万', forecast:'+11.5万', previous:'+22.3万' },
    { date:'2026-11-10', code:'CPI', name:'美国 10月 CPI 同比', time_bj:'21:30', time_et:'08:30 ET', status:'released',
      actual:'3.1%', forecast:'3.2%', previous:'3.2%' },
    { date:'2026-11-12', code:'PPI', name:'美国 10月 PPI 同比', time_bj:'21:30', time_et:'08:30 ET', status:'released',
      actual:'2.4%', forecast:'2.6%', previous:'2.8%' },
    { date:'2026-11-25', code:'PCE', name:'美国 10月核心 PCE 同比', time_bj:'21:30', time_et:'08:30 ET', status:'released',
      actual:'2.8%', forecast:'2.8%', previous:'2.9%' },
    { date:'2026-11-26', code:'GDP', name:'美国 Q3 GDP 年化修正值', time_bj:'21:30', time_et:'08:30 ET', status:'released',
      actual:'2.8%', forecast:'2.9%', previous:'3.0%' },
    { date:'2026-11-26', code:'CLAIM', name:'美国初请失业金人数', time_bj:'21:30', time_et:'08:30 ET', status:'released',
      actual:'21.9万', forecast:'22.5万', previous:'22.0万' },
    { date:'2026-11-27', code:'MICH', name:'密歇根消费者信心终值', time_bj:'23:00', time_et:'10:00 ET', status:'released',
      actual:'51.0', forecast:'50.5', previous:'50.5' },
    // —— 未来（北京 12 月）——
    { date:'2026-12-04', code:'NFP', name:'美国 11月非农就业', time_bj:'21:30', time_et:'08:30 ET', status:'scheduled',
      forecast:'+15万', previous:'+12.8万' },
    { date:'2026-12-10', code:'FOMC', name:'美联储 FOMC 利率决议', time_bj:'03:00', time_et:'12-09 14:00 ET', status:'scheduled',
      previous:'5.25%–5.50%',
      probabilities:[
        {label:'维持 5.25–5.50%', p:0.31},
        {label:'降息 25bp', p:0.64},
        {label:'降息 50bp', p:0.04},
        {label:'加息 25bp', p:0.01}
      ] },
    { date:'2026-12-10', code:'CPI', name:'美国 11月 CPI 同比', time_bj:'21:30', time_et:'08:30 ET', status:'scheduled',
      forecast:'3.0%', previous:'3.1%' },
    { date:'2026-12-11', code:'PPI', name:'美国 11月 PPI 同比', time_bj:'21:30', time_et:'08:30 ET', status:'scheduled',
      forecast:'2.3%', previous:'2.4%' },
    { date:'2026-12-23', code:'PCE', name:'美国 11月核心 PCE 同比', time_bj:'21:30', time_et:'08:30 ET', status:'scheduled',
      forecast:'2.7%', previous:'2.8%' },
    { date:'2026-12-23', code:'GDP', name:'美国 Q3 GDP 年化终值', time_bj:'21:30', time_et:'08:30 ET', status:'scheduled',
      forecast:'2.8%', previous:'2.8%' }
  ];

  var state = { data:null, year:0, month:0, selected:TODAY };

  function $(id) { return document.getElementById(id); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function ymd(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function parseYmd(s) { var p = s.split('-'); return { y:+p[0], m:(+p[1]) - 1, d:+p[2] }; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }

  // 规则生成利多利空：返回 bull/bear 文案 + 净方向
  function analyze(ev) {
    var code = ev.code;
    if (code === 'FOMC') {
      var probs = ev.probabilities || [];
      var cut = (probs.filter(function (p) { return /降息/.test(p.label); })
                      .reduce(function (a, p) { return a + p.p; }, 0));
      var hike = (probs.filter(function (p) { return /加息/.test(p.label); })
                       .reduce(function (a, p) { return a + p.p; }, 0));
      if (cut >= 0.5) return { dir:'bull', text:'市场定价偏向降息（合计 ' + (cut*100).toFixed(0) +
        '%）。美元与实际利率趋弱 → 利多黄金、加密；若最终不降息，预期差会反向打脸。' };
      if (hike >= 0.3) return { dir:'bear', text:'市场给了加息 ' + (hike*100).toFixed(0) +
        '% 的概率。美元与实际利率上行 → 利空黄金、加密。' };
      return { dir:'flat', text:'利率路径分歧大、以维持为主，方向性不强；重点看声明措辞与点阵图。' };
    }
    // 已公布：实际 vs 预期
    if (!ev.actual || !ev.forecast) return { dir:'flat', text:'暂无可对比的预期值，方向未定。' };
    var num = function (v) {
      if (v == null) return NaN;
      var m = String(v).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
      return m ? parseFloat(m[0]) : NaN;
    };
    var a = num(ev.actual), f = num(ev.forecast);
    if (isNaN(a) || isNaN(f) || a === f) return { dir:'flat', text:'实际值与预期一致（' +
      esc(ev.actual) + '），影响中性。' };
    var hot = a > f; // 高于预期
    var softBull = (code === 'CLAIM'); // 初请失业金越高=就业越差=利多黄金
    var bullish = softBull ? hot : !hot; // 对黄金/加密是利多还是利空
    var label = (KIND[code] || {}).label || ev.code;
    var hotWord = hot ? '超预期' : '不及预期';
    var text;
    if (bullish) {
      text = label + '实际 ' + esc(ev.actual) + '，' + hotWord + '（预期 ' + esc(ev.forecast) +
        '）。美元与实际利率走弱 → 利多黄金、加密。';
    } else {
      text = label + '实际 ' + esc(ev.actual) + '，' + hotWord + '（预期 ' + esc(ev.forecast) +
        '）。美元与实际利率走强 → 利空黄金、加密。';
    }
    return { dir: bullish ? 'bull' : 'bear', text:text };
  }

  function eventsOn(date) {
    return state.data.events.filter(function (e) { return e.date === date; });
  }

  function renderLegend() {
    var seen = {}, html = '';
    state.data.events.forEach(function (e) {
      var k = e.code; if (seen[k]) return; seen[k] = 1;
      var c = KIND[k] || { label:k, color:'#888' };
      html += '<span class="cal-lg"><i style="background:' + c.color + '"></i>' + esc(c.label) + '</span>';
    });
    $('calLegend').innerHTML = html;
  }

  function renderCalendar() {
    var y = state.year, m = state.month;
    $('monthLabel').textContent = y + ' 年 ' + (m + 1) + ' 月';
    var first = new Date(Date.UTC(y, m, 1)).getUTCDay(); // 0=周日
    var lead = (first + 6) % 7; // 周一开头
    var days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

    var html = '';
    ['周一','周二','周三','周四','周五','周六','周日'].forEach(function (w) {
      html += '<div class="cal-wd">' + w + '</div>';
    });
    for (var i = 0; i < lead; i++) html += '<div class="cal-cell blank"></div>';
    for (var d = 1; d <= days; d++) {
      var date = ymd(y, m, d);
      var evs = eventsOn(date);
      var cls = 'cal-cell';
      if (date === TODAY) cls += ' is-today';
      if (date === state.selected) cls += ' is-selected';
      if (date < TODAY) cls += ' is-past';
      var isWeekend = ((lead + d - 1) % 7) >= 5;
      if (isWeekend) cls += ' is-weekend';
      var dots = '';
      evs.forEach(function (e) {
        var c = KIND[e.code] || { color:'#888' };
        dots += '<i class="cal-dot" style="background:' + c.color + '" title="' + esc(e.name) + '"></i>';
      });
      // 中文短标签：靠格子右侧上下罗列，最多显示前 3 个；
      // 容器 title 带完整文字，鼠标悬停能看全（超出 3 个时第 3 行用 +N 提示）。
      var labels = evs.map(function (e) { return (KIND[e.code] || {}).label || e.code; });
      var tags = '';
      if (evs.length) {
        var shown = labels.slice(0, 3);
        if (labels.length > 3) shown[2] = shown[2] + ' +' + (labels.length - 3);
        tags = '<span class="cal-tags" title="' + esc(labels.join(' / ')) + '">' +
          shown.map(function (lb) { return '<span class="cal-tag">' + esc(lb) + '</span>'; }).join('') +
          '</span>';
      }
      html += '<div class="' + cls + '" role="gridcell" data-date="' + date + '" tabindex="0">' +
        '<span class="cal-num">' + d + '</span>' + tags +
        '<span class="cal-dots">' + dots + '</span>' +
        (evs.length ? '<span class="cal-badge" aria-hidden="true">双击看详情</span>' : '') +
        '</div>';
    }
    $('calGrid').innerHTML = html;

    Array.prototype.forEach.call($('calGrid').querySelectorAll('.cal-cell[data-date]'), function (cell) {
      cell.addEventListener('click', function () {
        state.selected = cell.getAttribute('data-date');
        renderCalendar(); renderDay();
      });
      cell.addEventListener('dblclick', function () {
        state.selected = cell.getAttribute('data-date');
        var evs = eventsOn(state.selected);
        if (evs.length) openModal(state.selected, evs);
      });
      cell.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          state.selected = cell.getAttribute('data-date');
          renderCalendar(); renderDay();
        }
      });
    });
  }

  function evRow(ev) {
    var c = KIND[ev.code] || { color:'#888', label:ev.code };
    var an = analyze(ev);
    var dirCls = an.dir === 'bull' ? 'dir-bull' : (an.dir === 'bear' ? 'dir-bear' : 'dir-flat');
    var dirTxt = an.dir === 'bull' ? '偏利多' : (an.dir === 'bear' ? '偏利空' : '中性');
    var status = ev.status === 'released'
      ? '<span class="st released">已公布</span>'
      : '<span class="st scheduled">待公布</span>';
    var head = '<div class="ev-head"><span class="ev-dot" style="background:' + c.color + '"></span>' +
      '<b>' + esc(ev.name) + '</b>' + status + '</div>';
    var meta = '<div class="ev-meta">' + esc(ev.date) + ' ' + esc(ev.time_bj || '') + '（北京） · ' +
      esc(ev.time_et || '') + '</div>';
    var body = '';
    if (ev.probabilities) {
      body += '<div class="prob-list">';
      ev.probabilities.forEach(function (p) {
        body += '<div class="prob-row"><span>' + esc(p.label) + '</span>' +
          '<span class="prob-bar"><i style="width:' + (p.p * 100).toFixed(1) + '%"></i></span>' +
          '<b>' + (p.p * 100).toFixed(0) + '%</b></div>';
      });
      body += '</div>';
    } else {
      body += '<div class="ev-nums">' +
        '<span>实际 <b>' + esc(ev.actual || '—') + '</b></span>' +
        '<span>预期 <b>' + esc(ev.forecast || '—') + '</b></span>' +
        '<span>前值 <b>' + esc(ev.previous || '—') + '</b></span>' +
        '</div>';
    }
    body += '<div class="ev-analysis ' + dirCls + '"><b>' + dirTxt + '</b> · ' + an.text + '</div>';
    return head + meta + body;
  }

  function renderDay() {
    var evs = eventsOn(state.selected);
    $('dayTitle').textContent = state.selected + ' 当天数据' + (evs.length ? '（' + evs.length + ' 条）' : '');
    if (!evs.length) {
      $('dayDetail').innerHTML = '<p class="dim">这一天没有安排数据。单击其它日期查看；双击带彩色圆点的日期看详情弹窗。</p>';
    } else {
      $('dayDetail').innerHTML = '<div class="ev-list">' + evs.map(evRow).join('') + '</div>';
    }
  }

  function openModal(date, evs) {
    $('modalTitle').textContent = date + ' · 数据详情';
    $('modalSub').textContent = '双击打开 · 北京时间口径 · 已公布=实际值 / 未来=预测值或概率';
    $('modalBody').innerHTML = '<div class="ev-list">' + evs.map(evRow).join('') + '</div>';
    $('modal').hidden = false;
  }
  function closeModal() { $('modal').hidden = true; }

  function bindControls() {
    $('prevMonth').addEventListener('click', function () {
      state.month--; if (state.month < 0) { state.month = 11; state.year--; }
      renderCalendar();
    });
    $('nextMonth').addEventListener('click', function () {
      state.month++; if (state.month > 11) { state.month = 0; state.year++; }
      renderCalendar();
    });
    $('todayBtn').addEventListener('click', function () {
      var tt = parseYmd(TODAY); state.year = tt.y; state.month = tt.m; state.selected = TODAY;
      renderCalendar(); renderDay();
    });
    $('modalClose').addEventListener('click', closeModal);
    $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  }

  function applyData(data) {
    state.data = data;
    var t = parseYmd(TODAY);
    state.year = t.y; state.month = t.m;
    var src = data.source ? (' · 来源：' + data.source) : '';
    $('meta').textContent = '重要美国宏观数据 · 默认显示当月 · 数据更新于 ' + data.generated_at + src;
    $('footerMeta').textContent = '月历按北京时间 · 单击选中、双击有数据的日子看详情 · ' +
      '预测值目前仅 FOMC 有利率概率，其余公布后回填 · ' + data.generated_at;
    renderLegend(); renderCalendar(); renderDay();
  }

  function boot() {
    bindControls();
    // 先渲染 mock，随后异步用真实数据覆盖；fetch 失败则保留 mock（离线不出空白）
    applyData({ generated_at:'设计稿示例数据', timezone:'北京', source:'示例', events:MOCK });
    fetch('data/macro.json?t=' + Date.now(), { cache:'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { if (d && d.events && d.events.length) applyData(d); })
      .catch(function (e) { console.warn('macro.json 加载失败，沿用示例数据：', e); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
