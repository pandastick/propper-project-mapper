// XPM execution events: one JSON object per line (JSONL), one line per hop.
// Envelope shape inspired by AgentFlow Visualization (MIT), cut down on purpose:
// events carry WHICH node ran and WHAT it decided, never the message itself.

const EVENT_TYPES = ["run.started", "node.started", "node.completed", "node.failed", "decision", "run.completed", "run.failed"];
const STATUSES = ["success", "failed", "skipped", "waiting"];
// Anything outside this list is dropped, so a careless writer cannot leak content into the file.
// sentAt: when the channel received the message (Unix seconds). A time, not content.
const METADATA_KEYS = ["decision", "durationMs", "status", "errorCode", "attempt", "model", "tokens", "costUsd", "sentAt"];
const MAX_STRING = 120;

const isStr = (v) => typeof v === "string" && v.length > 0;
const short = (v) => typeof v === "string" && v.length <= MAX_STRING;

function cleanDecision(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!short(k)) continue;
    if (short(v) || typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function cleanMetadata(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const key of METADATA_KEYS) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (key === "decision") {
      const d = cleanDecision(v);
      if (d) out.decision = d;
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
  const event = { runId: raw.runId, ts: raw.ts, type: raw.type, metadata: cleanMetadata(raw.metadata) };
  if (needsNode) event.node = raw.node;
  if (Number.isInteger(raw.seq) && raw.seq >= 0) event.seq = raw.seq;
  if (isStr(raw.pipeline) && short(raw.pipeline)) event.pipeline = raw.pipeline;
  return { ok: true, event };
}

function parseJsonl(text) {
  const events = [];
  const rejected = [];
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
    if (r.ok) events.push(r.event);
    else rejected.push({ line: i + 1, reason: r.reason });
  });
  return { events, rejected };
}

/** Order by time, then seq, so a replayed file always folds the same way. */
function sortEvents(events) {
  return [...events].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || (a.seq ?? 0) - (b.seq ?? 0));
}

module.exports = { EVENT_TYPES, METADATA_KEYS, validateEvent, parseJsonl, sortEvents };
