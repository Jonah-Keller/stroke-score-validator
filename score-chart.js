/* Probability chart + "out of 100" counselling view for calculator.html and captan.html.
   Local file, no dependencies, no network. It draws only what the page already defines:
   - the curve comes from the page's own pGood(score) (the function the result card uses);
   - the score range comes from the page's POINTS and each input's min/max or option values;
   - the observed markers are read from the page's #bands table (exact table percentages).
   Colours come from site.css tokens via classes. */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var W = 400, H = 252, M = { l: 40, r: 12, t: 26, b: 38 };
  var PW = W - M.l - M.r, PH = H - M.t - M.b;
  var cfg, dom = {}, x0, x1;

  function el(tag, attrs, parent, text) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function sx(s) { return M.l + (s - x0) / (x1 - x0) * PW; }
  function sy(p) { return M.t + (1 - p) * PH; }
  function r1(v) { return Math.round(v * 10) / 10; }

  // Achievable score range from the inputs themselves.
  function domain() {
    var lo = 0, hi = 0;
    cfg.ids.forEach(function (id) {
      var e = document.getElementById(id), vals;
      if (e.tagName === "SELECT") vals = [].map.call(e.options, function (o) { return parseFloat(o.value); });
      else vals = [parseFloat(e.min), parseFloat(e.max)];
      var a = cfg.points[id] * Math.min.apply(null, vals), b = cfg.points[id] * Math.max.apply(null, vals);
      lo += Math.min(a, b); hi += Math.max(a, b);
    });
    return [lo, hi];
  }

  function complete() {
    return cfg.ids.every(function (id) {
      var e = document.getElementById(id);
      return e.tagName === "SELECT" || (e.value.trim() !== "" && !isNaN(parseFloat(e.value)));
    });
  }

  // Observed good-outcome % per band and cohort, read from the page's table.
  function observed() {
    var table = document.getElementById("bands");
    var heads = [].slice.call(table.querySelectorAll("thead th")).slice(2).map(function (th) {
      return th.firstChild.nodeValue.trim();
    });
    var series = heads.map(function (h) { return { name: h, pts: [] }; });
    [].forEach.call(table.querySelectorAll("tbody tr"), function (tr) {
      var lo = +tr.getAttribute("data-lo"), hi = +tr.getAttribute("data-hi");
      // open-ended bands are placed just beyond their edge
      var mid = lo <= -999 ? hi - 5 : hi >= 999 ? lo + 5 : (lo + hi) / 2;
      var cells = tr.querySelectorAll("td");
      series.forEach(function (s, i) {
        var m = /^(\d+)%/.exec(cells[i + 2].textContent.trim());
        if (m) s.pts.push({ x: mid, pct: +m[1], band: cells[0].textContent.trim() });
      });
    });
    return series;
  }

  function marker(shape, cx, cy, cls, parent) {
    var s = 3.6;
    if (shape === 0) return el("circle", { cx: r1(cx), cy: r1(cy), r: s, "class": cls }, parent);
    if (shape === 1) return el("rect", { x: r1(cx - s), y: r1(cy - s), width: 2 * s, height: 2 * s, "class": cls }, parent);
    return el("path", { d: "M" + r1(cx) + " " + r1(cy - s - 0.8) + "L" + r1(cx + s + 0.6) + " " + r1(cy + s - 0.4) + "L" + r1(cx - s - 0.6) + " " + r1(cy + s - 0.4) + "Z", "class": cls }, parent);
  }

  function legendSwatch(shape, cls) {
    var svg = el("svg", { viewBox: "0 0 14 14", width: 14, height: 14, "aria-hidden": "true" });
    if (shape === "line") el("line", { x1: 0, y1: 7, x2: 14, y2: 7, "class": "ch-curve" }, svg);
    else marker(shape, 7, 7, cls, svg);
    return svg;
  }

  function buildChart() {
    var host = document.getElementById("chart");
    var series = observed();
    host.setAttribute("data-state", "empty");

    var legend = document.createElement("ul");
    legend.className = "chart-legend";
    var li = document.createElement("li");
    li.appendChild(legendSwatch("line"));
    li.appendChild(document.createTextNode("Predicted (calibrated)"));
    legend.appendChild(li);
    series.forEach(function (s, i) {
      var l = document.createElement("li");
      l.appendChild(legendSwatch(i, "ch-obs ch-obs-" + i));
      l.appendChild(document.createTextNode(s.name + " (observed)"));
      legend.appendChild(l);
    });
    host.appendChild(legend);

    var box = document.createElement("div");
    box.className = "chart-box";
    host.appendChild(box);
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "class": "chart-svg", "data-x0": x0, "data-x1": x1 }, box);
    dom.svg = svg;
    dom.title = el("title", {}, svg, "");

    // higher-risk side
    el("rect", { x: r1(sx(cfg.thr)), y: M.t, width: r1(M.l + PW - sx(cfg.thr)), height: PH, "class": "ch-risk" }, svg);

    // y grid + labels
    [0, 0.25, 0.5, 0.75, 1].forEach(function (p) {
      el("line", { x1: M.l, x2: M.l + PW, y1: sy(p), y2: sy(p), "class": p === 0 ? "ch-axis-line" : "ch-grid" }, svg);
      el("text", { x: M.l - 6, y: sy(p) + 4, "text-anchor": "end", "class": "ch-tick" }, svg, Math.round(p * 100) + "%");
    });
    // x ticks
    var range = x1 - x0, step = [10, 20, 25, 50, 100].filter(function (s) { return range / s <= 8; })[0];
    for (var t = Math.ceil(x0 / step) * step; t <= x1; t += step) {
      el("line", { x1: sx(t), x2: sx(t), y1: M.t + PH, y2: M.t + PH + 4, "class": "ch-axis-line" }, svg);
      el("text", { x: sx(t), y: M.t + PH + 17, "text-anchor": "middle", "class": "ch-tick" }, svg, String(t));
    }
    el("text", { x: M.l + PW / 2, y: H - 4, "text-anchor": "middle", "class": "ch-axis-title" }, svg, cfg.name + " score");
    el("text", { x: M.l - 34, y: 12, "class": "ch-axis-title" }, svg, "Good outcome (mRS 0–2)");

    // threshold
    var tx = sx(cfg.thr);
    el("line", { x1: tx, x2: tx, y1: M.t, y2: M.t + PH, "class": "ch-thr", "data-score": cfg.thr }, svg);
    var far = tx > M.l + PW * 0.65;
    el("text", { x: far ? tx - 5 : tx + 5, y: M.t + 11, "text-anchor": far ? "end" : "start", "class": "ch-thr-label" }, svg,
      "higher-risk threshold (≥ " + cfg.thr + ")");

    // observed markers (small horizontal dodge per cohort so they don't overlap)
    var g = el("g", { "class": "ch-observed" }, svg);
    series.forEach(function (s, i) {
      var dx = (i - (series.length - 1) / 2) * 4;
      s.pts.forEach(function (pt) {
        var m = marker(i, sx(pt.x) + dx, sy(pt.pct / 100), "ch-obs ch-obs-" + i, g);
        el("title", {}, m, s.name + ", score " + pt.band + ": " + pt.pct + "% observed");
      });
    });

    // predicted curve from the page's own pGood()
    var d = "";
    for (var k = 0; k <= 200; k++) {
      var sc = x0 + (x1 - x0) * k / 200;
      d += (k ? "L" : "M") + r1(sx(sc)) + " " + r1(sy(cfg.pGood(sc)));
    }
    el("path", { d: d, "class": "ch-curve" }, svg);

    // patient layer
    var pg = el("g", { "class": "ch-patient" }, svg);
    dom.gv = el("line", { "class": "ch-guide" }, pg);
    dom.gh = el("line", { "class": "ch-guide" }, pg);
    dom.dot = el("circle", { r: 5.5, "class": "ch-dot" }, pg);
    dom.label = el("text", { "class": "ch-label", "data-role": "patient-label" }, pg, "");

    var empty = document.createElement("p");
    empty.className = "chart-empty";
    empty.textContent = "Enter a value for every field to see this patient on the chart.";
    box.appendChild(empty);

    var cap = document.createElement("p");
    cap.className = "note chart-caption";
    cap.textContent = "Curve: predicted probability of good outcome from the calibrated equation used for the result above. " +
      "Markers: observed share reaching mRS 0–2 in each score band, by cohort, exactly as in the table below " +
      "(plotted at the band midpoint; open-ended bands just beyond their edge). Shaded: the higher-risk side of the published cutoff.";
    host.appendChild(cap);
    dom.host = host;
  }

  function buildCounsel() {
    var host = document.getElementById("counsel");
    host.setAttribute("data-state", "empty");
    var p = document.createElement("p");
    p.className = "counsel-text";
    host.appendChild(p);
    dom.counselText = p;
    var svg = el("svg", { viewBox: "0 0 280 70", role: "img", "class": "icon-array" }, host);
    dom.iconTitle = el("title", {}, svg, "");
    dom.icons = [];
    for (var i = 0; i < 100; i++) {
      var c = i % 20, r = Math.floor(i / 20);
      dom.icons.push(el("circle", { cx: 7 + c * 14, cy: 7 + r * 14, r: 5.2 }, svg));
    }
    var key = document.createElement("p");
    key.className = "icon-key";
    key.innerHTML = '<span class="k k-on" aria-hidden="true"></span>mRS 0–2 &nbsp; <span class="k k-off" aria-hidden="true"></span>mRS 3–6';
    host.appendChild(key);
    dom.counsel = host;
  }

  function update(score, pct) {
    if (!dom.host) return;
    var ok = complete();
    var state = ok ? "ready" : "empty";
    dom.host.setAttribute("data-state", state);
    dom.counsel.setAttribute("data-state", state);
    dom.svg.setAttribute("aria-hidden", ok ? "false" : "true");
    if (!ok) {
      dom.counselText.textContent = "Enter a value for every field to see the out-of-100 view.";
      dom.title.textContent = "";
      dom.label.textContent = "";
      return;
    }
    var s = Math.max(x0, Math.min(x1, score));
    var p = cfg.pGood(s), cx = sx(s), cy = sy(p);
    dom.dot.setAttribute("cx", r1(cx)); dom.dot.setAttribute("cy", r1(cy));
    dom.gv.setAttribute("x1", r1(cx)); dom.gv.setAttribute("x2", r1(cx)); dom.gv.setAttribute("y1", r1(cy)); dom.gv.setAttribute("y2", M.t + PH);
    dom.gh.setAttribute("x1", M.l); dom.gh.setAttribute("x2", r1(cx)); dom.gh.setAttribute("y1", r1(cy)); dom.gh.setAttribute("y2", r1(cy));
    var txt = "Score " + score + " → " + pct + "%";
    var right = cx > M.l + PW * 0.6, low = cy < M.t + 22;
    dom.label.setAttribute("x", r1(right ? cx - 9 : cx + 9));
    dom.label.setAttribute("y", r1(low ? cy + 18 : cy - 9));
    dom.label.setAttribute("text-anchor", right ? "end" : "start");
    dom.label.textContent = txt;
    var summary = "Predicted probability of good outcome (mRS 0–2) across " + cfg.name + " scores. This patient: score " + score +
      ", " + pct + "% predicted. Higher-risk threshold at " + cfg.thr + ".";
    dom.title.textContent = summary;
    dom.svg.setAttribute("aria-label", summary);

    dom.counselText.innerHTML = "Out of 100 similar patients, about <b>" + pct + "</b> would be functionally independent (mRS 0–2) at 90 days.";
    dom.iconTitle.textContent = pct + " of 100 icons filled: mRS 0–2 at 90 days.";
    for (var i = 0; i < 100; i++) dom.icons[i].setAttribute("class", i < pct ? "ic-on" : "ic-off");
  }

  window.ScoreChart = {
    init: function (c) {
      cfg = c;
      var d = domain(); x0 = d[0]; x1 = d[1];
      buildChart();
      buildCounsel();
    },
    update: update
  };
})();
