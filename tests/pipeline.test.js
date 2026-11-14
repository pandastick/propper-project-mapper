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

test("lane notes: one short line per known lane, anything else is refused", () => {
  const base = { id: "x", lanes: ["in", "out"], nodes: [{ id: "a", kind: "door", lane: "in" }] };
  assert.deepEqual(xpm.validatePipeline({ ...base, laneNotes: { in: "Takes the message." } }), []);
  assert.ok(pipeline.laneNotes && Object.keys(pipeline.laneNotes).every((l) => pipeline.lanes.includes(l)));
  for (const laneNotes of [["in"], "text", { nowhere: "x" }, { in: "" }, { in: 5 }, { in: "x".repeat(81) }, { in: "two\nlines" }]) {
    assert.ok(xpm.validatePipeline({ ...base, laneNotes }).length > 0, JSON.stringify(laneNotes));
  }
  assert.match(xpm.validatePipeline({ id: "x", nodes: [{ id: "a", kind: "door" }], laneNotes: { in: "x" } }).join(), /unknown lane in/);
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
  assert.equal(o.ghosts.length, 1);
  assert.equal(o.ghosts[0].id, "history-log");
  assert.ok(o.ghosts[0].hits > 0);
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

test("simulate: classifier first", () => {
  const r = xpm.simulate(pipeline, draft, runs);
  assert.equal(r.ok, true);
  const nonDuplicate = runs.filter((x) => x.decisions.duplicate !== "yes").length;
  assert.equal(r.passesNewCount, nonDuplicate);
  assert.ok(r.changedCount > 0 && r.changedCount < runs.length);
  assert.equal(r.medianAddedMs, 350);
  assert.ok(r.perRun.filter((x) => x.changed).every((x) => x.basePath.includes("fast-path")));
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

test("spec export puts the answer first and names the code to change", () => {
  const spec = xpm.draftToSpec(pipeline, draft, xpm.simulate(pipeline, draft, runs));
  const lines = spec.split("\n");
  assert.match(lines[0], /^# Change spec: classifier-first/);
  assert.match(spec, /\*\*Answer:\*\*/);
  assert.match(spec, /src\/door\.js \(isDuplicate\)/);
  assert.doesNotMatch(spec, /—/);
});

test("previews: kept apart, cleaned, cut, and pruned with the events", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xpm-prev-"));
  const t = createTracer({ dir, pipeline: "p", previews: true });
  t.start("r1", { ts: "2026-10-01T00:00:00Z", sentAt: 1759276800 });
  t.preview("r1", "line one\nline two " + "x".repeat(300), "2026-10-01T00:00:00Z");
  t.start("r2", { ts: "2026-11-09T00:00:00Z" });
  t.preview("r2", "hello", "2026-11-09T00:00:00Z");
  const eventsText = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => fs.readFileSync(path.join(dir, f), "utf-8")).join("");
  assert.doesNotMatch(eventsText, /line one|hello/);
  const p = xpm.loadPreviews(dir);
  assert.equal(p.get("r1").length, 120);
  assert.match(p.get("r1"), /^line one line two x+…$/);
  assert.equal(xpm.foldRuns(xpm.loadEvents(dir).events).find((r) => r.runId === "r1").sentAt, 1759276800);
  const gone = xpm.prune(dir, 14, Date.parse("2026-11-09T12:00:00Z"));
  assert.deepEqual(gone.sort(), ["2026-10-01.jsonl", path.join("previews", "2026-10-01.jsonl")].sort());
  assert.equal(xpm.loadPreviews(dir).has("r1"), false);
  assert.equal(xpm.loadPreviews(dir).get("r2"), "hello");
});

test("previews: off by default in the writer", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xpm-off-"));
  createTracer({ dir, pipeline: "p" }).preview("r1", "secret", "2026-11-09T00:00:00Z");
  assert.equal(fs.existsSync(path.join(dir, "previews")), false);
});

test("draft: changed conditions route, are named in the spec, and a missing link is refused", () => {
  const r = xpm.simulate(pipeline, draft, runs);
  assert.equal(r.ok, true);
  const spec = xpm.draftToSpec(pipeline, draft, r);
  assert.match(spec, /Change the link fast-path to command-reply: only when intent is command/);
  for (const text of xpm.loadPreviews(path.join(ROOT, "examples/events/example-bot")).values()) assert.equal(spec.includes(text), false);
  const bad = xpm.simulate(pipeline, { changeEdges: [{ from: "agent", to: "dedupe", when: { decision: "x", equals: "y" } }] }, runs);
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /does not exist/);
});

test("decisions are labels: typed text is dropped on read, and counted", () => {
  const typed = "please book the dentist for friday";
  const r = xpm.validateEvent({ runId: "r1", ts: "2026-11-09T00:00:00Z", type: "decision", node: "n", metadata: { decision: { text: typed, "bad key": "x", mode: "planner", long: "x".repeat(33), fast: true, n: 3 } } });
  assert.deepEqual(r.event.metadata.decision, { mode: "planner", fast: true, n: 3 });
  assert.equal(r.dropped, 3);
  assert.equal(JSON.stringify(r.event).includes("dentist"), false);
});

test("decisions: a value the map does not name is read as other, and the run takes the else link", () => {
  const line = (decision) => JSON.stringify({ runId: "r1", ts: "2026-11-09T00:00:00Z", type: "decision", node: "mode-gate", pipeline: "inbound", metadata: { decision } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xpm-dec-"));
  fs.writeFileSync(path.join(dir, "2026-11-09.jsonl"), [line({ mode: "dentist-friday" }), line({ duplicate: "no", fast: "No" }), line({ mode: "typed words here" })].join("\n"));
  fs.writeFileSync(path.join(dir, "notes.jsonl"), "not a day file\n");
  const r = xpm.loadEvents(dir, "inbound", { pipeline });
  assert.equal(r.rejected.length, 0); // notes.jsonl is not read at all
  assert.equal(r.scrubbed, 2);
  assert.deepEqual(r.events[0].metadata.decision, { mode: "other" });
  assert.deepEqual(r.events[1].metadata.decision, { duplicate: "no", fast: "No" });
  assert.equal(r.events[2].metadata.decision, undefined);
  assert.deepEqual([...xpm.decisionValues(pipeline).get("mode")].sort(), ["normal", "planner", "privacy"]);
  assert.deepEqual(xpm.route(pipeline, { duplicate: "no", mode: "other", fast: "no" }, "r").path, ["receive", "dedupe", "mode-gate", "fast-path", "agent", "reply"]);
});

test("writer: a decision cannot carry a sentence, and an allowlist maps the rest to other", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xpm-wd-"));
  const t = createTracer({ dir, pipeline: "p", decisions: { mode: ["normal", "planner"] } });
  t.decide("r1", "gate", { text: "must not appear", mode: "holiday", fast: true, duplicate: "no" }, { ts: "2026-11-09T00:00:00Z" });
  t.decide("r1", "gate", "must not appear", { ts: "2026-11-09T00:00:01Z" });
  const text = fs.readFileSync(path.join(dir, "2026-11-09.jsonl"), "utf-8");
  assert.doesNotMatch(text, /must not appear|holiday/);
  assert.deepEqual(JSON.parse(text.split("\n")[0]).metadata.decision, { mode: "other", fast: true, duplicate: "no" });
  assert.deepEqual(JSON.parse(text.split("\n")[1]).metadata, {});
});

test("a malformed draft or map is refused with the reason, never thrown", () => {
  const cases = [
    { addNodes: 5 }, { removeEdges: [null] }, { changeEdges: [null] }, { addEdges: ["a"] }, [],
    { addNodes: [{ id: "c", assume: { split: {} } }] }, { addNodes: [{ id: "c", assume: { split: 1, decision: "x" } }] },
    { addNodes: [{ id: "c", assume: { split: { a: 1 } } }] }, { addNodes: [{ assume: {} }] }, { addNodes: [{ id: "c", assume: { latencyMs: "slow" } }] },
  ];
  for (const d of cases) {
    const r = xpm.simulate(pipeline, d, runs);
    assert.equal(r.ok, false, JSON.stringify(d));
    assert.ok(r.errors.length && r.errors.every((e) => typeof e === "string"));
  }
  assert.deepEqual(xpm.validateDraft(draft), []);
  for (const p of [{ id: "x" }, { id: "x", nodes: [{ id: "a", kind: "door" }], edges: 5 }, { id: "x", nodes: [{ id: "a", kind: "door" }], edges: [null] }, { id: "x", nodes: [{ id: "a", kind: "door", values: ["two words"] }] }]) {
    assert.ok(xpm.validatePipeline(p).length > 0, JSON.stringify(p));
    assert.equal(xpm.simulate(p, {}, []).ok, false);
  }
});

test("check: a symbol that is not all word characters is still found, whole names only", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xpm-sym-"));
  fs.writeFileSync(path.join(root, "a.js"), "const $fn = 1;\nhandle.inbound = () => {};\nfunction rerun() {}\n");
  const node = (symbol) => ({ id: symbol, kind: "door", anchor: { repo: "r", path: "a.js", symbol } });
  const p = { id: "p", nodes: ["$fn", "handle.inbound", "rerun", "run", "fn", "inbound"].map(node), edges: [] };
  assert.deepEqual(xpm.checkAnchors(p, { r: root }).map((a) => a.status), ["ok", "ok", "ok", "missing-symbol", "missing-symbol", "ok"]);
});
