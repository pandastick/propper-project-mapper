// XPM pipeline schema: the declared map of how a message moves through a product.
// Lives under the `pipelines` key of a project manifest, next to screens and entities.

const NODE_KINDS = ["door", "hook", "router", "classifier", "mode", "model", "tool", "queue", "store", "gate", "sender"];
const EDGE_KINDS = ["control", "data", "handoff", "error"];

/** Returns a list of human-readable problems. Empty list means the pipeline is valid. */
function validatePipeline(p) {
  const errors = [];
  if (!p || typeof p !== "object") return ["pipeline is not an object"];
  if (typeof p.id !== "string" || !p.id) errors.push("pipeline id missing");
  const where = `pipeline ${p.id || "?"}`;
  if (!Array.isArray(p.nodes) || p.nodes.length === 0) return [...errors, `${where}: no nodes`];
  const lanes = Array.isArray(p.lanes) ? p.lanes : null;

  const ids = new Set();
  for (const n of p.nodes) {
    if (!n || typeof n.id !== "string" || !n.id) {
      errors.push(`${where}: a node has no id`);
      continue;
    }
    if (ids.has(n.id)) errors.push(`${where}: duplicate node ${n.id}`);
    ids.add(n.id);
    if (!NODE_KINDS.includes(n.kind)) errors.push(`${where}: node ${n.id} has unknown kind ${n.kind}`);
    if (lanes && n.lane && !lanes.includes(n.lane)) errors.push(`${where}: node ${n.id} is in unknown lane ${n.lane}`);
    if (n.values !== undefined && !(Array.isArray(n.values) && n.values.every((v) => typeof v === "string" && /^[A-Za-z0-9_.:\/-]{1,32}$/.test(v)))) errors.push(`${where}: node ${n.id} values must be short labels without spaces`);
    if (n.anchor !== undefined) {
      const a = n.anchor;
      if (!a || typeof a.repo !== "string" || typeof a.path !== "string") errors.push(`${where}: node ${n.id} anchor needs repo and path`);
    }
  }

  const pairs = new Set();
  if (p.edges !== undefined && !Array.isArray(p.edges)) return [...errors, `${where}: edges must be a list`];
  for (const e of p.edges || []) {
    if (!e || typeof e !== "object") { errors.push(`${where}: an edge is not an object`); continue; }
    if (!ids.has(e.from)) errors.push(`${where}: edge from unknown node ${e.from}`);
    if (!ids.has(e.to)) errors.push(`${where}: edge to unknown node ${e.to}`);
    if (e.kind !== undefined && !EDGE_KINDS.includes(e.kind)) errors.push(`${where}: edge ${e.from}->${e.to} has unknown kind ${e.kind}`);
    const key = `${e.from}->${e.to}:${JSON.stringify(e.when || null)}`;
    if (pairs.has(key)) errors.push(`${where}: duplicate edge ${e.from}->${e.to}`);
    pairs.add(key);
    if (e.when !== undefined) {
      const w = e.when;
      if (!w || typeof w.decision !== "string" || !("equals" in w)) errors.push(`${where}: edge ${e.from}->${e.to} when needs decision and equals`);
    }
  }
  if (p.entry !== undefined && !ids.has(p.entry)) errors.push(`${where}: entry ${p.entry} is not a node`);
  return errors;
}

const edgeId = (e) => `${e.from}->${e.to}${e.when ? `[${e.when.decision}=${e.when.equals}]` : ""}`;

/** Entry nodes: the declared entry, else every node nothing points at. */
function entryNodes(p) {
  if (p.entry) return [p.entry];
  const targets = new Set((p.edges || []).map((e) => e.to));
  return p.nodes.map((n) => n.id).filter((id) => !targets.has(id));
}

module.exports = { NODE_KINDS, EDGE_KINDS, validatePipeline, edgeId, entryNodes };
