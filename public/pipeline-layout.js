// XPM pipeline layout: where every card and line goes. Pure functions, no DOM, so Node can test them.
// Loaded by pipeline.html before pipeline.js (as window.XPMLayout) and by tests/layout.test.js (as a module).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.XPMLayout = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const COL = 248, NODE_W = 144, NODE_H = 80, ROW = 160, LEFT = 40, TOP = 88;
  // Wrapped layout: each lane is a row. X0 leaves a gutter on the left for lines that drop into a row's first card.
  const X0 = 72, HEAD = 48, FOOT = 16, GAP = 44, WRAP_ROW = 104, STUB = 28;
  const n1 = (v) => Math.round(v * 10) / 10;

  // The lens: fold every lane that is not open into one card, so a long pipeline reads at a glance.
  function foldLanes(p, open) {
    const fold = new Set((p.lanes || []).filter((l) => !open.has(l) && p.nodes.filter((n) => n.lane === l).length > 1));
    if (!fold.size) return p;
    const to = new Map(), nodes = [], cards = new Map();
    for (const n of p.nodes) {
      if (!fold.has(n.lane)) { to.set(n.id, n.id); nodes.push(n); continue; }
      const id = `lane:${n.lane}`;
      to.set(n.id, id);
      if (!cards.has(id)) { const c = { id, name: n.lane, kind: "lane", lane: n.lane, members: [] }; cards.set(id, c); nodes.push(c); }
      cards.get(id).members.push(n.id);
    }
    const edges = [], seen = new Map();
    for (const e of p.edges || []) {
      const a = to.get(e.from), b = to.get(e.to);
      if (!a || !b || a === b) continue;
      const key = `${a}->${b}`;
      // A condition only stays when its own step is still drawn and it is the only link to that card.
      if (seen.has(key)) { delete seen.get(key).when; continue; }
      const v = a === e.from && e.when ? { from: a, to: b, when: e.when } : { from: a, to: b };
      seen.set(key, v);
      edges.push(v);
    }
    return { ...p, nodes, edges, entry: to.get(p.entry) };
  }

  // A line between two cards in the same row or band: straight, or one soft bend in the last gap.
  function edgePath(a, b) {
    const sx = a.x + NODE_W, sy = a.y + NODE_H / 2, tx = b.x, ty = b.y + NODE_H / 2;
    if (tx <= sx) {
      const dy = Math.max(sy, ty) + NODE_H;
      return { d: `M${sx} ${sy} C${sx + 60} ${dy} ${tx - 60} ${dy} ${tx} ${ty}`, cx: (sx + tx) / 2, cy: dy - 20 };
    }
    if (sy === ty) return { d: `M${sx} ${sy} L${tx} ${ty}`, cx: (sx + tx) / 2, cy: sy };
    // Long edges run level, then bend in the last gap, so they do not cut through cards on the way.
    const bx = tx - (COL - NODE_W);
    const mx = (Math.max(sx, bx) + tx) / 2;
    const lead = bx > sx ? ` L${bx} ${sy}` : "";
    return { d: `M${sx} ${sy}${lead} C${mx} ${sy} ${mx} ${ty} ${tx} ${ty}`, cx: mx, cy: (sy + ty) / 2 };
  }

  // Straight segments with rounded corners.
  function roundedPath(points, r = 8) {
    const P = points.filter((pt, i) => i === 0 || pt[0] !== points[i - 1][0] || pt[1] !== points[i - 1][1]);
    let d = `M${n1(P[0][0])} ${n1(P[0][1])}`;
    for (let i = 1; i < P.length - 1; i++) {
      const [x0, y0] = P[i - 1], [x, y] = P[i], [x2, y2] = P[i + 1];
      const l1 = Math.hypot(x - x0, y - y0), l2 = Math.hypot(x2 - x, y2 - y);
      const k = Math.min(r, l1 / 2, l2 / 2);
      d += ` L${n1(x - ((x - x0) / l1) * k)} ${n1(y - ((y - y0) / l1) * k)} Q${n1(x)} ${n1(y)} ${n1(x + ((x2 - x) / l2) * k)} ${n1(y + ((y2 - y) / l2) * k)}`;
    }
    const last = P[P.length - 1];
    return `${d} L${n1(last[0])} ${n1(last[1])}`;
  }

  /**
   * A line from one row to another, like a line wrap: out of the card, along the channel between the rows,
   * then into the target from its left. Every upright part runs in a gap between columns (or the left gutter),
   * so it never crosses a card. `lift` moves the level part inside the channel, `lead` the first upright part
   * and `shift` the last one, so lines from or to different cards do not lie on top of each other. `nth` staggers the labels of
   * several lines that leave the same card.
   */
  function wrapPath(a, b, A, B, { lift = 0, shift = 0, lead = 0, nth = 0 } = {}) {
    const sx = a.x + NODE_W, sy = a.y + NODE_H / 2, tx = b.x, ty = b.y + NODE_H / 2;
    const cy = (B.top > A.top ? A.top + A.height + GAP / 2 : A.top - GAP / 2) + lift;
    const x1 = sx + STUB + lead, x2 = tx - STUB + shift;
    const d = roundedPath([[sx, sy], [x1, sy], [x1, cy], [x2, cy], [x2, ty], [tx, ty]]);
    const run = x2 - x1;
    return { d, cx: x1 + Math.sign(run) * Math.min(64 + nth * 120, Math.abs(run) / 2), cy };
  }

  /**
   * A line inside a row. When the level run of a long line would pass behind other cards, it steps under them
   * (or over, when under is taken) and comes up in the gap before its target.
   */
  function rowPath(a, b, others) {
    const sx = a.x + NODE_W, sy = a.y + NODE_H / 2, tx = b.x, ty = b.y + NODE_H / 2;
    const bx = tx - (COL - NODE_W);
    const hit = (y, xa, xb) => others.filter((c) => c.y - 6 < y && y < c.y + NODE_H + 6 && c.x < xb && c.x + NODE_W > xa);
    const blocked = bx > sx ? hit(sy, sx, bx) : [];
    if (!blocked.length) return edgePath(a, b);
    const x1 = sx + STUB, x2 = tx - STUB;
    const under = Math.max(...blocked.map((c) => c.y + NODE_H)) + 14, over = Math.min(...blocked.map((c) => c.y)) - 14;
    const cy = !hit(under, x1, x2).length ? under : !hit(over, x1, x2).length ? over : under;
    return { d: roundedPath([[sx, sy], [x1, sy], [x1, cy], [x2, cy], [x2, ty], [tx, ty]]), cx: x1 + Math.min(64, (x2 - x1) / 2), cy };
  }

  // Spread n things around a centre line, at most `room` wide in total.
  const spread = (i, n, room, step = 8) => (n < 2 ? 0 : (i - (n - 1) / 2) * Math.min(step, room / (n - 1)));

  // Rows inside a set of cards: each column sorted by its parents' rows, then spread so cards never overlap.
  function assignRows(ids, col, preds, order, pitch) {
    const y = new Map();
    const inSet = new Set(ids);
    const cols = [...new Set(ids.map((id) => col.get(id)))].sort((a, b) => a - b);
    for (const c of cols) {
      const here = ids.filter((id) => col.get(id) === c);
      const ideal = here.map((id) => {
        const ps = preds.get(id).filter((pr) => inSet.has(pr.id) && y.has(pr.id));
        const k = ps.length ? Math.min(...ps.map((pr) => pr.i)) : order.get(id);
        return { id, want: ps.length ? ps.reduce((s, pr) => s + y.get(pr.id), 0) / ps.length : 0, k };
      });
      // siblings fan out around their parent in edge order
      const groups = new Map();
      for (const it of ideal) { const g = groups.get(it.want) || []; g.push(it); groups.set(it.want, g); }
      for (const g of groups.values()) g.sort((a, b) => a.k - b.k).forEach((it, i) => { it.want += (i - (g.length - 1) / 2) * pitch; });
      ideal.sort((a, b) => a.want - b.want || a.k - b.k);
      let last = -Infinity;
      const placed = ideal.map((it) => { const v = Math.max(it.want, last + pitch); last = v; return { id: it.id, v, want: it.want }; });
      const drift = placed.reduce((s, it) => s + (it.v - it.want), 0) / (placed.length || 1);
      placed.forEach((it) => y.set(it.id, it.v - drift));
    }
    return y;
  }

  /**
   * Columns by longest path, lanes kept in order, rows by the parents' height.
   * Short pipelines: lanes side by side. When that would be wider than `wrapAt` pixels the lanes wrap like words
   * in a paragraph: a lane starts a new row when it no longer fits beside the one before it, and the widest lane
   * sets the row width. So a long chain reads left to right, top to bottom, instead of as one strip.
   * Returns xy (id -> top left), width, height, bands (one box per lane), routes ("from->to" -> line and label spot).
   */
  function layout(p, { wrapAt = Infinity } = {}) {
    const list = Array.isArray(p.nodes) ? p.nodes : [];
    const nodes = list.map((n) => n.id);
    if (!nodes.length) return { xy: new Map(), width: LEFT * 2 + NODE_W, height: TOP + NODE_H + 48, bands: [], routes: new Map(), wrapped: false, rows: 0 };
    const byId = new Map(list.map((n) => [n.id, n]));
    const lanes = Array.isArray(p.lanes) && p.lanes.length ? p.lanes : [];
    const laneOf = (id) => Math.max(0, lanes.indexOf(byId.get(id)?.lane));
    const edges = (p.edges || []).filter((e) => byId.has(e.from) && byId.has(e.to));
    const preds = new Map(nodes.map((id) => [id, []]));
    const succ = new Map(nodes.map((id) => [id, []]));
    edges.forEach((e, i) => { preds.get(e.to).push({ id: e.from, i }); succ.get(e.from).push({ id: e.to, i }); });

    // topological order (Kahn); nodes left in a cycle keep declaration order
    const indeg = new Map(nodes.map((id) => [id, 0]));
    edges.forEach((e) => indeg.set(e.to, indeg.get(e.to) + 1));
    const order = [];
    const done = new Set();
    const q = nodes.filter((id) => indeg.get(id) === 0);
    while (q.length) {
      const id = q.shift();
      order.push(id); done.add(id);
      for (const s of succ.get(id)) { indeg.set(s.id, indeg.get(s.id) - 1); if (indeg.get(s.id) === 0) q.push(s.id); }
    }
    for (const id of nodes) if (!done.has(id)) order.push(id);
    const pos = new Map(order.map((id, i) => [id, i]));
    const forward = (from, to) => pos.get(from) < pos.get(to);

    const col = new Map(nodes.map((id) => [id, 0]));
    for (let pass = 0; pass < nodes.length + 2; pass++) {
      let moved = false;
      for (const id of order) {
        for (const pr of preds.get(id)) {
          if (!forward(pr.id, id) || laneOf(pr.id) > laneOf(id)) continue;
          if (col.get(id) < col.get(pr.id) + 1) { col.set(id, col.get(pr.id) + 1); moved = true; }
        }
      }
      let prevMax = -1;
      for (let l = 0; l < Math.max(1, lanes.length); l++) {
        const inLane = nodes.filter((id) => laneOf(id) === l);
        if (!inLane.length) continue;
        for (const id of inLane) if (col.get(id) < prevMax + 1) { col.set(id, prevMax + 1); moved = true; }
        prevMax = Math.max(...inLane.map((id) => col.get(id)));
      }
      if (!moved) break;
    }

    // One group per lane that has cards, in lane order.
    const groups = [];
    for (let l = 0; l < Math.max(1, lanes.length); l++) {
      const ids = order.filter((id) => laneOf(id) === l);
      if (!ids.length) continue;
      const cols = ids.map((id) => col.get(id));
      groups.push({ name: lanes[l], ids, min: Math.min(...cols), max: Math.max(...cols) });
    }
    const maxCol = Math.max(...col.values());
    const wrapped = groups.length > 1 && LEFT + maxCol * COL + NODE_W + LEFT > wrapAt;

    // Rows of lanes. Not wrapped: one row with every lane in it.
    let rows = [groups];
    if (wrapped) {
      const cap = Math.max(...groups.map((g) => g.max - g.min + 1));
      rows = [];
      for (const g of groups) {
        const row = rows[rows.length - 1];
        if (row && g.max - row[0].min + 1 <= cap) row.push(g);
        else rows.push([g]);
      }
    }

    const x0 = wrapped ? X0 : LEFT;
    const pitch = wrapped ? WRAP_ROW : ROW;
    const xy = new Map();
    const rowOf = new Map();
    const bands = [];
    let top = 16, span = 0;
    const boxes = rows.map((row, r) => {
      const ids = row.flatMap((g) => g.ids).sort((a, b) => pos.get(a) - pos.get(b));
      // Heights inside a row follow only that row's own links, so a chain stays level after a wrap.
      const y = assignRows(ids, col, preds, pos, pitch);
      const minY = Math.min(...y.values()), minCol = row[0].min;
      const head = wrapped ? HEAD : TOP - 16;
      for (const id of ids) { xy.set(id, { x: x0 + (col.get(id) - minCol) * COL, y: top + head + y.get(id) - minY }); rowOf.set(id, r); }
      span = Math.max(span, row[row.length - 1].max - minCol);
      const box = { top, height: head + Math.max(...y.values()) - minY + NODE_H + (wrapped ? FOOT : 32) };
      if (lanes.length) for (const g of row) {
        const left = x0 + (g.min - minCol) * COL - 16;
        bands.push({ name: g.name, left, top, width: (g.max - g.min) * COL + NODE_W + 32, height: box.height, ids: g.ids });
      }
      top += box.height + GAP;
      return box;
    });
    const width = x0 + span * COL + NODE_W + LEFT;
    const height = top - GAP + 16;

    // Lines. Inside a row: the plain line. Between rows: the wrap line, each target with its own track.
    const routes = new Map();
    const wraps = [];
    for (const e of edges) {
      const key = `${e.from}->${e.to}`;
      if (routes.has(key)) continue;
      const ra = rowOf.get(e.from), rb = rowOf.get(e.to);
      if (ra === rb) routes.set(key, rowPath(xy.get(e.from), xy.get(e.to), nodes.filter((id) => id !== e.from && id !== e.to).map((id) => xy.get(id))));
      else { routes.set(key, null); wraps.push({ key, e, ra, rb, channel: rb > ra ? ra : ra - 1 }); }
    }
    // Lines that share a stretch get one track per card they belong to; lines to (or from) the same card may merge.
    const tracks = (keyOf, end) => {
      const by = new Map();
      for (const w of wraps) { const k = keyOf(w); if (!by.has(k)) by.set(k, []); if (!by.get(k).includes(w.e[end])) by.get(k).push(w.e[end]); }
      return (w) => { const t = by.get(keyOf(w)); return [t.indexOf(w.e[end]), t.length]; };
    };
    const inChannel = tracks((w) => w.channel, "to");
    const inGutter = tracks((w) => xy.get(w.e.to).x, "to");
    const outGap = tracks((w) => `${w.ra}:${xy.get(w.e.from).x}`, "from");
    const leaving = new Map();
    for (const w of wraps) {
      const nth = leaving.get(w.e.from) || 0;
      leaving.set(w.e.from, nth + 1);
      const [ci, cn] = inChannel(w), [gi, gn] = inGutter(w), [oi, on] = outGap(w);
      routes.set(w.key, wrapPath(xy.get(w.e.from), xy.get(w.e.to), boxes[w.ra], boxes[w.rb], { lift: spread(ci, cn, GAP - 16), shift: spread(gi, gn, 20), lead: spread(oi, on, 20), nth }));
    }
    return { xy, width, height, bands, routes, wrapped, rows: rows.length };
  }

  return { COL, NODE_W, NODE_H, ROW, WRAP_ROW, GAP, foldLanes, layout, edgePath, rowPath, wrapPath };
});
