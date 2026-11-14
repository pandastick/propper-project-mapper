// What-if, level 1: push recorded runs through a draft of the map. No product code runs.
// Idea borrowed from langgraph-replay's "deterministic" mode: everything recorded,
// only the graph changes. A new node either passes through or splits by assumed shares.

const { validatePipeline, entryNodes } = require("./schema");
const { median } = require("./runs");

/** Stable 0..1 from a string, so the same run always lands on the same side of a split. */
function unit(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

function pickShare(split, key) {
  const entries = Object.entries(split);
  const total = entries.reduce((sum, [, w]) => sum + w, 0) || 1;
  let x = unit(key) * total;
  for (const [value, w] of entries) {
    if ((x -= w) < 0) return value;
  }
  return entries[entries.length - 1][0];
}

/** Problems with a draft, as sentences. A draft is hand-edited JSON, so a bad one is refused with the reason. */
function validateDraft(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return ["draft is not an object"];
  const errors = [];
  for (const key of ["addNodes", "removeEdges", "addEdges", "changeEdges"]) {
    if (d[key] === undefined) continue;
    if (!Array.isArray(d[key])) { errors.push(`draft ${key} must be a list`); continue; }
    d[key].forEach((x, i) => {
      const at = `draft ${key}[${i}]`;
      if (!x || typeof x !== "object" || Array.isArray(x)) return errors.push(`${at} is not an object`);
      if (key !== "addNodes") {
        if (typeof x.from !== "string" || typeof x.to !== "string") errors.push(`${at} needs from and to`);
        return;
      }
      if (typeof x.id !== "string" || !x.id) errors.push(`${at} needs an id`);
      const a = x.assume;
      if (a === undefined) return;
      if (!a || typeof a !== "object" || Array.isArray(a)) return errors.push(`${at} assume is not an object`);
      if (a.latencyMs !== undefined && !(Number.isFinite(a.latencyMs) && a.latencyMs >= 0)) errors.push(`${at} assume.latencyMs must be a number, 0 or more`);
      if (a.split === undefined) return;
      const weights = a.split && typeof a.split === "object" && !Array.isArray(a.split) ? Object.values(a.split) : null;
      if (!weights || !weights.length || !weights.every((w) => Number.isFinite(w) && w >= 0) || !weights.some((w) => w > 0)) errors.push(`${at} assume.split needs shares like { "chat": 0.7, "command": 0.3 }`);
      if (typeof a.decision !== "string" || !a.decision) errors.push(`${at} assume.split needs assume.decision, the name of what it decides`);
    });
  }
  if (d.entry !== undefined && typeof d.entry !== "string") errors.push("draft entry must be a node id");
  return errors;
}

/** Map plus draft = a new pipeline. The map file itself is never touched. */
function applyDraft(pipeline, draft) {
  const p = JSON.parse(JSON.stringify(pipeline));
  const added = new Set();
  const bad = validateDraft(draft);
  if (bad.length) return { pipeline: p, added, errors: bad };
  for (const n of draft.addNodes || []) {
    p.nodes.push({ ...n, draft: true });
    added.add(n.id);
  }
  const drop = (draft.removeEdges || []).map((e) => `${e.from}->${e.to}`);
  p.edges = (p.edges || []).filter((e) => !drop.includes(`${e.from}->${e.to}`));
  const missing = [];
  for (const c of draft.changeEdges || []) {
    const hits = p.edges.filter((e) => e.from === c.from && e.to === c.to);
    if (!hits.length) missing.push(`draft changes a link that does not exist: ${c.from}->${c.to}`);
    for (const e of hits) {
      e.changed = true;
      if (c.when) e.when = c.when;
      else delete e.when;
    }
  }
  for (const e of draft.addEdges || []) p.edges.push({ ...e, draft: true });
  if (draft.entry) p.entry = draft.entry;
  const errors = [...missing, ...validatePipeline(p)];
  return { pipeline: p, added, errors };
}

const matches = (when, decisions) => when && String(decisions[when.decision]) === String(when.equals);

/**
 * Walk the graph for one run. Routing rule, same as an n8n IF node:
 * a node with conditional edges follows the ones that match, else its plain edges (the "else").
 * A node with only plain edges follows all of them (fan-out).
 */
function route(pipeline, recorded, runId) {
  const decisions = { ...recorded };
  const byId = new Map(pipeline.nodes.map((n) => [n.id, n]));
  const out = new Map();
  for (const e of pipeline.edges || []) (out.get(e.from) || out.set(e.from, []).get(e.from)).push(e);
  const path = [];
  const unknown = [];
  const seen = new Set();
  const queue = [...entryNodes(pipeline)];
  while (queue.length && path.length < 200) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    path.push(id);
    const node = byId.get(id);
    const assume = node && node.assume;
    if (assume && assume.decision && assume.split) decisions[assume.decision] = pickShare(assume.split, `${runId}:${id}`);
    const edges = out.get(id) || [];
    const conditional = edges.filter((e) => e.when);
    const plain = edges.filter((e) => !e.when);
    let next = plain;
    if (conditional.length) {
      const hit = conditional.filter((e) => matches(e.when, decisions));
      if (hit.length) next = hit;
      else if (!conditional.some((e) => e.when.decision in decisions)) unknown.push(id);
    }
    for (const e of next) queue.push(e.to);
  }
  return { path, decisions, unknown };
}

function pathMs(path, run, pipeline, medians) {
  const byId = new Map(pipeline.nodes.map((n) => [n.id, n]));
  let ms = 0;
  for (const id of path) {
    const assumed = byId.get(id)?.assume?.latencyMs;
    if (Number.isFinite(run.durations[id])) ms += run.durations[id];
    else if (Number.isFinite(assumed)) ms += assumed;
    else if (Number.isFinite(medians[id])) ms += medians[id];
  }
  return ms;
}

function simulate(pipeline, draft, runs) {
  const mapErrors = validatePipeline(pipeline);
  if (mapErrors.length) return { ok: false, errors: mapErrors };
  const { pipeline: drafted, errors } = applyDraft(pipeline, draft);
  if (errors.length) return { ok: false, errors };
  const declared = new Set(pipeline.nodes.map((n) => n.id));
  const medians = {};
  for (const n of pipeline.nodes) medians[n.id] = median(runs.map((r) => r.durations[n.id]));

  const added = new Set((draft.addNodes || []).map((n) => n.id));
  const bare = (path) => path.filter((id) => !added.has(id)).join(">");
  const perRun = [];
  const delta = {};
  const outcomes = {};
  let faithful = 0;
  for (const run of runs) {
    const base = route(pipeline, run.decisions, run.runId);
    const next = route(drafted, run.decisions, run.runId);
    const observed = run.path.filter((id) => declared.has(id));
    // A run that failed or is still going may stop early: it is faithful if it followed the map until it stopped.
    const stoppedEarly = run.status !== "success" && observed.every((id, i) => base.path[i] === id);
    if (stoppedEarly || observed.join(">") === base.path.join(">")) faithful += 1;
    for (const id of base.path) delta[id] = (delta[id] || 0) - 1;
    for (const id of next.path) delta[id] = (delta[id] || 0) + 1;
    for (const n of draft.addNodes || []) {
      const d = n.assume?.decision;
      if (d && next.path.includes(n.id)) {
        const k = `${n.id}: ${d}=${next.decisions[d]}`;
        outcomes[k] = (outcomes[k] || 0) + 1;
      }
    }
    perRun.push({
      runId: run.runId,
      basePath: base.path,
      draftPath: next.path,
      passesNew: next.path.some((id) => added.has(id)),
      changed: base.path.join(">") !== bare(next.path),
      addedMs: pathMs(next.path, run, drafted, medians) - pathMs(base.path, run, pipeline, medians),
    });
  }
  const changed = perRun.filter((r) => r.changed);
  return {
    ok: true,
    runCount: runs.length,
    changedCount: changed.length,
    passesNewCount: perRun.filter((r) => r.passesNew).length,
    mapFidelity: runs.length ? Math.round((faithful / runs.length) * 100) / 100 : null,
    medianAddedMs: median(perRun.map((r) => r.addedMs)),
    trafficDelta: Object.fromEntries(Object.entries(delta).filter(([, v]) => v !== 0)),
    outcomes,
    perRun,
  };
}

/** A draft worth building becomes a short change spec for whoever owns the code: the answer first, then the list. */
function draftToSpec(pipeline, draft, result) {
  const lines = [];
  const name = draft.name || "Untitled draft";
  lines.push(`# Change spec: ${name}`, "");
  lines.push(`**Pipeline:** ${pipeline.name || pipeline.id}`);
  if (result.ok) {
    const pct = result.runCount ? Math.round((result.changedCount / result.runCount) * 100) : 0;
    lines.push(`**Answer:** ${result.changedCount} of ${result.runCount} recorded runs (${pct} percent) end up on a different route. ${result.passesNewCount} pass through the new step. Median added time ${result.medianAddedMs ?? 0} ms.`);
    if (result.mapFidelity !== null && result.mapFidelity < 0.9) {
      lines.push(`**Warning:** the map matches only ${Math.round(result.mapFidelity * 100)} percent of real runs. Fix the map before trusting these numbers.`);
    }
  }
  lines.push("", "## What changes", "");
  for (const n of draft.addNodes || []) {
    const a = n.assume || {};
    const how = a.split ? `decides ${a.decision} (assumed ${Object.entries(a.split).map(([k, v]) => `${k} ${v}`).join(", ")})` : "passes through";
    lines.push(`- Add **${n.name || n.id}** (${n.kind}), ${how}${Number.isFinite(a.latencyMs) ? `, about ${a.latencyMs} ms` : ""}`);
  }
  for (const e of draft.removeEdges || []) lines.push(`- Remove the link ${e.from} to ${e.to}`);
  for (const e of draft.changeEdges || []) lines.push(`- Change the link ${e.from} to ${e.to}: ${e.when ? `only when ${e.when.decision} is ${e.when.equals}` : "always (no condition)"}`);
  for (const e of draft.addEdges || []) lines.push(`- Link ${e.from} to ${e.to}${e.when ? ` when ${e.when.decision} is ${e.when.equals}` : ""}`);
  if (draft.entry) lines.push(`- Messages now enter at ${draft.entry}`);
  if (result.ok) {
    lines.push("", "## Traffic per node (draft minus today)", "");
    for (const [id, v] of Object.entries(result.trafficDelta)) lines.push(`- ${id}: ${v > 0 ? "+" : ""}${v}`);
    if (Object.keys(result.outcomes).length) {
      lines.push("", "## Assumed decisions", "");
      for (const [k, v] of Object.entries(result.outcomes)) lines.push(`- ${k}: ${v} runs`);
    }
  }
  const touched = new Set([...(draft.addEdges || []), ...(draft.removeEdges || []), ...(draft.changeEdges || [])].map((e) => e.from));
  const anchors = pipeline.nodes.filter((n) => touched.has(n.id) && n.anchor);
  if (anchors.length) {
    lines.push("", "## Code to change", "");
    for (const n of anchors) lines.push(`- ${n.anchor.repo}: ${n.anchor.path}${n.anchor.symbol ? ` (${n.anchor.symbol})` : ""}, owner ${n.owner || "unknown"}`);
  }
  lines.push("", "_Level 1 simulation: recorded decisions replayed on a changed map. No product code ran._", "");
  return lines.join("\n");
}

module.exports = { validateDraft, applyDraft, route, simulate, draftToSpec, pickShare };
