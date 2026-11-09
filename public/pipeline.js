// XPM pipeline view: Map, Runs, Draft. Plain JS, no dependencies, no build step.
// iPad and Apple Pencil: every control is a real <button>, scrolling is native, and there is
// no touchmove handler anywhere (a prevented touchmove cancels Pencil taps).
"use strict";

const COL = 248, NODE_W = 144, NODE_H = 80, ROW = 160, LEFT = 40, TOP = 88;
const ICONS = {
  door: "M9 2.5h4v11H9 M2 8h8 M7.5 5.5L10 8l-2.5 2.5",
  gate: "M2 3h12L9.5 8.5V13l-3-1.5v-3z",
  classifier: "M2.5 2.5h5.5l5.5 5.5l-5.5 5.5L2.5 8z M5.5 5.5h.01",
  mode: "M5 4.5h6a3.5 3.5 0 0 1 0 7H5a3.5 3.5 0 0 1 0-7z M11 6.5a1.5 1.5 0 1 1 0 3a1.5 1.5 0 0 1 0-3z",
  queue: "M3 4h10 M3 8h10 M3 12h6",
  model: "M4.5 4.5h7v7h-7z M6.5 2v2.5 M9.5 2v2.5 M6.5 11.5V14 M9.5 11.5V14 M2 6.5h2.5 M2 9.5h2.5 M11.5 6.5H14 M11.5 9.5H14",
  router: "M2 8h4.5 M6.5 8L12 3.5 M6.5 8L12 12.5 M9.5 3.5H12V6 M9.5 12.5H12V10",
  tool: "M3 4.5l3.5 3.5L3 11.5 M8 11.5h5",
  sender: "M2 7.5L14 2.5L9.5 14L7.5 9.5z M7.5 9.5L14 2.5",
  hook: "M8 2.5v6.5a3 3 0 1 1-3-3 M8 2.5l2 2",
  store: "M3 4.5c0-1.1 2.2-2 5-2s5 .9 5 2v7c0 1.1-2.2 2-5 2s-5-.9-5-2z M3 4.5c0 1.1 2.2 2 5 2s5-.9 5-2",
  unknown: "M8 2.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 0 1 0-11z M6.3 6.4a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1 M8 11.2h.01",
};

const S = {
  projects: [], project: null, pipelineId: null, manifestPipelines: [],
  data: null, loading: true, error: null, fetchedAt: 0,
  view: "map", menu: null, panelNode: null,
  filter: "all", picked: null, step: null, railOpen: true, changedIds: null,
  drafts: [], draft: null, draftSavedAt: null, result: null, resultOpen: false, replaying: false, replayError: null,
  zoom: null, userZoomed: false,
};

// ---------- helpers ----------
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ms = (v) => (v == null || !Number.isFinite(v) ? "" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const short = (id) => String(id).slice(0, 8);
const icon = (kind, size = 14) => `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[kind] || ICONS.unknown}"></path></svg>`;
const SVG = {
  chev: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#9a9aa0" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"></path></svg>',
  spin: '<svg class="spin" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="#3a3a40"></circle><path d="M8 2a6 6 0 0 1 6 6" stroke="#e7e7e9" stroke-linecap="round"></path></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"></path></svg>',
  minus: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M3.5 8h9"></path></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M3.5 8h9M8 3.5v9"></path></svg>',
  fit: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"></path></svg>',
  prev: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5"></path></svg>',
  next: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5"></path></svg>',
  down: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10"></path></svg>',
};

function ago(iso) {
  const s = Math.max(0, (Date.now() - (typeof iso === "number" ? iso : Date.parse(iso))) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
const agoWords = (t) => { const a = ago(t); return a === "now" ? "just now" : `${a.replace("m", " min").replace("h", " h").replace("d", " d")} ago`; };

function clock(sec) {
  if (!Number.isFinite(sec)) return "";
  const d = new Date(sec * 1000);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
}

const runMs = (r) => Math.max(0, Date.parse(r.endedAt) - Date.parse(r.startedAt));

// ---------- layout ----------
// Columns by longest path, lanes kept in order left to right, rows by the parents' height.
function layout(p) {
  const nodes = p.nodes.map((n) => n.id);
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
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
  const q = nodes.filter((id) => indeg.get(id) === 0);
  while (q.length) {
    const id = q.shift();
    order.push(id);
    for (const s of succ.get(id)) { indeg.set(s.id, indeg.get(s.id) - 1); if (indeg.get(s.id) === 0) q.push(s.id); }
  }
  for (const id of nodes) if (!order.includes(id)) order.push(id);
  const pos = new Map(order.map((id, i) => [id, i]));
  const forward = (e) => pos.get(e.from) < pos.get(e.to);

  const col = new Map(nodes.map((id) => [id, 0]));
  for (let pass = 0; pass < nodes.length + 2; pass++) {
    let moved = false;
    for (const id of order) {
      for (const pr of preds.get(id)) {
        if (!forward({ from: pr.id, to: id }) || laneOf(pr.id) > laneOf(id)) continue;
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

  // rows: each column sorted by the parents' rows, then spread so cards never overlap
  const y = new Map();
  const maxCol = Math.max(0, ...col.values());
  for (let c = 0; c <= maxCol; c++) {
    const here = order.filter((id) => col.get(id) === c);
    const ideal = here.map((id) => {
      const ps = preds.get(id).filter((pr) => y.has(pr.id));
      const k = ps.length ? Math.min(...ps.map((pr) => pr.i)) : order.indexOf(id);
      return { id, want: ps.length ? ps.reduce((s, pr) => s + y.get(pr.id), 0) / ps.length : 0, k };
    });
    // siblings fan out around their parent in edge order
    const groups = new Map();
    for (const it of ideal) { const g = groups.get(it.want) || []; g.push(it); groups.set(it.want, g); }
    for (const g of groups.values()) g.sort((a, b) => a.k - b.k).forEach((it, i) => { it.want += (i - (g.length - 1) / 2) * ROW; });
    ideal.sort((a, b) => a.want - b.want || a.k - b.k);
    let last = -Infinity;
    const placed = ideal.map((it) => { const v = Math.max(it.want, last + ROW); last = v; return { id: it.id, v, want: it.want }; });
    const drift = placed.reduce((s, it) => s + (it.v - it.want), 0) / (placed.length || 1);
    placed.forEach((it) => y.set(it.id, it.v - drift));
  }
  // the top card sits at TOP
  const top = Math.min(...y.values());
  const xy = new Map(nodes.map((id) => [id, { x: LEFT + col.get(id) * COL, y: TOP + y.get(id) - top }]));

  const all = [...xy.values()];
  const width = Math.max(...all.map((v) => v.x)) + NODE_W + LEFT;
  const bottom = Math.max(...all.map((v) => v.y)) + NODE_H;
  const height = bottom + 32 + 16;
  const bands = lanes.map((name, l) => {
    const ids = nodes.filter((id) => laneOf(id) === l);
    if (!ids.length) return null;
    const xs = ids.map((id) => xy.get(id).x);
    const left = Math.min(...xs) - 16;
    return { name, left, width: Math.max(...xs) - Math.min(...xs) + NODE_W + 32, ids };
  }).filter(Boolean);
  return { xy, width, height, bandHeight: bottom + 32 - 16, bands };
}

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

// ---------- derived data ----------
const pipeline = () => S.data?.pipeline;
const nodeName = (id, p = pipeline()) => p?.nodes.find((n) => n.id === id)?.name || id;
const isGhostRun = (r) => r.path.some((id) => !pipeline().nodes.some((n) => n.id === id));

function outcome(path, run, p = pipeline()) {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  if (run && run.status === "failed") {
    const at = Object.keys(run.errors)[0] || path[path.length - 1];
    const code = run.errors[at];
    return `failed · ${nodeName(at, p)}${code && code !== "failed" ? ` ${code}` : ""}`;
  }
  if (run && run.status === "running") return `running · ${nodeName(path[path.length - 1], p)}`;
  let last = path[path.length - 1];
  const lastNode = byId.get(last);
  if (lastNode?.kind === "sender" && path.length > 1) last = path[path.length - 2];
  const n = byId.get(last);
  if (n?.kind === "gate") return `dropped at ${n.name}`;
  if (n?.kind === "queue") return `held · ${n.name}`;
  return nodeName(last, p);
}

function filteredRuns() {
  const runs = S.data?.runs || [];
  if (S.filter === "failed") return runs.filter((r) => r.status === "failed");
  if (S.filter === "ghost") return runs.filter(isGhostRun);
  if (S.filter === "changed" && S.changedIds) return runs.filter((r) => S.changedIds.has(r.runId));
  return runs;
}

function pickedRun() {
  const runs = S.data?.runs || [];
  return runs.find((r) => r.runId === S.picked) || filteredRuns()[0] || runs[0] || null;
}

function defaultStep(run) {
  if (!run) return 0;
  const failAt = Object.keys(run.errors)[0];
  const i = failAt ? run.path.indexOf(failAt) : -1;
  return i >= 0 ? i : run.path.length - 1;
}

function isLive() {
  const runs = S.data?.runs || [];
  return runs.some((r) => r.status === "running") || (runs[0] && Date.now() - Date.parse(runs[0].endedAt) < 5 * 60000);
}

// Apply a draft for drawing. Same rules as the engine's applyDraft, kept small.
function drafted(p, d) {
  const out = JSON.parse(JSON.stringify(p));
  for (const n of d.addNodes || []) out.nodes.push({ ...n, draft: true });
  const drop = new Set((d.removeEdges || []).map((e) => `${e.from}->${e.to}`));
  out.edges = (out.edges || []).filter((e) => !drop.has(`${e.from}->${e.to}`));
  for (const c of d.changeEdges || []) for (const e of out.edges) if (e.from === c.from && e.to === c.to) { e.changed = true; if (c.when) e.when = c.when; else delete e.when; }
  for (const e of d.addEdges || []) out.edges.push({ ...e, draft: true });
  return out;
}

// ---------- rendering ----------
function topBar() {
  const p = pipeline();
  const proj = S.projects.find((x) => x.id === S.project);
  const anchors = S.data?.check?.anchors || [];
  const bad = anchors.filter((a) => ["missing-file", "missing-symbol", "no-repo"].includes(a.status)).length;
  const okCount = anchors.filter((a) => a.status === "ok").length;
  const schemaErr = S.data?.check?.errors?.length || 0;
  let check;
  if (S.loading) check = `<span role="status">${SVG.spin}Checking code anchors</span>`;
  else if (S.error) check = `<span role="status" class="err">${esc(S.error)}</span>`;
  else if (schemaErr) check = `<span role="status" class="red">${schemaErr} map ${schemaErr === 1 ? "error" : "errors"}</span>`;
  else if (bad) check = `<span role="status" class="red">${bad} of ${anchors.length} anchors broken</span>`;
  else check = `<span role="status">${okCount} of ${anchors.length} anchors ok</span>`;

  const projMenu = S.menu === "project" ? `<ul class="menu" role="listbox" aria-label="Projects">${S.projects.map((x) => `<li><button type="button" role="option" aria-selected="${x.id === S.project}" data-act="set-project" data-arg="${esc(x.id)}"><span>${esc(x.id)}</span><span class="sub">${esc(x.name)} · ${x.pipelineCount} ${x.pipelineCount === 1 ? "pipeline" : "pipelines"}</span></button></li>`).join("")}</ul>` : "";
  const pipeMenu = S.menu === "pipeline" ? `<ul class="menu" role="listbox" aria-label="Pipelines">${S.manifestPipelines.map((x) => `<li><button type="button" role="option" aria-selected="${x.id === S.pipelineId}" data-act="set-pipeline" data-arg="${esc(x.id)}"><span>${esc(x.id)}</span><span class="sub">${esc(x.name || "")}</span></button></li>`).join("")}</ul>` : "";
  const seg = ["map", "runs", "draft"].map((v) => `<button type="button" aria-pressed="${S.view === v}" data-act="view" data-arg="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join("");
  return `<header class="bar">
    <div class="row">
      <span class="brand">XPM</span>
      <div class="menu-wrap"><button type="button" class="pick-btn" aria-haspopup="listbox" aria-expanded="${S.menu === "project"}" data-act="menu" data-arg="project"><span class="lbl">project</span><span>${esc(proj?.id || S.project || "")}</span>${SVG.chev}</button>${projMenu}</div>
      <div class="menu-wrap"><button type="button" class="pick-btn" aria-haspopup="listbox" aria-expanded="${S.menu === "pipeline"}" data-act="menu" data-arg="pipeline"><span class="lbl">pipeline</span><span>${esc(p?.id || S.pipelineId || "")}</span><span class="sub">${esc(p?.name || "")}</span>${SVG.chev}</button>${pipeMenu}</div>
    </div>
    <div class="seg" role="group" aria-label="View">${seg}</div>
    <div class="status">${check}${isLive() ? '<span><span class="dot live"></span>Live</span>' : ""}</div>
  </header>`;
}

function footer(states, note, zoomable = true) {
  const pct = Math.round((S.zoom || 1) * 100);
  const items = {
    path: '<li><span class="sw path"></span>this run</li>',
    live: '<li><span class="dot live"></span>live</li>',
    failing: '<li><span class="sw failing"></span>failing</li>',
    ghost: '<li><span class="sw ghost"></span>ghost</li>',
    cold: '<li><span class="sw cold"></span>cold</li>',
    draft: '<li><span class="sw draft"></span>draft</li>',
  };
  return `<footer class="bar">
    ${zoomable ? `<div class="zoom"><button type="button" aria-label="Zoom out" data-act="zoom" data-arg="-1">${SVG.minus}</button><span class="pct" aria-label="Zoom ${pct} percent">${pct}%</span><button type="button" aria-label="Zoom in" data-act="zoom" data-arg="1">${SVG.plus}</button><button type="button" class="fit" data-act="fit">${SVG.fit}Fit</button></div>` : "<span></span>"}
    <ul class="legend" aria-label="States">${[...states].map((s) => items[s]).join("")}</ul>
    <span class="muted">${esc(note)}</span>
  </footer>`;
}

// One canvas renderer for the three views. `look(id)` decides each card's state and texts.
function canvas(p, L, look, edgeLook, extras = "", overlayHtml = "") {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const deciding = new Set((p.edges || []).filter((e) => e.when).map((e) => e.from));
  let paths = "", chips = "";
  for (const e of p.edges || []) {
    const a = L.xy.get(e.from), b = L.xy.get(e.to);
    if (!a || !b || e.ghostHop) continue;
    const g = edgePath(a, b);
    const s = edgeLook(e);
    paths += `<path d="${g.d}" stroke="${s.stroke}" stroke-width="${s.width}"${s.dash ? ' stroke-dasharray="4 3"' : ""}></path>`;
    const label = e.when ? `${e.when.decision} = ${e.when.equals}` : deciding.has(e.from) ? "else" : "";
    if (label) chips += `<span class="chip ${s.chip || ""}" style="left:${g.cx}px;top:${g.cy}px">${esc(label)}</span>`;
  }
  const bands = L.bands.map((b) => {
    const nNew = b.ids.filter((id) => byId.get(id)?.draft).length;
    const count = `${b.ids.length} ${b.ids.length === 1 ? "step" : "steps"}${nNew ? `, ${nNew} new` : ""}`;
    return `<div class="band" style="left:${b.left}px;top:16px;width:${b.width}px;height:${L.bandHeight}px"></div><span class="band-h" style="left:${b.left + 16}px;top:30px">${esc(b.name.toUpperCase())} <span class="dim">· ${count}</span></span>`;
  }).join("");
  const cards = [...L.xy.keys()].map((id) => {
    const n = byId.get(id) || { id, name: id, kind: "unknown" };
    const v = look(n);
    const { x, y } = L.xy.get(id);
    return `<button type="button" class="node ${v.cls || ""}" style="left:${x}px;top:${y}px" data-act="${v.act || "node"}" data-arg="${esc(v.arg ?? id)}" aria-label="${esc(v.aria)}"${v.expanded != null ? ` aria-expanded="${v.expanded}"` : ""}>
      <span class="port in" aria-hidden="true"></span><span class="port out" aria-hidden="true"></span>
      ${v.live ? '<span class="live-dot" aria-hidden="true"></span>' : ""}
      <span class="k">${icon(v.kind || n.kind)}<span>${esc(v.kindLabel ?? (v.kind || n.kind))}</span><span class="flag">${esc(v.flag || "")}</span></span>
      <span class="nm">${esc(n.name || id)}</span>
      <span class="st">${esc(v.stat || "")}</span>
    </button>`;
  }).join("");
  const z = S.zoom || 1;
  return `<div class="scroll" data-keep="canvas"><div class="sizer" style="width:${L.width * z}px;height:${L.height * z}px"><div class="stage" style="width:${L.width}px;height:${L.height}px;transform:scale(${z})">
    ${bands}
    <svg width="${L.width}" height="${L.height}" viewBox="0 0 ${L.width} ${L.height}" fill="none" aria-hidden="true" style="position:absolute;left:0;top:0">${paths}${extras}</svg>
    ${chips}${cards}${overlayHtml}
  </div></div></div>`;
}

function mapStat(id) {
  const s = S.data?.overlay?.nodes?.[id];
  if (!s || !s.hits) return "0 hits";
  return `${s.hits} hits${s.medianMs != null ? ` · ${ms(s.medianMs)}` : ""}`;
}

function liveAt() {
  const set = new Set();
  for (const r of S.data?.runs || []) if (r.status === "running") set.add(r.path[r.path.length - 1]);
  return set;
}

function mapLook(states) {
  const live = liveAt();
  return (n) => {
    const s = S.data?.overlay?.nodes?.[n.id] || {};
    const v = { stat: mapStat(n.id), cls: "", flag: "", live: live.has(n.id), expanded: S.panelNode === n.id };
    if (s.state === "failing") { v.cls = "failing"; v.flag = `${s.failures} failed`; states.add("failing"); }
    else if (s.state === "cold") { v.cls = "cold"; v.flag = "cold"; states.add("cold"); }
    if (v.live) states.add("live");
    v.aria = `${n.name}, ${n.kind}, ${v.stat}${v.flag ? `, ${v.flag}` : ""}${v.live ? ", a run is here now" : ""}`;
    return v;
  };
}

function viewMap() {
  const p = pipeline();
  const L = layout(p);
  const states = new Set();
  const body = canvas(p, L, mapLook(states), () => ({ stroke: "#4a4a50", width: 1.2 }));
  const ghosts = S.data.overlay.ghosts || [];
  const note = `hits and median time · last ${S.data.runs.length} runs · updated ${agoWords(S.fetchedAt)}`;
  const strip = ghosts.length ? `<div class="strip"><div class="row"><span class="sq-ghost"></span><span>${ghosts.length} ${ghosts.length === 1 ? "step" : "steps"} ran that the map does not know: ${ghosts.map((g) => `<b>${esc(g.id)}</b> (${g.hits} runs)`).join(", ")}</span></div><button type="button" class="btn" data-act="view" data-arg="runs" data-filter="ghost">See them in Runs</button></div>` : "";
  if (ghosts.length) states.add("ghost");
  return `<div class="body"><main class="main">${strip}${body}${footer(states, note)}</main>${S.panelNode ? nodePanel(S.panelNode) : ""}</div>`;
}

function nodePanel(id) {
  const p = pipeline();
  const n = p.nodes.find((x) => x.id === id);
  if (!n) return "";
  const a = n.anchor || {};
  const chk = (S.data.check.anchors || []).find((x) => x.node === id);
  const s = S.data.overlay.nodes[id] || {};
  const status = !chk ? "" : chk.status === "ok" ? "found in the code" : chk.status === "unanchored" ? "no anchor yet" : `<span class="red">${esc(chk.status.replace("-", " "))}${chk.detail ? `: ${esc(chk.detail)}` : ""}</span>`;
  const rows = [
    ["kind", esc(n.kind)], ["lane", esc(n.lane || "")], ["owner", esc(n.owner || "")],
    ["repo", esc(a.repo || "")], ["file", esc(a.path || "")], ["function", esc(a.symbol || "")], ["code check", status],
    ["decides", esc(n.decides || "")], ["last 50 runs", `${s.hits || 0} hits${s.medianMs != null ? `, median ${ms(s.medianMs)}` : ""}${s.failures ? `, <span class="red">${s.failures} failed</span>` : ""}`],
  ].filter(([, v]) => v);
  return `<aside class="side" aria-label="Step details"><div class="side-h"><div class="top"><span class="title"><b>${esc(n.name)}</b><span>${esc(n.id)}</span></span><button type="button" class="icon-btn" aria-label="Close details" data-act="close-panel">${SVG.close}</button></div></div>
    <dl class="detail">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></aside>`;
}

function viewRuns() {
  const p = pipeline();
  const runs = S.data.runs;
  if (!runs.length) return `<div class="body"><main class="main"><div class="empty"><b>No runs recorded yet.</b><span class="muted">Runs appear when the product writes events to events/${esc(S.project)}/. See "Events" in the README.</span></div>${footer(new Set(), `updated ${agoWords(S.fetchedAt)}`, false)}</main></div>`;
  const run = pickedRun();
  const declared = new Set(p.nodes.map((n) => n.id));
  const ghostIds = run.path.filter((id) => !declared.has(id));
  // Ghost steps get their own column, laid out like a draft step, so no hop runs right to left.
  const withGhosts = { ...p, nodes: [...p.nodes], edges: [...(p.edges || [])] };
  for (const id of ghostIds) {
    const i = run.path.indexOf(id), before = run.path[i - 1], after = run.path[i + 1];
    withGhosts.nodes.push({ id, name: id, kind: "unknown", lane: p.nodes.find((n) => n.id === before)?.lane, ghost: true });
    if (before) withGhosts.edges.push({ from: before, to: id, ghostHop: true });
    if (after) withGhosts.edges.push({ from: id, to: after, ghostHop: true });
  }
  const L = layout(withGhosts);
  const onPath = new Set(run.path);
  const step = Math.min(S.step ?? defaultStep(run), run.path.length - 1);
  const cur = run.path[step];
  const states = new Set(["path"]);
  const pairs = new Set(run.path.slice(1).map((id, i) => `${run.path[i]}->${id}`));
  const fade = (on) => (on ? "" : " faded");

  const look = (n) => {
    const idx = run.path.indexOf(n.id);
    const s = S.data.overlay.nodes[n.id] || {};
    const v = { cls: "", flag: "", stat: idx >= 0 ? `step ${idx + 1} · ${ms(run.durations[n.id]) || "0 ms"}` : mapStat(n.id), act: idx >= 0 ? "step" : "node" };
    if (!declared.has(n.id)) { v.cls = "ghost"; v.kind = "unknown"; v.kindLabel = ""; v.flag = "not on map"; states.add("ghost"); }
    else if (s.state === "cold") { v.cls = "cold"; v.flag = "cold"; states.add("cold"); }
    if (idx >= 0) v.cls += " path";
    if (n.id === cur) { v.cls += " current"; if (declared.has(n.id)) v.flag = "now"; }
    if (run.errors[n.id]) { v.cls += " failing"; v.flag = "failed"; states.add("failing"); }
    v.cls += fade(idx >= 0);
    v.aria = `${n.name || n.id}, ${declared.has(n.id) ? n.kind : "step not on the map"}, ${v.stat}${idx >= 0 ? ", on this run" : ""}`;
    if (idx >= 0) v.arg = idx;
    return v;
  };
  const edgeLook = (e) => {
    const on = pairs.has(`${e.from}->${e.to}`);
    return on ? { stroke: "#e7e7e9", width: 1.6, chip: "on" } : { stroke: "#26262a", width: 1.2, chip: "faded" };
  };
  // hops through ghosts: red dashed; plus the "run failed" chip under the last step
  let extra = "";
  run.path.slice(1).forEach((id, i) => {
    const from = run.path[i];
    if (declared.has(id) && declared.has(from)) return;
    const a = L.xy.get(from), b = L.xy.get(id);
    if (a && b) extra += `<path d="${edgePath(a, b).d}" stroke="#f87171" stroke-width="1.6" stroke-dasharray="4 3"></path>`;
  });
  let endChip = "";
  if (run.status === "failed") {
    const last = L.xy.get(run.path[run.path.length - 1]);
    if (last) {
      extra += `<path d="M${last.x + NODE_W / 2} ${last.y + NODE_H} L${last.x + NODE_W / 2} ${last.y + NODE_H + 12}" stroke="#f87171" stroke-width="1.2"></path>`;
      endChip = `<span class="chip end" style="left:${last.x + NODE_W / 2}px;top:${last.y + NODE_H + 12}px">run failed</span>`;
    }
  }
  const html = canvas(withGhosts, L, look, edgeLook, extra, endChip);

  const total = runMs(run);
  const failIdx = Object.keys(run.errors).length ? run.path.indexOf(Object.keys(run.errors)[0]) : -1;
  const channel = p.channel ? ` via ${esc(p.channel)}` : "";
  const tail = run.status === "failed" ? `failed at step ${failIdx >= 0 ? failIdx + 1 : run.path.length}` : run.status === "running" ? `running, step ${run.path.length}` : `${run.path.length} steps`;
  const dot = run.status === "failed" ? '<span class="dot fail"></span>' : run.status === "running" ? '<span class="dot live"></span>' : '<span class="dot done"></span>';
  const ghostBtn = ghostIds.length ? `<button type="button" class="btn" data-act="ghost-draft" data-arg="${esc(ghostIds[0])}">Add ${esc(ghostIds[0])} to a draft</button>` : "";
  const strip = `<div class="strip"><div class="row">${dot}<span style="font-weight:600">${run.preview ? `“${esc(run.preview)}”` : '<span class="muted">(no preview)</span>'}</span>
    <span class="muted">${run.sentAt ? `sent ${esc(clock(run.sentAt))}${channel} · ` : ""}run ${esc(short(run.runId))} · ${tail} · ${ms(total)}</span></div>
    <div class="row">${ghostBtn}${S.railOpen ? "" : `<button type="button" class="btn" data-act="rail" data-arg="1">Show runs</button>`}</div></div>`;

  const steps = run.path.map((id, i) => {
    const ghost = !declared.has(id);
    return `<button type="button" class="step${ghost ? " ghost" : ""}" data-act="step" data-arg="${i}"${i === step ? ' aria-current="step"' : ""} aria-label="${esc(`${i + 1} ${nodeName(id)}, ${ms(run.durations[id]) || "0 ms"}${ghost ? ", not on map" : ""}${i === step ? ", current step" : ""}`)}"><span>${i + 1} ${esc(nodeName(id))}</span><span class="tt">${ms(run.durations[id]) || "0 ms"}${ghost ? " · not on map" : ""}</span></button>`;
  }).join("");
  const endLabel = run.status === "failed" ? "Run failed" : run.status === "running" ? "Running" : "Done";
  const bar = run.path.map((id, i) => `<span class="${!declared.has(id) ? "ghost" : i < step ? "done" : i === step ? "cur" : ""}" style="flex-grow:${Math.max(1, run.durations[id] || 0)}"></span>`).join("");
  const scrub = `<section class="scrub" aria-label="Step scrubber">
    <div class="row"><button type="button" class="icon-btn boxed" aria-label="Previous step" data-act="step" data-arg="${Math.max(0, step - 1)}"${step === 0 ? " disabled" : ""}>${SVG.prev}</button><button type="button" class="icon-btn boxed" aria-label="Next step" data-act="step" data-arg="${Math.min(run.path.length - 1, step + 1)}"${step === run.path.length - 1 ? " disabled" : ""}>${SVG.next}</button>
    <span style="padding-left:6px">Step ${step + 1} of ${run.path.length} · ${esc(nodeName(cur))} · ${ms(run.durations[cur]) || "0 ms"}</span><span class="muted" style="margin-left:auto">0 s to ${ms(total)}</span></div>
    <div class="tbar" aria-hidden="true">${bar}</div>
    <div class="steps">${steps}<div class="step${run.status === "failed" ? " end-failed" : ""}" aria-label="${endLabel}, ${ms(total)} total"><span>${endLabel}</span><span class="tt">${ms(total)} total</span></div></div>
  </section>`;

  return `<div class="body"><main class="main">${strip}${html}${scrub}${footer(states, `updated ${agoWords(S.fetchedAt)}`)}</main>${S.railOpen ? rail(run) : ""}</div>`;
}

function rail(picked) {
  const runs = S.data.runs;
  const failed = runs.filter((r) => r.status === "failed").length;
  const ghost = runs.filter(isGhostRun).length;
  const list = filteredRuns();
  const segs = [["all", `All ${runs.length}`], ["failed", `Failed ${failed}`], ["ghost", `Ghost ${ghost}`]];
  if (S.changedIds) segs.push(["changed", `Changed ${S.changedIds.size}`]);
  const channel = pipeline().channel || "the product";
  const rows = list.map((r) => {
    const g = isGhostRun(r) ? '<span class="sq-ghost"></span>' : r.status === "failed" ? '<span class="dot fail"></span>' : r.status === "running" ? '<span class="dot live"></span>' : '<span class="dot done"></span>';
    const where = outcome(r.path, r);
    const wc = r.status === "failed" ? "red" : "";
    const text = r.preview ? `“${esc(r.preview)}”` : '<span class="muted">(no preview)</span>';
    const sent = r.sentAt ? `${esc(clock(r.sentAt))} · ` : "";
    return `<li><button type="button" class="run" data-act="pick" data-arg="${esc(r.runId)}" aria-pressed="${picked && r.runId === picked.runId}" aria-label="${esc(`${r.preview || "no preview"}, ${r.sentAt ? `sent ${clock(r.sentAt)}, ` : ""}run ${short(r.runId)}, ${where}, ${ms(runMs(r))}`)}">
      ${g}<span class="t"><span>${text}</span><span class="meta">${sent}${esc(short(r.runId))} · <span class="${wc}">${esc(where)}</span></span></span>
      <span class="r"><span>${ago(r.startedAt)}</span><span>${ms(runMs(r))}</span></span></button></li>`;
  }).join("");
  return `<aside class="side" aria-label="Last ${runs.length} runs"><div class="side-h">
    <div class="top"><span class="title"><b>Last ${runs.length} runs</b><span>what you typed · when ${esc(channel)} got it</span></span><button type="button" class="icon-btn" aria-label="Close runs panel" data-act="rail" data-arg="0">${SVG.close}</button></div>
    <div class="seg fill" role="group" aria-label="Filter runs">${segs.map(([k, l]) => `<button type="button" aria-pressed="${S.filter === k}" data-act="filter" data-arg="${k}">${l}</button>`).join("")}</div>
  </div><ul class="side-list" data-keep="rail">${rows || '<li class="muted" style="padding:12px">No runs match this filter.</li>'}</ul>
  <div class="side-foot">${list.length} ${list.length === 1 ? "run" : "runs"} · newest first</div></aside>`;
}

function viewDraft() {
  const p = pipeline();
  if (!S.draft && S.drafts.length === 1 && !S.draftClosed) { setTimeout(() => openDraft(S.drafts[0]), 0); return `<div class="center">${SVG.spin}Opening draft</div>`; }
  if (!S.draft) {
    const list = S.drafts.map((d) => `<button type="button" class="btn" data-act="open-draft" data-arg="${esc(d.file)}">${esc(d.name || d.file)}</button>`).join("");
    return `<div class="body"><main class="main"><div class="empty"><b>${S.drafts.length ? "Open a draft" : "No drafts for this pipeline yet."}</b>
      <span class="muted">A draft adds or rewires steps on top of the map and replays recorded runs through it. Product code is never touched. Drafts live in drafts/${esc(S.project)}/ as JSON${S.data.overlay.ghosts.length ? ", or start one from a ghost step in Runs" : ""}.</span><div class="row">${list}</div></div>${footer(new Set(), "no draft open", false)}</main></div>`;
  }
  const d = S.draft;
  const dp = drafted(p, d);
  const L = layout(dp);
  const states = new Set(["draft"]);
  const changedFrom = new Set((d.changeEdges || []).map((e) => e.from));
  const res = S.result;
  const look = (n) => {
    const s = S.data.overlay.nodes[n.id] || {};
    const v = { cls: "", flag: "", stat: mapStat(n.id), expanded: null };
    if (n.draft) {
      const a = n.assume || {};
      v.cls = "draft"; v.flag = "new";
      v.stat = res ? `${res.passesNewCount} pass${Number.isFinite(a.latencyMs) ? ` · +${ms(a.latencyMs)}` : ""}` : Number.isFinite(a.latencyMs) ? `about +${ms(a.latencyMs)}` : "passes through";
    } else if (s.state === "failing") { v.cls = "failing"; v.flag = `${s.failures} failed`; states.add("failing"); }
    else if (s.state === "cold") { v.cls = "cold"; v.flag = "cold"; states.add("cold"); }
    if (changedFrom.has(n.id)) { v.cls += " changed"; v.flag = "changed"; }
    v.aria = `${n.name}, ${n.kind}, ${v.stat}${v.flag ? `, ${v.flag}` : ""}`;
    return v;
  };
  const edgeLook = (e) => (e.draft || e.changed ? { stroke: "#60a5fa", width: 1.2, dash: true, chip: "draft" } : { stroke: "#4a4a50", width: 1.2 });
  const added = (d.addNodes || []).length, changed = (d.changeEdges || []).length, removed = (d.removeEdges || []).length;
  const parts = [];
  if (added) parts.push(`${added} ${added === 1 ? "step" : "steps"} added`);
  if (changed) parts.push(`${changed} ${changed === 1 ? "condition" : "conditions"} changed`);
  if (!added && !changed && removed) parts.push(`${removed} ${removed === 1 ? "link" : "links"} removed`);
  parts.push("product code untouched");
  const n = res?.runCount ?? S.data.runs.length;
  const strip = `<div class="strip"><div class="row"><span class="tag-draft">draft</span>${S.drafts.length > 1 ? `<div class="menu-wrap"><button type="button" class="pick-btn" aria-haspopup="listbox" aria-expanded="${S.menu === "draft"}" data-act="menu" data-arg="draft"><span style="font-weight:600">${esc(d.name || "draft")}</span>${SVG.chev}</button>${S.menu === "draft" ? `<ul class="menu" role="listbox" aria-label="Drafts">${S.drafts.map((x) => `<li><button type="button" role="option" aria-selected="${x.file === d.file}" data-act="open-draft" data-arg="${esc(x.file)}">${esc(x.name || x.file)}</button></li>`).join("")}</ul>` : ""}</div>` : `<span style="font-weight:600">${esc(d.name || "draft")}</span>`}<span class="muted">${parts.join(" · ")}</span></div>
    <div class="row"><button type="button" class="btn" data-act="replay"${S.replaying ? " disabled" : ""}>${S.replaying ? `${SVG.spin}Replaying` : `Replay ${n} runs${res ? " again" : ""}`}</button><button type="button" class="btn quiet" data-act="discard">${d.file ? "Close draft" : "Discard draft"}</button></div></div>`;

  let panel = "";
  if (S.replayError) panel = `<section class="result" aria-label="Replay result"><p class="err">${esc(S.replayError)}</p></section>`;
  else if (S.replaying && !res) panel = `<section class="result" aria-label="Replay result"><span class="row muted">${SVG.spin}Replaying recorded runs</span></section>`;
  else if (res && S.resultOpen) panel = resultPanel(dp, d, res);
  const saved = d.file ? (S.draftSavedAt ? `draft saved ${agoWords(S.draftSavedAt)} · not live` : "draft file · not live") : "draft not saved · not live";
  return `<div class="body"><main class="main">${strip}${canvas(dp, L, look, edgeLook)}${panel}${footer(states, saved)}</main></div>`;
}

function resultPanel(dp, d, res) {
  const newNodes = (d.addNodes || []).map((x) => x.name || x.id);
  const changedRuns = res.perRun.filter((r) => r.changed);
  // Where do the route changes start? The last shared step before the paths split.
  const forks = new Map();
  for (const r of changedRuns) {
    const b = r.basePath, n = r.draftPath.filter((id) => !(d.addNodes || []).some((x) => x.id === id));
    let i = 0;
    while (i < b.length && b[i] === n[i]) i++;
    const at = b[i - 1];
    if (at) forks.set(at, (forks.get(at) || 0) + 1);
  }
  const forkText = !changedRuns.length ? "No run changes route." : forks.size === 1 ? `The route changes all sit on the ${nodeName([...forks.keys()][0], dp)} branch.` : `The route changes start at ${forks.size} different steps.`;
  const timeText = newNodes.length && res.medianAddedMs ? `${res.medianAddedMs > 0 ? "+" : ""}${ms(res.medianAddedMs)} is the median time ${newNodes.join(" and ")} ${newNodes.length === 1 ? "adds" : "add"} to each run that reaches it. ` : "";
  const fidelity = res.mapFidelity != null && res.mapFidelity < 0.9 ? `<p class="red">The map matches only ${Math.round(res.mapFidelity * 100)} percent of real runs. Fix the map before trusting these numbers.</p>` : "";
  const rows = changedRuns.slice(0, 6).map((r) => {
    return `<tr><td>${esc(short(r.runId))}</td><td class="muted">${esc(outcome(r.basePath, null, pipeline()))}</td><td class="blue">${esc(outcome(r.draftPath, null, dp))}</td></tr>`;
  }).join("");
  const more = changedRuns.length > 6 ? `<tr><td colspan="3" class="muted">and ${changedRuns.length - 6} more, all in Runs</td></tr>` : "";
  const sign = res.medianAddedMs > 0 ? "+" : "";
  return `<section class="result" aria-label="Replay result">
    <div class="row" style="align-items:flex-start;gap:24px">
      <div style="flex:1 1 380px;min-width:0;display:flex;flex-direction:column;gap:8px">
        <p class="verdict">${res.changedCount} of ${res.runCount} runs change route, ${res.passesNewCount} pass the new ${newNodes.length === 1 ? "step" : "steps"}, ${sign}${ms(res.medianAddedMs || 0)}</p>
        <p class="muted">${esc(timeText + forkText)} Replay of ${res.runCount} recorded runs: recorded decisions only, no product code ran.</p>${fidelity}
        <div class="row" style="padding-top:6px"><button type="button" class="btn primary" data-act="export">${SVG.down}Export spec</button>${changedRuns.length ? `<button type="button" class="btn" data-act="see-changed">See the ${changedRuns.length} ${changedRuns.length === 1 ? "run" : "runs"} in Runs</button>` : ""}</div>
      </div>
      ${changedRuns.length ? `<div style="flex:1 1 420px;min-width:0;overflow-x:auto;display:flex;gap:8px;align-items:flex-start"><table><caption>Runs that change route</caption><thead><tr><th scope="col">run</th><th scope="col">was</th><th scope="col">now</th></tr></thead><tbody>${rows}${more}</tbody></table><button type="button" class="icon-btn" aria-label="Close result panel" data-act="close-result">${SVG.close}</button></div>` : `<button type="button" class="icon-btn" aria-label="Close result panel" data-act="close-result">${SVG.close}</button>`}
    </div></section>`;
}

function render() {
  const app = document.getElementById("app");
  const keep = {};
  app.querySelectorAll("[data-keep]").forEach((el) => { keep[el.dataset.keep] = [el.scrollLeft, el.scrollTop]; });
  const focusKey = document.activeElement?.dataset?.act ? `${document.activeElement.dataset.act}|${document.activeElement.dataset.arg || ""}` : null;

  let body;
  if (!S.data && S.loading) body = `<div class="center">${SVG.spin}Loading pipeline</div>`;
  else if (!S.data) body = `<div class="empty"><b>${esc(S.error || "No pipeline to show.")}</b><span class="muted">A project needs a "pipelines" list in its manifest. See the README.</span><a href="/" class="btn">Back to the project map</a></div>`;
  else body = S.view === "runs" ? viewRuns() : S.view === "draft" ? viewDraft() : viewMap();
  app.innerHTML = topBar() + body;

  app.querySelectorAll("[data-keep]").forEach((el) => { const k = keep[el.dataset.keep]; if (k) { el.scrollLeft = k[0]; el.scrollTop = k[1]; } });
  if (focusKey) {
    const [act, arg] = focusKey.split("|");
    const el = [...app.querySelectorAll(`[data-act="${act}"]`)].find((x) => (x.dataset.arg || "") === arg);
    if (el) el.focus({ preventScroll: true });
  }
  const sc = app.querySelector(".scroll");
  const stage = app.querySelector(".stage");
  if (S.data && sc && stage) {
    const w = parseFloat(stage.style.width), h = parseFloat(stage.style.height);
    if (!S.userZoomed) {
      // Fit after the rail and panels took their space; never below a readable size, past that the canvas pans.
      const z = Math.max(0.55, Math.min(1, (sc.clientWidth - 48) / w, (sc.clientHeight - 48) / h));
      if (Math.abs(z - (S.zoom || 0)) > 0.01) { S.zoom = Math.round(z * 100) / 100; render(); return; }
    }
    // iPad portrait and phone: when the graph is shorter than the room, the canvas is only as tall as the
    // graph, so the scrubber and the runs list move up under it. Wide screens keep the full canvas.
    const need = Math.ceil(h * (S.zoom || 1) + 48);
    if (window.innerWidth <= 1100 && need < sc.clientHeight) sc.style.flex = `0 0 ${need}px`;
  }
  if (S.scrollPicked) {
    S.scrollPicked = false;
    app.querySelector('.run[aria-pressed="true"]')?.scrollIntoView({ block: "nearest" });
  }
}

// ---------- data ----------
function syncUrl() {
  const q = new URLSearchParams({ project: S.project || "", pipeline: S.pipelineId || "", view: S.view });
  if (S.view === "draft" && S.draft?.file) q.set("draft", S.draft.file);
  if (S.view === "runs" && S.picked) q.set("run", short(S.picked));
  history.replaceState(null, "", `?${q}`);
}

async function getJson(url, opts) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || (body.errors && body.errors.join("; ")) || `HTTP ${res.status}`);
  return body;
}

async function loadProject(id, wantPipeline) {
  S.project = id;
  const m = await getJson(`/api/project/${encodeURIComponent(id)}`);
  S.manifestPipelines = m.pipelines || [];
  S.pipelineId = S.manifestPipelines.some((p) => p.id === wantPipeline) ? wantPipeline : S.manifestPipelines[0]?.id || null;
  S.data = null; S.picked = null; S.step = null; S.panelNode = null; S.draft = null; S.result = null; S.changedIds = null; S.userZoomed = false; S.zoom = null;
  if (S.filter === "changed") S.filter = "all";
  await loadPipeline();
}

async function loadPipeline({ quiet = false } = {}) {
  if (!S.pipelineId) { S.loading = false; S.error = "This project has no pipelines yet."; render(); return; }
  if (!quiet) { S.loading = true; render(); }
  try {
    const base = `/api/project/${encodeURIComponent(S.project)}/pipeline/${encodeURIComponent(S.pipelineId)}`;
    const [data, drafts] = await Promise.all([getJson(base), getJson(`${base}/drafts`)]);
    S.data = data; S.drafts = drafts; S.error = null; S.fetchedAt = Date.now();
    const params = new URLSearchParams(location.search);
    const wantRun = params.get("run");
    if (!quiet && wantRun && !S.picked) { const r = data.runs.find((x) => x.runId.startsWith(wantRun)); if (r) { S.picked = r.runId; S.scrollPicked = true; } }
    const want = params.get("draft");
    if (!quiet && want && S.view === "draft" && !S.draft) { const d = drafts.find((x) => x.file === want); if (d) setTimeout(() => openDraft(d), 0); }
  } catch (err) {
    S.error = err.message;
  } finally {
    S.loading = false;
    syncUrl();
    render();
  }
}

async function replay() {
  if (!S.draft) return;
  S.replaying = true; S.replayError = null; S.resultOpen = true; render();
  try {
    const { file, ...body } = S.draft;
    S.result = await getJson(`/api/project/${encodeURIComponent(S.project)}/pipeline/${encodeURIComponent(S.pipelineId)}/simulate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch (err) {
    S.replayError = `Replay refused: ${err.message}`;
    S.result = null;
  } finally {
    S.replaying = false;
    render();
  }
}

function openDraft(d) {
  S.draft = d; S.result = null; S.replayError = null; S.menu = null; S.view = "draft"; S.userZoomed = false;
  S.draftSavedAt = d.savedAt ? Date.parse(d.savedAt) : null;
  syncUrl();
  replay();
}

// A ghost step becomes a draft: put it on the map where the run says it ran.
function ghostDraft(id) {
  const run = pickedRun();
  const i = run.path.indexOf(id);
  const before = run.path[i - 1], after = run.path[i + 1];
  const p = pipeline();
  const lane = p.nodes.find((n) => n.id === before)?.lane;
  const d = { pipeline: p.id, name: `add-${id}`, addNodes: [{ id, name: id, kind: "tool", lane, assume: { latencyMs: run.durations[id] || 0 } }], addEdges: [], removeEdges: [] };
  if (before) d.addEdges.push({ from: before, to: id });
  if (after && p.nodes.some((n) => n.id === after)) {
    d.addEdges.push({ from: id, to: after });
    if ((p.edges || []).some((e) => e.from === before && e.to === after)) d.removeEdges.push({ from: before, to: after });
  }
  openDraft(d);
}

function exportSpec() {
  if (!S.result?.spec) return;
  const blob = new Blob([S.result.spec], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${(S.draft.name || "draft").replace(/[^a-z0-9_-]+/gi, "-")}-spec.md`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

// ---------- events ----------
document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-act]");
  if (!el) { if (S.menu) { S.menu = null; render(); } return; }
  const act = el.dataset.act, arg = el.dataset.arg;
  if (act !== "menu" && S.menu && !el.closest(".menu")) S.menu = null;
  switch (act) {
    case "menu": S.menu = S.menu === arg ? null : arg; break;
    case "set-project": S.menu = null; loadProject(arg); return;
    case "set-pipeline": S.menu = null; S.pipelineId = arg; S.userZoomed = false; S.zoom = null; S.picked = null; S.draft = null; S.result = null; loadPipeline(); return;
    case "view": S.view = arg; S.userZoomed = false; if (el.dataset.filter) S.filter = el.dataset.filter; if (arg !== "map") S.panelNode = null; syncUrl(); break;
    case "node": if (S.view === "map") S.panelNode = S.panelNode === arg ? null : arg; break;
    case "close-panel": S.panelNode = null; break;
    case "pick": S.picked = arg; S.step = null; syncUrl(); break;
    case "step": S.step = Number(arg); if (S.picked == null) S.picked = pickedRun()?.runId; break;
    case "filter": S.filter = arg; S.scrollPicked = true; { const first = filteredRuns()[0]; if (first && !filteredRuns().some((r) => r.runId === S.picked)) { S.picked = first.runId; S.step = null; } } break;
    case "rail": S.railOpen = arg === "1"; break;
    case "zoom": S.userZoomed = true; S.zoom = Math.max(0.3, Math.min(2, Math.round(((S.zoom || 1) + Number(arg) * 0.1) * 100) / 100)); break;
    case "fit": S.userZoomed = false; S.zoom = null; break;
    case "open-draft": { const d = S.drafts.find((x) => x.file === arg); if (d) openDraft(d); return; }
    case "ghost-draft": ghostDraft(arg); return;
    case "replay": replay(); return;
    case "discard": S.draftClosed = true; S.draft = null; S.result = null; S.replayError = null; break;
    case "close-result": S.resultOpen = false; break;
    case "export": exportSpec(); return;
    case "see-changed": S.scrollPicked = true; S.changedIds = new Set(S.result.perRun.filter((r) => r.changed).map((r) => r.runId)); S.filter = "changed"; S.view = "runs"; S.picked = null; S.step = null; S.userZoomed = false; syncUrl(); break;
    default: return;
  }
  render();
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && (S.menu || S.panelNode)) { S.menu = null; S.panelNode = null; render(); }
});

let resizeTimer;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (!S.userZoomed) { S.zoom = null; render(); } }, 150); });

// Fresh data every 30 s while looking at the map or the runs; the footer age updates with it.
setInterval(() => { if (document.visibilityState === "visible" && S.data && S.view !== "draft" && !S.loading) loadPipeline({ quiet: true }); }, 30000);

(async function init() {
  const q = new URLSearchParams(location.search);
  if (["map", "runs", "draft"].includes(q.get("view"))) S.view = q.get("view");
  render();
  try {
    const all = await getJson("/api/projects");
    S.projects = all.filter((p) => p.pipelineCount > 0).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const want = q.get("project");
    const first = S.projects.find((p) => p.id === want) || S.projects[0];
    if (!first) { S.loading = false; S.error = "No project has a pipeline yet."; render(); return; }
    await loadProject(first.id, q.get("pipeline"));
  } catch (err) {
    S.loading = false; S.error = err.message; render();
  }
})();
