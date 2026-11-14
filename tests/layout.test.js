// The layout is pure (no DOM), so Node can check where every card and line lands.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const L = require("../public/pipeline-layout.js");

const { NODE_W, NODE_H, COL } = L;
const example = JSON.parse(fs.readFileSync(path.join(__dirname, "../manifests/example-bot.json"), "utf-8")).pipelines[0];

// A long synthetic pipeline: 26 steps in 5 lanes (5, 8, 5, 5, 3), one chain plus the links that make layouts hard.
function longPipeline() {
  const sizes = { intake: 5, sort: 8, checks: 5, think: 5, send: 3 };
  const nodes = [];
  for (const [lane, n] of Object.entries(sizes)) for (let i = 1; i <= n; i++) nodes.push({ id: `${lane}-${i}`, name: `${lane} ${i}`, kind: "tool", lane });
  const edges = nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id }));
  edges.push(
    { from: "intake-2", to: "checks-3" }, // skips a lane, two rows down
    { from: "think-4", to: "intake-1" }, // backward, up to the first row
    { from: "sort-1", to: "sort-4" }, // long line inside a row, level with the cards between
    { from: "sort-2", to: "think-1" }, // two lines out of one column gap
    { from: "sort-2", to: "checks-1" },
    { from: "checks-5", to: "send-2" }, // lands in a row its lane shares with another lane
    { from: "send-3", to: "send-3" } // a step that loops on itself
  );
  return { id: "long", entry: "intake-1", lanes: Object.keys(sizes), nodes, edges };
}

const cards = (lay) => [...lay.xy.entries()].map(([id, c]) => ({ id, ...c }));
function overlaps(lay) {
  const list = cards(lay), bad = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (a.x < b.x + NODE_W && b.x < a.x + NODE_W && a.y < b.y + NODE_H && b.y < a.y + NODE_H) bad.push(`${a.id} on ${b.id}`);
  }
  return bad;
}
// The corner points of a line made of straight parts (M, L and the rounded Q corners). Null for a curved line.
function points(d) {
  if (/C/.test(d)) return null;
  const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
  const cmds = d.match(/[MLQ]/g);
  const out = [];
  let i = 0;
  for (const c of cmds) for (let k = 0; k < (c === "Q" ? 2 : 1); k++) { out.push([nums[i], nums[i + 1]]); i += 2; }
  return out;
}
// Every straight part of every stepped line, checked against the inside of every card.
function linesThroughCards(lay) {
  const bad = [];
  for (const [key, route] of lay.routes) {
    const pts = points(route.d);
    if (!pts) continue;
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
      assert.ok(Math.abs(x1 - x2) < 0.01 || Math.abs(y1 - y2) < 0.01, `${key}: a part is neither level nor upright`);
      for (const c of cards(lay)) {
        const inX = Math.max(x1, x2) > c.x + 1 && Math.min(x1, x2) < c.x + NODE_W - 1;
        const inY = Math.max(y1, y2) > c.y + 1 && Math.min(y1, y2) < c.y + NODE_H - 1;
        if (inX && inY) bad.push(`${key} through ${c.id}`);
      }
    }
  }
  return bad;
}
const everyFinite = (lay) => cards(lay).every((c) => Number.isFinite(c.x) && Number.isFinite(c.y)) && [...lay.routes.values()].every((r) => r && !/NaN|undefined|Infinity/.test(r.d) && Number.isFinite(r.cx) && Number.isFinite(r.cy));

test("a short pipeline keeps its lanes side by side", () => {
  for (const wrapAt of [undefined, 2200]) {
    const lay = L.layout(example, { wrapAt });
    assert.equal(lay.wrapped, false);
    assert.equal(lay.rows, 1);
    assert.equal(lay.xy.size, example.nodes.length);
    assert.deepEqual([...new Set(lay.bands.map((b) => b.top))], [16]);
    assert.deepEqual(lay.bands.map((b) => b.name), example.lanes);
    assert.deepEqual(overlaps(lay), []);
    assert.ok(everyFinite(lay));
  }
});

test("a short pipeline wraps only when the window is narrower than the map", () => {
  const flat = L.layout(example);
  assert.equal(L.layout(example, { wrapAt: flat.width }).wrapped, false);
  const lay = L.layout(example, { wrapAt: flat.width - 1 });
  assert.equal(lay.wrapped, true);
  assert.ok(lay.rows > 1 && lay.width < flat.width);
  assert.deepEqual(overlaps(lay), []);
  assert.deepEqual(linesThroughCards(lay), []);
});

test("a long pipeline is one strip when nothing asks it to wrap", () => {
  const lay = L.layout(longPipeline());
  assert.equal(lay.wrapped, false);
  assert.equal(lay.width, 40 + 25 * COL + NODE_W + 40); // 6,424 px: the strip the wrap is there to avoid
  assert.deepEqual(overlaps(lay), []);
});

test("a long pipeline wraps its lanes into rows that fit the window", () => {
  const p = longPipeline();
  const lay = L.layout(p, { wrapAt: 2200 });
  assert.equal(lay.wrapped, true);
  assert.equal(lay.rows, 4); // intake | sort | checks | think + send: short lanes share a row
  assert.ok(lay.width <= 2200, `width ${lay.width}`);
  assert.equal(lay.xy.size, 26);
  assert.deepEqual(overlaps(lay), []);
  assert.ok(everyFinite(lay));
  const band = Object.fromEntries(lay.bands.map((b) => [b.name, b]));
  assert.deepEqual(Object.keys(band), p.lanes);
  assert.ok(band.intake.top < band.sort.top && band.sort.top < band.checks.top && band.checks.top < band.think.top);
  assert.equal(band.think.top, band.send.top);
  assert.ok(band.send.left >= band.think.left + band.think.width, "lanes that share a row do not overlap");
  // every card sits inside its lane's box, and inside the drawing
  for (const b of lay.bands) for (const id of b.ids) {
    const c = lay.xy.get(id);
    assert.ok(c.x >= b.left && c.x + NODE_W <= b.left + b.width && c.y >= b.top && c.y + NODE_H <= b.top + b.height, `${id} is outside ${b.name}`);
    assert.ok(c.x >= 0 && c.x + NODE_W <= lay.width && c.y + NODE_H <= lay.height, `${id} is outside the drawing`);
  }
  // each row starts again at the left, and a plain chain stays level after the wrap
  for (const name of ["intake", "sort", "checks", "think"]) assert.equal(lay.xy.get(`${name}-1`).x, lay.xy.get("intake-1").x);
  assert.equal(new Set(["checks-1", "checks-2", "checks-3", "checks-4", "checks-5"].map((id) => lay.xy.get(id).y)).size, 1);
});

test("lines between rows never pass through a card", () => {
  const lay = L.layout(longPipeline(), { wrapAt: 2200 });
  assert.deepEqual(linesThroughCards(lay), []);
  // the hard ones really are stepped lines, so the check above looked at them
  for (const key of ["intake-5->sort-1", "intake-2->checks-3", "think-4->intake-1", "sort-2->think-1", "sort-2->checks-1"]) assert.ok(points(lay.routes.get(key).d), key);
});

test("two lines out of one column gap do not lie on top of each other", () => {
  // b1 and b2 sit one above the other; both send a line down to the next row.
  const p = { lanes: ["one", "two"], nodes: [["a", "one"], ["b1", "one"], ["b2", "one"], ["c", "two"], ["d", "two"]].map(([id, lane]) => ({ id, kind: "tool", lane })), edges: [{ from: "a", to: "b1" }, { from: "a", to: "b2" }, { from: "b1", to: "c" }, { from: "b2", to: "d" }, { from: "c", to: "d" }] };
  const lay = L.layout(p, { wrapAt: 300 });
  assert.equal(lay.rows, 2);
  assert.equal(lay.xy.get("b1").x, lay.xy.get("b2").x);
  const one = points(lay.routes.get("b1->c").d), two = points(lay.routes.get("b2->d").d);
  assert.notEqual(one[1][0], two[1][0], "the upright parts are side by side");
  assert.notEqual(lay.routes.get("b1->c").cy, lay.routes.get("b2->d").cy, "the level parts are on their own tracks");
  assert.deepEqual(linesThroughCards(lay), []);
  // two lines from the same card may share their start, but their labels are apart
  const long = L.layout(longPipeline(), { wrapAt: 2200 });
  const x = long.routes.get("sort-2->think-1"), y = long.routes.get("sort-2->checks-1");
  assert.ok(Math.abs(x.cx - y.cx) >= 100 || Math.abs(x.cy - y.cy) >= 8, "labels of two lines from one card are apart");
});

test("a long line inside a row steps around the cards in its way", () => {
  for (const wrapAt of [undefined, 2200]) {
    const lay = L.layout(longPipeline(), { wrapAt });
    const pts = points(lay.routes.get("sort-1->sort-4").d);
    assert.ok(pts, "a stepped line, not a straight one behind the cards");
    const y = lay.xy.get("sort-2").y;
    assert.ok(pts.some(([, py]) => py > y + NODE_H || py < y), "it leaves the cards' level");
    assert.deepEqual(linesThroughCards(lay), []);
  }
});

test("rowPath keeps the plain line when nothing is in the way", () => {
  const a = { x: 0, y: 0 }, b = { x: COL * 2, y: 0 };
  assert.deepEqual(L.rowPath(a, b, []), L.edgePath(a, b));
  assert.deepEqual(L.rowPath(a, b, [{ x: COL, y: 300 }]), L.edgePath(a, b));
  assert.notDeepEqual(L.rowPath(a, b, [{ x: COL, y: 0 }]), L.edgePath(a, b));
});

test("loops finish and place every card", () => {
  const p = { id: "loop", entry: "a", lanes: ["one", "two"], nodes: ["a", "b", "c", "d"].map((id, i) => ({ id, kind: "tool", lane: i < 2 ? "one" : "two" })), edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "d" }, { from: "d", to: "a" }, { from: "b", to: "b" }, { from: "c", to: "a" }] };
  for (const wrapAt of [undefined, 300]) {
    const lay = L.layout(p, { wrapAt });
    assert.equal(lay.xy.size, 4);
    assert.equal(lay.routes.size, 6);
    assert.deepEqual(overlaps(lay), []);
    assert.ok(everyFinite(lay));
  }
});

test("cards with no lane, an unknown lane or no links are still placed", () => {
  const nodes = [{ id: "a", kind: "tool", lane: "one" }, { id: "b", kind: "tool" }, { id: "c", kind: "tool", lane: "not-a-lane" }, { id: "d", kind: "tool", lane: "two" }];
  for (const wrapAt of [undefined, 300]) {
    const lay = L.layout({ lanes: ["one", "two"], nodes, edges: [{ from: "a", to: "nowhere" }, { from: "ghost", to: "d" }] }, { wrapAt });
    assert.equal(lay.xy.size, 4);
    assert.equal(lay.routes.size, 0, "a link to a step that is not there is left out");
    assert.deepEqual(overlaps(lay), []);
    assert.ok(everyFinite(lay));
  }
});

test("no lanes, one lane, no steps", () => {
  const nodes = ["a", "b", "c"].map((id) => ({ id, kind: "tool" }));
  const none = L.layout({ nodes, edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }] }, { wrapAt: 100 });
  assert.equal(none.wrapped, false);
  assert.deepEqual(none.bands, []);
  assert.deepEqual(overlaps(none), []);

  const one = L.layout({ lanes: ["only"], nodes: nodes.map((n) => ({ ...n, lane: "only" })), edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }] }, { wrapAt: 100 });
  assert.equal(one.wrapped, false, "one lane has nothing to wrap");
  assert.equal(one.bands.length, 1);

  const stacked = L.layout({ nodes });
  assert.deepEqual(overlaps(stacked), []);
  assert.equal(new Set(cards(stacked).map((c) => c.x)).size, 1);

  for (const p of [{}, { nodes: [] }, { nodes: null, edges: [{ from: "a", to: "b" }] }]) {
    const empty = L.layout(p, { wrapAt: 100 });
    assert.equal(empty.xy.size, 0);
    assert.ok(empty.width > 0 && empty.height > 0);
    assert.deepEqual(empty.bands, []);
  }
});

test("the lens folds a lane into one card", () => {
  const p = longPipeline();
  p.edges.find((e) => e.from === "intake-5" && e.to === "sort-1").when = { decision: "kind", equals: "text" };
  const all = L.foldLanes(p, new Set());
  assert.deepEqual(all.nodes.map((n) => n.id), p.lanes.map((l) => `lane:${l}`));
  assert.deepEqual(all.nodes[1].members.length, 8);
  assert.equal(all.entry, "lane:intake");
  assert.ok(all.edges.every((e) => e.from !== e.to && !e.when), "no self links, and a folded step's condition is not shown");
  assert.equal(new Set(all.edges.map((e) => `${e.from}->${e.to}`)).size, all.edges.length);

  const open = L.foldLanes(p, new Set(["intake"]));
  assert.equal(open.nodes.filter((n) => n.lane === "intake").length, 5);
  assert.deepEqual(open.edges.find((e) => e.from === "intake-5" && e.to === "lane:sort").when, { decision: "kind", equals: "text" });
  // a second link to the same card takes the condition away: the card is reached either way
  p.edges.push({ from: "intake-5", to: "sort-3" });
  assert.equal(L.foldLanes(p, new Set(["intake"])).edges.find((e) => e.from === "intake-5" && e.to === "lane:sort").when, undefined);

  assert.equal(L.foldLanes(p, new Set(p.lanes)), p, "every lane open: the pipeline as it is");
  const folded = L.layout(L.foldLanes(p, new Set()), { wrapAt: 2200 });
  assert.equal(folded.wrapped, false, "five lane cards fit without a wrap");
});

test("the page loads the layout before the view", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/pipeline.html"), "utf-8");
  assert.ok(html.indexOf("pipeline-layout.js") > 0 && html.indexOf("pipeline-layout.js") < html.indexOf("pipeline.js\""));
});
