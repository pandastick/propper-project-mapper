// Click checks for the pipeline page: a real (headless) browser taps through Map, Runs and Draft.
// Run with `npm run test:click`. Needs Chromium on the machine (or CHROMIUM=/path/to/it); nothing to install.
// It starts its own XPM on a free port with the example bot plus three small fixtures made on the spot:
// edge-bot (a run that only just started, an unreadable line, a decision that is not a label),
// broken-bot (a map the engine refuses) and noname-bot (a project without a name).
// SHOTS=/some/folder also saves screenshots there.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findBrowser, freePort, open, sleep } from "./browser.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const bin = findBrowser();
if (!bin) { console.error("No Chromium found. Install one or set CHROMIUM=/path/to/chromium."); process.exit(2); }

// ---------- fixtures ----------
const tmp = mkdtempSync(path.join(os.tmpdir(), "xpm-click-data-"));
const example = JSON.parse(readFileSync(path.join(root, "manifests/example-bot.json"), "utf-8"));
const variant = (id, change) => { const m = JSON.parse(JSON.stringify(example)); m.id = id; m.name = id; change(m); mkdirSync(path.join(tmp, "manifests"), { recursive: true }); writeFileSync(path.join(tmp, "manifests", `${id}.json`), JSON.stringify(m)); };
variant("edge-bot", () => {});
variant("broken-bot", (m) => { m.pipelines[0].nodes[1].kind = "wizard"; m.pipelines[0].edges.push({ from: "receive", to: "nowhere" }); });
variant("noname-bot", (m) => { delete m.name; });
const at = (agoMs) => new Date(Date.now() - agoMs).toISOString();
const line = (runId, agoMs, seq, type, node, metadata = {}) => JSON.stringify({ runId, ts: at(agoMs), seq, pipeline: "inbound", type, ...(node ? { node } : {}), metadata });
mkdirSync(path.join(tmp, "events/edge-bot"), { recursive: true });
writeFileSync(path.join(tmp, "events/edge-bot", `${at(20000).slice(0, 10)}.jsonl`), [
  line("done000000000001", 20000, 1, "run.started"),
  line("done000000000001", 19990, 2, "node.completed", "receive", { durationMs: 5 }),
  line("done000000000001", 19980, 3, "decision", "dedupe", { decision: { duplicate: "a-word-the-map-does-not-name" }, durationMs: 2 }),
  line("done000000000001", 19970, 4, "run.completed"),
  "this line is not JSON",
  line("fresh00000000002", 5000, 1, "run.started"),
].join("\n") + "\n");

// ---------- the app and the browser ----------
const port = await freePort();
const server = spawn(process.execPath, ["server.js"], { cwd: root, stdio: "ignore", env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", MANIFESTS_DIR: [path.join(root, "manifests"), path.join(tmp, "manifests")].join(path.delimiter), XPM_EVENTS_DIR: path.join(tmp, "events"), XPM_DRAFTS_DIR: path.join(tmp, "drafts"), XPM_PROJECTS: path.join(tmp, "no-profiles.json"), XPM_ALLOWED_LOGINS: "", XPM_ALLOWED_NODES: "", XPM_DENIED_NODES: "", XPM_ALLOWED_HOSTS: "" } });
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/projects`)).ok) break; } catch { await sleep(150); } }
const b = await open(bin);

const out = [];
const check = (name, ok) => out.push(`${ok ? "PASS" : "FAIL"} ${name}`);
const page = (project, view, extra = "") => `${base}/pipeline.html?project=${project}&pipeline=inbound&view=${view}${extra}`;
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const count = (sel) => b.ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const shot = async (name) => { if (process.env.SHOTS) { mkdirSync(process.env.SHOTS, { recursive: true }); await b.shot(path.join(process.env.SHOTS, `${name}.png`)); } };
const stepText = () => b.text(".scrub .row span");

try {
  // ---------- Map ----------
  await b.go(page("example-bot", "map"));
  check("map shows 9 steps", (await count(".node")) === 9);
  check("anchor check ok", (await b.text(".status")).includes("9 of 9 anchors ok"));
  check("a short map keeps its lanes side by side", (await b.ev(`new Set([...document.querySelectorAll(".band")].map((x) => x.style.top)).size`)) === 1);
  await b.click(q('.node[data-arg="agent"]'));
  check("a step opens its detail panel", (await b.text(".side")).includes("src/agent.js"));
  check("the panel shows the function", (await b.text(".side")).includes("runAgent"));
  await b.click(q('[data-act="close-panel"]'));
  check("the panel closes", (await count(".side")) === 0);
  await b.click(q('[data-act="menu"][data-arg="project"]'));
  check("the project menu opens", (await count('.menu [data-act="set-project"]')) > 0);
  check("a project with no name is listed and sorted without an error", (await b.text(".menu")).includes("noname-bot"));
  await b.click("document.body");
  check("the menu closes on an outside tap", (await count(".menu")) === 0);
  await shot("map-1440");

  // ---------- colour says what a step is for ----------
  const fam = (id) => b.ev(`[...document.querySelector('.node[data-arg="${id}"]').classList].find((c) => c.startsWith("f-"))`);
  check("every step card carries its family colour", (await count('.node[class*=" f-"]')) === 9);
  check("a door is in / out, a gate a decision, a model AI, a tool an action, a queue storage", JSON.stringify([await fam("receive"), await fam("dedupe"), await fam("agent"), await fam("command-reply"), await fam("planner-hold")]) === '["f-io","f-decide","f-ai","f-act","f-keep"]');
  check("the stripe and the kind word take the colour, and five families give five colours", (await b.ev(`new Set(["receive", "dedupe", "agent", "command-reply", "planner-hold"].map((id) => { const n = document.querySelector('.node[data-arg="' + id + '"]'); const c = getComputedStyle(n, "::before").backgroundColor; return c === getComputedStyle(n.querySelector(".k")).color ? c : "differs"; })).size`)) === 5);
  check("the key names the five families on this map", (await count('.key [data-act="kind"]')) === 5 && (await b.text(".key")).replace(/\s+/g, " ").includes("In / out Decision AI Action Storage"));
  await b.click(q('[data-act="kind"][data-arg="ai"]'));
  check("tapping AI in the key fades the other seven steps", (await count(".node.faded")) === 7 && (await count('.node.f-ai:not(.faded)')) === 2 && (await b.ev(`${q('[data-act="kind"][data-arg="ai"]')}.getAttribute("aria-pressed")`)) === "true");
  await shot("map-one-family");
  await b.click(q('[data-act="kind"][data-arg="ai"]'));
  check("tapping it again brings every step back", (await count(".node.faded")) === 0);
  check("every line ends in an arrowhead that is defined", await b.ev(`(() => { const svg = document.querySelector(".stage svg"); const lines = [...svg.querySelectorAll(":scope > path")]; return lines.length >= 9 && lines.every((l) => { const m = /#([^)"]+)/.exec(l.getAttribute("marker-end") || ""); return m && svg.querySelector("marker#" + m[1]); }); })()`));
  check("a line out of a decision reads only the answer, the full rule is in its title", await b.ev(`[...document.querySelectorAll(".chip")].some((c) => c.innerText.trim() === "no" && c.title === "duplicate = no")`));
  check("the first step says start and a step nothing follows says end", (await b.text('.node[data-arg="receive"] .flag')).trim() === "start" && (await b.text('.node[data-arg="reply"] .flag')).trim() === "end");
  check("the lanes are numbered in reading order", (await b.ev(`[...document.querySelectorAll(".band-h .no")].map((x) => x.innerText).join("")`)) === "123");
  await b.go(page("noname-bot", "map"));
  check('a project with no run on record does not say "0 hits"', (await count(".node")) === 9 && !(await b.text(".stage")).includes("hits"));
  await b.go(page("example-bot", "map"));

  // ---------- Runs ----------
  await b.click(q('[data-act="view"][data-arg="runs"][data-filter="ghost"]'), 300);
  check("the ghost strip goes to Runs with the Ghost filter", (await b.text('[data-act="filter"][aria-pressed="true"]')).startsWith("Ghost"));
  check("the url carries the view", (await b.ev("location.search")).includes("view=runs"));
  await b.click(q('[data-act="filter"][data-arg="failed"]'));
  check("the failed filter shows a failed run", (await count(".run")) >= 1 && (await b.text(".strip")).includes("failed at step"));
  await b.click(q('[data-act="filter"][data-arg="all"]'));
  await b.click('document.querySelectorAll(".run")[2]');
  check("picking a run puts it in the url", (await b.ev("location.search")).includes("run="));
  const before = await stepText();
  await b.click(q('[aria-label="Previous step"]'));
  check("previous step moves the scrubber", before !== (await stepText()));
  await b.click(q('.step[data-arg="0"]'));
  check("a step button jumps to step 1", (await stepText()).startsWith("Step 1 of"));
  await b.click(q('.node.path[data-act="step"]'));
  check("tapping a step on the path selects it", (await stepText()).startsWith("Step 1 of"));
  await shot("runs-1440");

  // ---------- Draft ----------
  await b.go(page("example-bot", "runs", "&run=6dcf6b12"));
  check("a link to a run picks that run", (await b.text(".strip")).includes("6dcf6b12"));
  check("the ghost step is drawn", (await count(".node.ghost")) === 1);
  await b.click(q('[data-act="ghost-draft"]'), 1200);
  check("a ghost step becomes a draft", (await b.text(".strip")).includes("add-history-log"));
  check("the ghost draft is replayed", (await b.text(".result")).includes("runs change route"));
  check("an unsaved draft says Discard", (await b.text(".strip")).includes("Discard draft"));
  await b.click(q('[data-act="discard"]'), 300);
  check("discard leaves the draft list", (await b.text("main")).includes("Open a draft"));
  await b.click(q('[data-act="open-draft"]'), 1200);
  check("a saved draft opens and replays", (await b.text(".result .verdict")).includes("runs change route"));
  await shot("draft-1440");
  const see = await b.text('[data-act="see-changed"]');
  await b.click(q('[data-act="see-changed"]'), 300);
  const seg = await b.text('[data-act="filter"][aria-pressed="true"]');
  check(`"${see}" opens Runs on "${seg}"`, seg.startsWith("Changed") && see.includes(seg.replace("Changed ", "")));
  await b.click(q('[data-act="rail"][data-arg="0"]'));
  check("the rail closes and a Show runs button appears", (await count("aside")) === 0 && (await count('[data-act="rail"][data-arg="1"]')) === 1);
  const pct = parseInt(await b.text(".pct"), 10);
  await b.click(q('[data-act="zoom"][data-arg="1"]'));
  check("zoom in raises the percent", parseInt(await b.text(".pct"), 10) > pct);
  const small = await b.ev(`[...document.querySelectorAll("button")].filter((x) => x.offsetParent && !x.classList.contains("node") && x.getBoundingClientRect().height < 42).map((x) => (x.getAttribute("aria-label") || x.innerText).slice(0, 30))`);
  check(`every control is at least 42 px tall ${JSON.stringify(small)}`, small.length === 0);
  check("no touchmove handler in the page code (it would cancel Pencil taps)", !(await b.ev(`Promise.all(["/pipeline.js", "/pipeline-layout.js"].map((f) => fetch(f).then((r) => r.text()))).then((t) => t.some((x) => /addEventListener\\(\\s*["']touchmove/.test(x) || /ontouchmove/.test(x)))`)));

  // ---------- one draft link, one replay ----------
  await b.go(page("example-bot", "map"));
  await b.ev(`(() => { window.__posts = 0; const f = window.fetch; window.fetch = (u, o) => { if (o && o.method === "POST") window.__posts += 1; return f(u, o); }; })()`);
  await b.click(q('[data-act="view"][data-arg="draft"]'), 1200);
  check("opening the only draft replays it once", (await b.ev("window.__posts")) === 1);
  await b.click(q('[data-act="discard"]'), 300);
  await b.click(q('[data-act="menu"][data-arg="pipeline"]'));
  await b.click(q('[data-act="set-pipeline"]'), 1200);
  check("after a pipeline switch the only draft opens by itself again", (await b.text(".strip")).includes("Close draft"));

  // ---------- two fast picks: the later one wins ----------
  await b.go(page("example-bot", "map"));
  await b.ev(`(loadProject("edge-bot"), loadProject("broken-bot"), loadProject("example-bot"), 1)`);
  await sleep(1200);
  check("after three fast project picks the last one is on screen", (await b.text(".pick-btn")).includes("example-bot") && (await b.ev("S.data.pipeline.nodes.length")) === 9 && (await b.text(".status")).includes("9 of 9"));

  // ---------- a narrower window wraps the lanes into rows ----------
  await b.size(820, 900);
  await b.go(page("example-bot", "map"));
  await b.click(q('[data-act="lens"][data-arg="all"]'), 300);
  const tops = await b.ev(`new Set([...document.querySelectorAll(".band")].map((x) => x.style.top)).size`);
  check(`on a narrow window the lanes stack as rows (${tops} rows)`, tops > 1 && (await count(".node")) === 9);
  const inside = await b.ev(`(() => { const s = document.querySelector(".stage").getBoundingClientRect(); return [...document.querySelectorAll(".node")].every((n) => { const r = n.getBoundingClientRect(); return r.left >= s.left && r.right <= s.right + 1 && r.top >= s.top && r.bottom <= s.bottom + 1; }); })()`);
  check("every card sits inside the drawn stage", inside);
  await shot("map-wrapped-820");

  // ---------- phone ----------
  await b.size(390, 844);
  await b.go(page("example-bot", "map"));
  check("phone: one picker for project and pipeline", (await count(".pick-btn")) === 1 && (await b.text(".pick-btn")).includes("example-bot · inbound"));
  check("phone: the anchor count is in the footer, not the top bar", !(await b.text("header")).includes("anchors") && (await b.text("footer")).includes("9 of 9 anchors ok"));
  check("phone: a folded lane card shows the colours of the steps inside", (await count(".node .mix")) >= 2 && (await count('.node .mix i[class^="f-"]')) >= 3);
  check("phone: the whole colour key fits the screen", await b.ev(`(() => { const k = document.querySelector(".key"); return k.scrollWidth <= k.clientWidth && k.getBoundingClientRect().right <= innerWidth; })()`));
  check("a folded lane card shows a chevron and the word", (await count(".node .flag svg")) >= 1 && (await b.text(".node .flag")).includes("open"));
  await b.click(q('[data-act="open-lane"]'), 300);
  check("an open lane has a fold control", (await count('.band-h.fold[aria-expanded="true"] .cue svg')) >= 1);
  await b.click(q('[data-act="menu"]'));
  check("phone: the one menu lists pipelines and projects", (await count('.menu [data-act="set-pipeline"]')) >= 1 && (await count('.menu [data-act="set-project"]')) >= 2);
  await shot("map-390");
  await b.click(q('.menu [data-act="set-project"][data-arg="edge-bot"]'), 1200);
  check("phone: picking a project from the one menu loads it", (await b.text(".pick-btn")).includes("edge-bot · inbound"));
  await b.size(1440, 900);

  // ---------- a run that only just started ----------
  await b.go(page("edge-bot", "runs"));
  check("a run with no step yet says so", (await b.text(".run")).includes("not at a step yet") && (await b.text(".strip")).includes("not at a step yet"));
  check("a run with no step yet has no scrubber", (await count(".scrub")) === 0);
  check('nothing on the page reads "undefined" or "NaN"', !/undefined|NaN/.test(await b.text("#app")));
  await shot("run-just-started");
  await b.click(q('[data-act="filter"][data-arg="failed"]'));
  check("an empty filter lights no run on the canvas", (await b.text(".strip")).includes("No runs match this filter") && (await count(".run")) === 0 && (await count(".node.path")) === 0 && (await count(".node")) === 9);
  await b.click(q('.strip [data-act="filter"][data-arg="all"]'));
  check("Show all brings the runs back", (await count(".run")) === 2);
  await b.click(q('[data-act="view"][data-arg="map"]'), 300);
  check("the map says when events were skipped or cleaned", /1 event line was unreadable/.test(await b.text("main")) && /1 decision value was not a known label/.test(await b.text("main")));
  check("the cleaned decision word is not on the page", !(await b.ev(`document.documentElement.innerHTML.includes("a-word-the-map-does-not-name")`)));

  // ---------- a map the engine refuses ----------
  await b.go(page("broken-bot", "map"));
  check("a broken map shows its problems instead of a canvas", (await b.text("main")).includes("cannot be drawn") && (await b.text(".errs")).includes("unknown kind wizard") && (await count(".node")) === 0);
  await b.click(q('[data-act="view"][data-arg="runs"]'), 300);
  check("a broken map stays an error list on Runs too", (await b.text("main")).includes("cannot be drawn"));
  await shot("broken-map");

  check(`no page errors ${JSON.stringify(b.errors)}`, b.errors.length === 0);
} catch (err) {
  check(`the checks ran to the end (${err.message})`, false);
} finally {
  await b.close();
  server.kill();
  rmSync(tmp, { recursive: true, force: true });
}

console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("FAIL")).length;
console.log(`\n${out.length - failed} of ${out.length} click checks pass`);
process.exit(failed ? 1 : 0);
