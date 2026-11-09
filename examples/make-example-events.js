#!/usr/bin/env node
// Writes SYNTHETIC events for the example bot through the real writer. Deterministic: same output every time.
// Includes one step the map does not know ("history-log") so the drift warning has something to show.
const fs = require("fs");
const path = require("path");
const { createTracer, runIdFor } = require("../writers/xpm-trace");

const dir = path.join(__dirname, "events", "example-bot");
fs.rmSync(dir, { recursive: true, force: true });
const t = createTracer({ dir, pipeline: "inbound", previews: true });

// Synthetic messages. Duplicates repeat the message before them.
const TEXTS = [
  "what's the weather tomorrow", "/status", "summarise today's notes", "remind me to water the plants at 6",
  "plan my week around the two deadlines", "/help", "translate this paragraph to Portuguese", "how many tasks are still open",
  "/mode planner", "draft a thank-you note to the team", "what time is it in Tokyo", "find a recipe with lentils and spinach",
];

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (pairs) => {
  let x = rand();
  for (const [v, w] of pairs) if ((x -= w) < 0) return v;
  return pairs[pairs.length - 1][0];
};

const base = Date.parse("2026-11-07T08:00:00Z");
let agentRuns = 0;
for (let i = 0; i < 60; i++) {
  let clock = base + i * 47 * 60000;
  const at = (ms) => new Date((clock += ms)).toISOString();
  const runId = runIdFor(1000 + i, "example");
  const dup = i > 0 && rand() < 0.05;
  const text = TEXTS[(dup ? i - 1 : i) % TEXTS.length];
  const ts0 = at(0);
  t.start(runId, { ts: ts0, sentAt: Math.floor(Date.parse(ts0) / 1000) - 1 });
  t.preview(runId, text, ts0);
  t.node(runId, "receive", { ts: at(5), durationMs: 5 });
  const duplicate = dup ? "yes" : "no";
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
    const fast = text.startsWith("/") ? "yes" : "no";
    t.decide(runId, "fast-path", { fast }, { ts: at(2), durationMs: 2 });
    if (fast === "yes") {
      t.node(runId, "command-reply", { ts: at(40), durationMs: 40 });
    } else {
      if (i % 3 === 0) t.node(runId, "history-log", { ts: at(15), durationMs: 15 });
      const ms = 2500 + Math.round(rand() * 4000);
      agentRuns += 1;
      if (agentRuns === 6 || agentRuns === 24) {
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
