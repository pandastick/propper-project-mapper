// Fold events into runs, then lay the runs over the declared map.
// The overlay is where trust comes from: ghosts and unmapped hops mean the map is wrong.

const { sortEvents } = require("./events");

const DAY_MS = 86400000;

function median(values) {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** One run per runId: the nodes it touched in order, what each decided, how long each took. */
function foldRuns(events) {
  const byRun = new Map();
  for (const ev of sortEvents(events)) {
    let run = byRun.get(ev.runId);
    if (!run) {
      run = { runId: ev.runId, startedAt: ev.ts, endedAt: ev.ts, status: "running", path: [], decisions: {}, durations: {}, errors: {} };
      byRun.set(ev.runId, run);
    }
    run.endedAt = ev.ts;
    if (ev.node && run.path[run.path.length - 1] !== ev.node) run.path.push(ev.node);
    const m = ev.metadata || {};
    if (m.decision) Object.assign(run.decisions, m.decision);
    if (ev.node && Number.isFinite(m.durationMs)) run.durations[ev.node] = (run.durations[ev.node] || 0) + m.durationMs;
    if (ev.type === "node.failed") {
      run.errors[ev.node] = m.errorCode || "failed";
      run.status = "failed";
    }
    if (ev.type === "run.failed") run.status = "failed";
    if (ev.type === "run.completed" && run.status !== "failed") run.status = "success";
  }
  return [...byRun.values()].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

/** Per node and per edge numbers for the canvas, plus the drift findings. */
function overlay(pipeline, runs, { now = Date.now(), coldDays = 14 } = {}) {
  const declared = new Set(pipeline.nodes.map((n) => n.id));
  const nodes = {};
  for (const id of declared) nodes[id] = { hits: 0, failures: 0, medianMs: null, lastSeen: null, state: "idle" };
  const timings = {};
  const edges = {};
  const ghosts = {};
  const unmapped = {};
  const edgeByPair = new Map();
  for (const e of pipeline.edges || []) if (!edgeByPair.has(`${e.from}->${e.to}`)) edgeByPair.set(`${e.from}->${e.to}`, e);

  for (const run of runs) {
    run.path.forEach((id, i) => {
      if (!declared.has(id)) {
        ghosts[id] = (ghosts[id] || 0) + 1;
      } else {
        const n = nodes[id];
        n.hits += 1;
        if (run.errors[id]) n.failures += 1;
        if (!n.lastSeen || run.endedAt > n.lastSeen) n.lastSeen = run.endedAt;
        if (Number.isFinite(run.durations[id])) (timings[id] = timings[id] || []).push(run.durations[id]);
      }
      if (i === 0) return;
      const pair = `${run.path[i - 1]}->${id}`;
      if (edgeByPair.has(pair)) edges[pair] = (edges[pair] || 0) + 1;
      else unmapped[pair] = (unmapped[pair] || 0) + 1;
    });
  }

  for (const [id, n] of Object.entries(nodes)) {
    n.medianMs = median(timings[id] || []);
    if (n.failures) n.state = "failing";
    else if (runs.length && (!n.lastSeen || now - Date.parse(n.lastSeen) > coldDays * DAY_MS)) n.state = "cold";
    else if (n.hits) n.state = "live";
  }
  const total = runs.length || 1;
  const edgeShare = Object.fromEntries(Object.entries(edges).map(([k, v]) => [k, Math.round((v / total) * 100) / 100]));
  return {
    runCount: runs.length,
    nodes,
    edges,
    edgeShare,
    ghosts: Object.entries(ghosts).map(([id, hits]) => ({ id, hits })),
    unmapped: Object.entries(unmapped).map(([pair, hits]) => ({ pair, hits })),
  };
}

module.exports = { foldRuns, overlay, median };
