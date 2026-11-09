// XPM trace writer for Node and TypeScript projects. Copy this file in; it has no dependencies.
// One JSONL line per hop, appended to <dir>/<YYYY-MM-DD>.jsonl.
// Privacy: only ids, decisions and timings. Never pass message text, user ids or tokens.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const KEYS = ["decision", "durationMs", "status", "errorCode", "attempt", "model", "tokens", "costUsd"];

/** Hash an upstream id (for example a Telegram update_id) so the raw id never lands on disk. */
function runIdFor(upstreamId, salt) {
  return crypto.createHash("sha256").update(`${salt}:${upstreamId}`).digest("hex").slice(0, 16);
}

function createTracer({ dir, pipeline, enabled = true }) {
  if (enabled) fs.mkdirSync(dir, { recursive: true });
  const seqs = new Map();
  function emit(runId, type, node, metadata = {}) {
    if (!enabled) return;
    try {
      const meta = {};
      for (const k of KEYS) if (metadata[k] !== undefined) meta[k] = metadata[k];
      const seq = (seqs.get(runId) || 0) + 1;
      seqs.set(runId, seq);
      if (seqs.size > 5000) seqs.delete(seqs.keys().next().value);
      const ts = metadata.ts || new Date().toISOString();
      const line = JSON.stringify({ runId, ts, seq, pipeline, type, ...(node ? { node } : {}), metadata: meta });
      // One small appendFileSync per line: O_APPEND keeps lines whole on a local disk.
      fs.appendFileSync(path.join(dir, `${ts.slice(0, 10)}.jsonl`), line + "\n");
    } catch {
      // Tracing must never break the product.
    }
  }
  return {
    start: (runId, m) => emit(runId, "run.started", null, m),
    node: (runId, node, m) => emit(runId, "node.completed", node, m),
    fail: (runId, node, m) => emit(runId, "node.failed", node, m),
    decide: (runId, node, decision, m = {}) => emit(runId, "decision", node, { ...m, decision }),
    end: (runId, m) => emit(runId, "run.completed", null, m),
    endFailed: (runId, m) => emit(runId, "run.failed", null, m),
  };
}

module.exports = { createTracer, runIdFor };
