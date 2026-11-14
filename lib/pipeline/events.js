// XPM execution events: one JSON object per line (JSONL), one line per hop.
// Envelope shape inspired by AgentFlow Visualization (MIT), cut down on purpose:
// events carry WHICH node ran and WHAT it decided, never the message itself.

const EVENT_TYPES = ["run.started", "node.started", "node.completed", "node.failed", "decision", "run.completed", "run.failed"];
const STATUSES = ["success", "failed", "skipped", "waiting"];
// Anything outside this list is dropped, so a careless writer cannot leak content into the file.
// sentAt: when the channel received the message (Unix seconds). A time, not content.
const METADATA_KEYS = ["decision", "durationMs", "status", "errorCode", "attempt", "model", "tokens", "costUsd", "sentAt"];
const MAX_STRING = 120;
// A decision is a label, never a sentence: one short token, no spaces. This is what keeps typed text out of events.
const TOKEN = /^[A-Za-z0-9_.:\/-]{1,32}$/;
const BASE_VALUES = new Set(["yes", "no", "on", "off", "true", "false", "other"]);

const isStr = (v) => typeof v === "string" && v.length > 0;
const short = (v) => typeof v === "string" && v.length <= MAX_STRING;

/** Keeps booleans, numbers and token strings. `dropped` counts what was thrown away. */
function cleanDecision(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { dropped: raw === undefined ? 0 : 1 };
  const out = {};
  let dropped = 0;
  for (const [k, v] of Object.entries(raw)) {
    const ok = TOKEN.test(k) && (typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && TOKEN.test(v)));
    if (ok) out[k] = v;
    else dropped += 1;
  }
  return { decision: Object.keys(out).length ? out : undefined, dropped };
}

function cleanMetadata(raw, count = { dropped: 0 }) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const key of METADATA_KEYS) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (key === "decision") {
      const d = cleanDecision(v);
      count.dropped += d.dropped;
      if (d.decision) out.decision = d.decision;
    } else if (key === "status") {
      if (STATUSES.includes(v)) out.status = v;
    } else if (key === "errorCode" || key === "model") {
      if (short(v)) out[key] = v;
    } else if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      out[key] = v;
    }
  }
  return out;
}

/** Strict on structure, forgiving on extras: unknown fields are dropped, never kept. */
function validateEvent(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "not an object" };
  if (!isStr(raw.runId) || !short(raw.runId)) return { ok: false, reason: "missing runId" };
  if (!isStr(raw.ts) || Number.isNaN(Date.parse(raw.ts))) return { ok: false, reason: "missing or bad ts" };
  if (!EVENT_TYPES.includes(raw.type)) return { ok: false, reason: `unknown type: ${String(raw.type)}` };
  const needsNode = raw.type.startsWith("node.") || raw.type === "decision";
  if (needsNode && (!isStr(raw.node) || !short(raw.node))) return { ok: false, reason: "missing node" };
  const count = { dropped: 0 };
  const event = { runId: raw.runId, ts: raw.ts, type: raw.type, metadata: cleanMetadata(raw.metadata, count) };
  if (needsNode) event.node = raw.node;
  if (Number.isInteger(raw.seq) && raw.seq >= 0) event.seq = raw.seq;
  if (isStr(raw.pipeline) && short(raw.pipeline)) event.pipeline = raw.pipeline;
  return { ok: true, event, dropped: count.dropped };
}

function parseJsonl(text) {
  const events = [];
  const rejected = [];
  let dropped = 0;
  String(text).split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    let raw;
    try {
      raw = JSON.parse(line);
    } catch {
      rejected.push({ line: i + 1, reason: "not JSON" });
      return;
    }
    const r = validateEvent(raw);
    if (r.ok) { events.push(r.event); dropped += r.dropped; }
    else rejected.push({ line: i + 1, reason: r.reason });
  });
  return { events, rejected, dropped };
}

/** The values each decision may take on this map: the ones its links test, plus a node's declared `values`. */
function decisionValues(pipeline) {
  const allowed = new Map();
  const add = (k, v) => (allowed.get(k) || allowed.set(k, new Set()).get(k)).add(String(v));
  for (const e of pipeline.edges || []) if (e.when && typeof e.when.decision === "string") add(e.when.decision, e.when.equals);
  for (const n of pipeline.nodes || []) if (typeof n.decides === "string") for (const v of Array.isArray(n.values) ? n.values : []) add(n.decides, v);
  return allowed;
}

/**
 * Second net, with the map in hand: a text value the map does not name becomes "other".
 * The run still routes (it takes the else link) and nothing a person typed can ride along as a "decision".
 */
function scrubDecisions(events, pipeline) {
  const allowed = decisionValues(pipeline);
  let replaced = 0;
  const out = events.map((ev) => {
    const d = ev.metadata && ev.metadata.decision;
    if (!d) return ev;
    const clean = {};
    for (const [k, v] of Object.entries(d)) {
      const known = typeof v !== "string" || BASE_VALUES.has(v.toLowerCase()) || (allowed.get(k) || new Set()).has(v);
      clean[k] = known ? v : "other";
      if (!known) replaced += 1;
    }
    return { ...ev, metadata: { ...ev.metadata, decision: clean } };
  });
  return { events: out, replaced };
}

/** Order by time, then seq, so a replayed file always folds the same way. */
function sortEvents(events) {
  return [...events].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || (a.seq ?? 0) - (b.seq ?? 0));
}

module.exports = { EVENT_TYPES, METADATA_KEYS, validateEvent, parseJsonl, sortEvents, decisionValues, scrubDecisions };
