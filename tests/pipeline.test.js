const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const xpm = require("../lib/pipeline");
const { createTracer, runIdFor } = require("../writers/xpm-trace");

const ROOT = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifests/example-bot.json"), "utf-8"));
const pipeline = manifest.pipelines[0];
const draft = JSON.parse(fs.readFileSync(path.join(ROOT, "examples/drafts/example-bot-classifier-first.json"), "utf-8"));
const runs = xpm.foldRuns(xpm.loadEvents(path.join(ROOT, "examples/events/example-bot"), "inbound").events);
const NOW = Date.parse("2026-11-09T12:00:00Z");

test("example pipeline is valid", () => {
  assert.deepEqual(xpm.validatePipeline(pipeline), []);
});

test("schema catches broken edges, kinds and conditions", () => {
  const bad = { id: "x", nodes: [{ id: "a", kind: "door" }, { id: "a", kind: "wizard" }], edges: [{ from: "a", to: "zz" }, { from: "a", to: "a", when: { decision: "m" } }] };
  const errors = xpm.validatePipeline(bad).join("\n");
  assert.match(errors, /duplicate node a/);
  assert.match(errors, /unknown kind wizard/);
  assert.match(errors, /edge to unknown node zz/);
  assert.match(errors, /when needs decision and equals/);
});

test("events: content and unknown keys never survive validation", () => {
  const r = xpm.validateEvent({ runId: "r1", ts: "2026-11-09T00:00:00Z", type: "node.completed", node: "agent", text: "hello", metadata: { durationMs: 5, input: "secret message", decision: { mode: "x", blob: { nested: 1 } } } });
  assert.equal(r.ok, true);
  assert.equal("text" in r.event, false);
  assert.deepEqual(r.event.metadata, { durationMs: 5, decision: { mode: "x" } });
});

test("events: bad lines are rejected with a reason, good ones kept", () => {
  const { events, rejected } = xpm.parseJsonl('{"runId":"a","ts":"2026-11-09T00:00:00Z","type":"run.started"}\nnot json\n{"runId":"a","ts":"x","type":"run.started"}\n{"runId":"a","ts":"2026-11-09T00:00:00Z","type":"node.started"}\n');
  assert.equal(events.length, 1);
  assert.deepEqual(rejected.map((r) => r.reason), ["not JSON", "missing or bad ts", "missing node"]);
});

test("overlay: hits, failures, ghosts and unmapped hops", () => {
  const o = xpm.overlay(pipeline, runs, { now: NOW });
  assert.equal(o.runCount, 60);
  assert.equal(o.nodes.receive.hits, 60);
  assert.equal(o.nodes.agent.state, "failing");
  assert.deepEqual(o.ghosts, [{ id: "history-log", hits: 15 }]);
  assert.ok(o.unmapped.some((u) => u.pair === "fast-path->history-log"));
});

test("overlay: a node nobody reached in 14 days goes cold", () => {
  const later = Date.parse("2026-12-01T00:00:00Z");
  assert.equal(xpm.overlay(pipeline, runs, { now: later }).nodes.receive.state, "cold");
});

test("route: the map replays every recorded run exactly", () => {
  const r = xpm.simulate(pipeline, { addNodes: [] }, runs);
  assert.equal(r.mapFidelity, 1);
  assert.equal(r.changedCount, 0);
});

test("route: conditional edges win, plain edges are the else", () => {
  assert.deepEqual(xpm.route(pipeline, { duplicate: "no", mode: "privacy" }, "r").path, ["receive", "dedupe", "mode-gate", "private-model", "reply"]);
  assert.deepEqual(xpm.route(pipeline, { duplicate: "no", mode: "normal", fast: "no" }, "r").path, ["receive", "dedupe", "mode-gate", "fast-path", "agent", "reply"]);
  assert.deepEqual(xpm.route(pipeline, { duplicate: "yes" }, "r").path, ["receive", "dedupe"]);
});

test("simulate: classifier first, smalltalk skips the mode gate", () => {
  const r = xpm.simulate(pipeline, draft, runs);
  assert.equal(r.ok, true);
  assert.equal(r.passesNewCount, 55);
  const small = r.outcomes["intent-classifier: intent=smalltalk"];
  assert.equal(r.changedCount, small);
  assert.equal(r.trafficDelta["mode-gate"], -small);
  assert.equal(r.medianAddedMs, 350);
});

test("simulate: same input, same answer", () => {
  assert.deepEqual(xpm.simulate(pipeline, draft, runs).outcomes, xpm.simulate(pipeline, draft, runs).outcomes);
});

test("simulate: a broken draft is refused, the map is untouched", () => {
  const before = JSON.stringify(pipeline);
  const r = xpm.simulate(pipeline, { addEdges: [{ from: "nowhere", to: "reply" }] }, runs);
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(pipeline), before);
});

test("check: anchors pass on the example, fail on a moved symbol and on path escapes", () => {
  const repos = { example: path.join(ROOT, "examples/example-bot") };
  assert.ok(xpm.checkAnchors(pipeline, repos).every((a) => a.status === "ok"));
  const broken = JSON.parse(JSON.stringify(pipeline));
  broken.nodes[0].anchor.symbol = "renamedAway";
  broken.nodes[1].anchor.path = "../../../package.json";
  const res = xpm.checkAnchors(broken, repos);
  assert.equal(res[0].status, "missing-symbol");
  assert.equal(res[1].status, "missing-file");
  assert.equal(xpm.checkAnchors(pipeline, {})[0].status, "no-repo");
});

test("writer: lines are valid events and carry no raw upstream id", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xpm-"));
  const t = createTracer({ dir, pipeline: "p" });
  const id = runIdFor(123456789, "salt");
  t.start(id, { ts: "2026-11-09T00:00:00Z" });
  t.decide(id, "gate", { mode: "on" }, { ts: "2026-11-09T00:00:01Z", text: "must not appear" });
  const text = fs.readFileSync(path.join(dir, "2026-11-09.jsonl"), "utf-8");
  assert.doesNotMatch(text, /123456789|must not appear/);
  const { events, rejected } = xpm.parseJsonl(text);
  assert.equal(rejected.length, 0);
  assert.deepEqual(events[1].metadata.decision, { mode: "on" });
});

test("spec export is ADHD shaped and names the code to change", () => {
  const spec = xpm.draftToSpec(pipeline, draft, xpm.simulate(pipeline, draft, runs));
  const lines = spec.split("\n");
  assert.match(lines[0], /^# Change spec: Classifier before everything/);
  assert.match(spec, /\*\*Answer:\*\*/);
  assert.match(spec, /src\/door\.js \(isDuplicate\)/);
  assert.doesNotMatch(spec, /—/);
});
