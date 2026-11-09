#!/usr/bin/env node
// Writes SYNTHETIC events for the example bot through the real writer. Deterministic: same output every time.
// Includes one step the map does not know ("history-log") so the drift warning has something to show.
const fs = require("fs");
const path = require("path");
const { createTracer, runIdFor } = require("../writers/xpm-trace");

const dir = path.join(__dirname, "events", "example-bot");
fs.rmSync(dir, { recursive: true, force: true });
const t = createTracer({ dir, pipeline: "inbound" });

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (pairs) => {
  let x = rand();
  for (const [v, w] of pairs) if ((x -= w) < 0) return v;
  return pairs[pairs.length - 1][0];
};

const base = Date.parse("2026-11-07T08:00:00Z");
for (let i = 0; i < 60; i++) {
  let clock = base + i * 47 * 60000;
  const at = (ms) => new Date((clock += ms)).toISOString();
  const runId = runIdFor(1000 + i, "example");
  t.start(runId, { ts: at(0) });
  t.node(runId, "receive", { ts: at(5), durationMs: 5 });
  const duplicate = rand() < 0.05 ? "yes" : "no";
  t.decide(runId, "dedupe", { duplicate }, { ts: at(2), durationMs: 2 });
  if (duplicate === "yes") {
    t.end(runId, { ts: at(1) });
    continue;
  }
  const mode = pick([["normal", 0.8], ["planner", 0.12], ["privacy", 0.08]]);
  t.decide(runId, "mode-gate", { mode }, { ts: at(3), durationMs: 3 });
  if (mode === "planner") {
    t.node(runId, "planner-hold", { ts: at(4), durationMs: 4 });
    t.end(runId, { ts: at(1) });
    continue;
  }
  if (mode === "privacy") {
    const ms = 1800 + Math.round(rand() * 900);
    t.node(runId, "private-model", { ts: at(ms), durationMs: ms, model: "private-small" });
  } else {
    const fast = rand() < 0.25 ? "yes" : "no";
    t.decide(runId, "fast-path", { fast }, { ts: at(2), durationMs: 2 });
    if (fast === "yes") {
      t.node(runId, "command-reply", { ts: at(40), durationMs: 40 });
    } else {
      if (i % 3 === 0) t.node(runId, "history-log", { ts: at(15), durationMs: 15 });
      const ms = 2500 + Math.round(rand() * 4000);
      if (i === 17) {
        t.fail(runId, "agent", { ts: at(ms), durationMs: ms, errorCode: "timeout" });
        t.endFailed(runId, { ts: at(1) });
        continue;
      }
      t.node(runId, "agent", { ts: at(ms), durationMs: ms, model: "big-model", tokens: 900 + Math.round(rand() * 2000) });
    }
  }
  t.node(runId, "reply", { ts: at(120), durationMs: 120 });
  t.end(runId, { ts: at(1) });
}
console.log(`wrote ${fs.readdirSync(dir).length} files to ${dir}`);
